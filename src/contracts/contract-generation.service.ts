// ============================================================================
// 📁 src/contracts/contract-generation.service.ts
//
// Calcule automatiquement Brut / CNSS / ITS / TOL / Net à partir des données
// saisies (réutilise EXACTEMENT les mêmes règles que la paie : plafond CNSS
// 1 200 000, taux salarial 4%, TOL 5000/1000 selon zone, IrppCalculatorService
// pour l'ITS), et stocke UNIQUEMENT l'instantané des données en base (snapshot
// JSON) — AUCUN fichier n'est stocké sur le cloud. Le .docx et le .pdf sont
// regénérés à la volée, à la demande (téléchargement / prévisualisation),
// à partir de cet instantané, via contract-docx-builder.ts et
// contract-pdf-builder.ts.
// ============================================================================

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { PrismaService } from '../prisma/prisma.service';
import { IrppCalculatorService } from '../payroll/fiscal/irpp-calculator.service';
import { MaritalStatus } from '../payroll/fiscal/fiscal-parts.service';
import { buildContractPdf } from './contract-pdf-builder';
import { ContractTemplateData } from './contract-content';
import {
  GenerateContractDto,
  GeneratedContractKindDto,
} from './dto/generate-contract.dto';

const CNSS_PENSION_CEILING = 1_200_000;
const CNSS_SALARIAL_RATE = 0.04;

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const TEMPLATE_FILE_BY_KIND: Record<GeneratedContractKindDto, string> = {
  [GeneratedContractKindDto.CONTRAT_TRAVAIL]: 'contrat-travail.docx',
  [GeneratedContractKindDto.PRESTATION_SERVICES]: 'prestation-services.docx',
  [GeneratedContractKindDto.CONSULTANT]: 'prestation-services.docx', // même trame, titre différent
  [GeneratedContractKindDto.STAGE]: 'stage.docx',
};

const TITRE_BY_KIND: Partial<Record<GeneratedContractKindDto, string>> = {
  [GeneratedContractKindDto.PRESTATION_SERVICES]: 'CONTRAT DE PRESTATIONS DES SERVICES',
  [GeneratedContractKindDto.CONSULTANT]: 'CONTRAT DE CONSULTANCE',
  [GeneratedContractKindDto.STAGE]: 'CONTRAT DE STAGE',
};

const TITLE_BY_DURATION = {
  INDETERMINEE: 'CONTRAT DE TRAVAIL A DUREE INDETERMINEE',
  DETERMINEE: 'CONTRAT DE TRAVAIL A DUREE DETERMINEE',
};

const fmt = (n: number) => Math.round(n || 0).toLocaleString('fr-FR').replace(/\u202F|\u00A0/g, ' ');
const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

@Injectable()
export class ContractGenerationService {
  constructor(
    private prisma: PrismaService,
    private irppCalculator: IrppCalculatorService,
  ) {}

  /**
   * 🧮 Calcule Brut / CNSS / ITS / TOL / Net à partir des composantes saisies.
   * Reproduit exactement les règles utilisées en paie (voir
   * payroll-calculator.service.ts) pour que le document généré corresponde
   * à ce que l'employé retrouvera sur son futur bulletin.
   */
  computeBreakdown(input: {
    salaireBase: number;
    sursalaire?: number;
    heuresSupplementaires?: number;
    primes?: { label: string; amount: number }[];
    transport?: number;
    indemniteTransport?: number;
    tolZone?: 'VILLE' | 'PERIPHERIE';
    maritalStatus?: MaritalStatus;
    numberOfChildren?: number;
    applyDeductions: boolean; // false pour STAGE / PRESTATION (pas de salarié CNSS/ITS)
  }) {
    const sursalaire = input.sursalaire || 0;
    const heuresSupplementaires = input.heuresSupplementaires || 0;
    const transport = input.transport || 0;
    const indemniteTransport = input.indemniteTransport || 0;
    const primesTotal = (input.primes || []).reduce((s, p) => s + (p.amount || 0), 0);

    // ✅ Brut = base + sursalaire + heures sup forfaitaires + primes (qui
    // "entrent dans le brut") + transport (dans ce document, la ligne
    // "Transport" fait partie de la décomposition du brut — comme le modèle
    // fourni le montre : elle est comptée avant le NET, jamais retenue).
    const totalGross =
      input.salaireBase + sursalaire + heuresSupplementaires + primesTotal + transport;

    let cnssDeduction = 0;
    let itsDeduction = 0;
    let tolDeduction = 0;

    if (input.applyDeductions) {
      const cnssBase = Math.min(totalGross, CNSS_PENSION_CEILING);
      cnssDeduction = Math.round(cnssBase * CNSS_SALARIAL_RATE);

      const irppResult = this.irppCalculator.calculateIRPP(
        totalGross,
        cnssDeduction,
        input.maritalStatus ?? MaritalStatus.SINGLE,
        input.numberOfChildren ?? 0,
      );
      itsDeduction = irppResult.irppTotal;

      tolDeduction = input.tolZone === 'PERIPHERIE' ? 1000 : 5000;
    }

    return {
      totalGross,
      cnssDeduction,
      itsDeduction,
      tolDeduction,
      primesTotal,
    };
  }

  /**
   * 🔎 Calcule un aperçu Brut/CNSS/ITS/TOL/Net en appelant EXACTEMENT le même
   * calcul que la génération finale (donc le vrai IrppCalculatorService,
   * identique à celui utilisé par le simulateur de paie) — utilisé par le
   * front pour afficher un aperçu fiable pendant la saisie, sans jamais
   * réimplémenter le barème ITS côté client.
   */
  async previewTravailBreakdown(input: {
    employeeId: string;
    companyId: string;
    salaireBase: number;
    sursalaire?: number;
    heuresSupplementaires?: number;
    primes?: { label: string; amount: number }[];
    transport?: number;
    indemniteTransport?: number;
    indemnites?: { label: string; amount: number }[];
    situationMatrimoniale?: string;
    nombreEnfants?: number;
  }) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: input.employeeId, companyId: input.companyId },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');

    const breakdown = this.computeBreakdown({
      salaireBase: input.salaireBase,
      sursalaire: input.sursalaire,
      heuresSupplementaires: input.heuresSupplementaires,
      primes: input.primes,
      transport: input.transport,
      indemniteTransport: input.indemniteTransport,
      tolZone: (employee as any).tolZone,
      maritalStatus: (input.situationMatrimoniale as MaritalStatus) || employee.maritalStatus,
      numberOfChildren: input.nombreEnfants ?? employee.numberOfChildren,
      applyDeductions: true,
    });

    const indemnitesTotal = (input.indemnites || []).reduce((s, i) => s + (i.amount || 0), 0);
    const netPay =
      breakdown.totalGross - breakdown.cnssDeduction - breakdown.itsDeduction - breakdown.tolDeduction +
      (input.indemniteTransport || 0) + indemnitesTotal;

    return {
      totalGross: breakdown.totalGross,
      cnssDeduction: breakdown.cnssDeduction,
      itsDeduction: breakdown.itsDeduction,
      tolDeduction: breakdown.tolDeduction,
      primesTotal: breakdown.primesTotal,
      indemnitesTotal,
      netPay,
    };
  }

  /**
   * 👤 Pré-remplit les champs du formulaire à partir d'un employé existant —
   * utilisé par le front pour l'étape "Pré-remplir depuis un employé".
   */
  async prefillFromEmployee(employeeId: string, companyId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: { department: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });

    return {
      civilite: employee.gender === 'FEMALE' ? 'Madame' : 'Monsieur',
      nom: employee.lastName,
      prenom: employee.firstName,
      dateNaissance: employee.dateOfBirth,
      lieuNaissance: employee.placeOfBirth,
      nationalite: (employee as any).nationality || '',
      situationMatrimoniale: employee.maritalStatus,
      nombreEnfants: employee.numberOfChildren,
      nomPere: employee.fatherName || '',
      nomMere: employee.motherName || '',
      adresseEmploye: employee.address,
      telephoneEmploye: employee.phone || '',
      poste: employee.position,
      categorie: employee.professionalCategory || '',
      lieuTravail: employee.city,
      salaireBase: Number(employee.baseSalary),
      tolZone: employee.tolZone,
      contractDuration: employee.contractEndDate ? 'DETERMINEE' : 'INDETERMINEE',
      startDate: employee.hireDate,
      endDate: employee.contractEndDate,
      // Société — valeurs par défaut depuis les paramètres entreprise
      nomEntreprise: company?.tradeName || company?.legalName || '',
      adresseEntreprise: company
        ? `${company.address}${company.city ? ', ' + company.city : ''}`
        : '',
      telephoneEntreprise: company?.phone || '',
      formeJuridique: (company as any)?.legalForm || '',
      representantNom: company?.contractRepresentativeName || '',
      representantFonction: company?.contractRepresentativeRole || '',
      villeSignature: company?.contractSignatureCity || company?.city || '',
      dateSignature: new Date().toISOString().slice(0, 10),
    };
  }

  /**
   * 📄 Génère le document de contrat : calcule la paie, remplit le template
   * .docx, l'upload et enregistre l'instantané en base.
   */
  async generate(dto: GenerateContractDto, companyId: string, userId?: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, companyId },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Entreprise introuvable');

    if (dto.kind === GeneratedContractKindDto.CONTRAT_TRAVAIL && !dto.salaireBase) {
      throw new BadRequestException('Le salaire de base est requis pour un contrat de travail');
    }
    if (dto.kind === GeneratedContractKindDto.STAGE && !dto.montantForfaitaire) {
      throw new BadRequestException('Le montant forfaitaire est requis pour une convention de stage');
    }
    if (
      (dto.kind === GeneratedContractKindDto.PRESTATION_SERVICES ||
        dto.kind === GeneratedContractKindDto.CONSULTANT) &&
      !dto.emoluments
    ) {
      throw new BadRequestException('Le montant des émoluments est requis pour ce type de contrat');
    }

    const isTravail = dto.kind === GeneratedContractKindDto.CONTRAT_TRAVAIL;
    const isStage = dto.kind === GeneratedContractKindDto.STAGE;
    const isPrestationLike =
      dto.kind === GeneratedContractKindDto.PRESTATION_SERVICES ||
      dto.kind === GeneratedContractKindDto.CONSULTANT;

    // ── CONTRAT_TRAVAIL : décomposition brut → CNSS → ITS → TOL → net ───────
    let totalGross = 0, cnssDeduction = 0, itsDeduction = 0, tolDeduction = 0, netPay = 0;
    let tauxBnc = 0;
    if (isTravail) {
      const breakdown = this.computeBreakdown({
        salaireBase: dto.salaireBase || 0,
        sursalaire: dto.sursalaire,
        heuresSupplementaires: dto.heuresSupplementaires,
        primes: dto.primes,
        transport: dto.transport,
        indemniteTransport: dto.indemniteTransport,
        tolZone: (employee as any).tolZone,
        maritalStatus: (dto.situationMatrimoniale as MaritalStatus) || employee.maritalStatus,
        numberOfChildren: dto.nombreEnfants ?? employee.numberOfChildren,
        applyDeductions: true,
      });
      const indemnitesTotal = (dto.indemnites || []).reduce((s, i) => s + (i.amount || 0), 0);
      totalGross = breakdown.totalGross;
      cnssDeduction = breakdown.cnssDeduction;
      itsDeduction = breakdown.itsDeduction;
      tolDeduction = breakdown.tolDeduction;
      netPay =
        totalGross - cnssDeduction - itsDeduction - tolDeduction +
        (dto.indemniteTransport || 0) + indemnitesTotal;
    } else if (isStage) {
      // ✅ Stage : montant forfaitaire net, aucune retenue.
      netPay = dto.montantForfaitaire || 0;
    } else {
      // ✅ Prestation / Consultant : émoluments hors code du travail. Le taux
      // BNC est informatif (à la charge du prestataire), pas déduit du net
      // affiché ici — c'est le montant facturé qui fait foi dans le contrat.
      const emoluments = dto.emoluments || 0;
      tauxBnc = dto.tauxBnc ?? 10;
      itsDeduction = Math.round((emoluments * tauxBnc) / 100); // réutilise "itsDeduction" pour stocker le montant BNC informatif
      netPay = emoluments;
    }

    const hasEssai = !!dto.trialPeriodMonths && dto.trialPeriodMonths > 0;
    const estCDD = dto.contractDuration === 'DETERMINEE';
    const montantBnc = itsDeduction; // Prestation/Consultant uniquement — alias explicite pour le contenu du document

    const templateData = {
      titreContrat: isTravail
        ? TITLE_BY_DURATION[dto.contractDuration] || TITLE_BY_DURATION.INDETERMINEE
        : TITRE_BY_KIND[dto.kind] || 'CONTRAT',
      nomEntreprise: dto.nomEntreprise || company.tradeName || company.legalName,
      adresseEntreprise:
        dto.adresseEntreprise || `${company.address}${company.city ? ', ' + company.city : ''}`,
      telephoneEntreprise: dto.telephoneEntreprise || company.phone || '',
      formeJuridique: dto.formeJuridique || (company as any).legalForm || '',
      representantNom: dto.representantNom || company.contractRepresentativeName || '',
      representantFonction: dto.representantFonction || company.contractRepresentativeRole || '',

      civilite: dto.civilite || (employee.gender === 'FEMALE' ? 'Madame' : 'Monsieur'),
      nom: dto.nom || employee.lastName,
      prenom: dto.prenom || employee.firstName,
      dateNaissance: dto.dateNaissance ? fmtDate(dto.dateNaissance) : fmtDate(employee.dateOfBirth),
      lieuNaissance: dto.lieuNaissance || employee.placeOfBirth,
      nationalite: dto.nationalite || (employee as any).nationality || '',
      nomPere: dto.nomPere || employee.fatherName || '',
      nomMere: dto.nomMere || employee.motherName || '',
      adresseEmploye: dto.adresseEmploye || employee.address,
      telephoneEmploye: dto.telephoneEmploye || employee.phone || '',
      nombreEnfants: dto.nombreEnfants ?? employee.numberOfChildren ?? 0,
      situationMatrimoniale: this.maritalLabel(
        (dto.situationMatrimoniale as MaritalStatus) || employee.maritalStatus,
      ),

      poste: dto.poste || employee.position,
      categorie: dto.categorie || employee.professionalCategory || '',
      lieuTravail: dto.lieuTravail || employee.city,

      dureeTexte: dto.contractDuration === 'DETERMINEE' ? 'déterminée' : 'indéterminée',
      dateDebut: dto.startDate ? fmtDate(dto.startDate) : fmtDate(employee.hireDate),
      dateFin: dto.endDate ? fmtDate(dto.endDate) : '',
      estCDD,
      hasEssai,
      periodeEssai: hasEssai ? `${dto.trialPeriodMonths} mois` : '',

      // ── Rémunération CONTRAT_TRAVAIL ──────────────────────────────────────
      salaireBase: fmt(dto.salaireBase || 0),
      sursalaire: fmt(dto.sursalaire || 0),
      heuresSupplementaires: fmt(dto.heuresSupplementaires || 0),
      primes: (dto.primes || []).map((p) => ({ label: p.label, montant: fmt(p.amount) })),
      totalBrut: fmt(totalGross),
      retenuesCnss: fmt(cnssDeduction),
      retenuesIts: fmt(itsDeduction),
      tol: fmt(tolDeduction),
      transport: fmt(dto.transport || 0),
      indemniteTransport: fmt(dto.indemniteTransport || 0),
      indemnites: (dto.indemnites || []).map((i) => ({ label: i.label, montant: fmt(i.amount) })),
      netAPayer: fmt(netPay),

      // ── Spécifique STAGE ───────────────────────────────────────────────────
      montantForfaitaire: fmt(dto.montantForfaitaire || 0),
      dureeStageTexte: dto.dureeStageTexte || '',
      renouvelable: dto.renouvelable ?? true,

      // ── Spécifique PRESTATION_SERVICES / CONSULTANT ────────────────────────
      taches: dto.taches || '',
      horaires: dto.horaires || '',
      emoluments: fmt(dto.emoluments || 0),
      tauxBnc,
      montantBnc: fmt(montantBnc),

      villeSignature: dto.villeSignature || company.contractSignatureCity || company.city,
      dateSignature: dto.dateSignature ? fmtDate(dto.dateSignature) : fmtDate(new Date()),
      piedDePage: company.documentFooterText || '',
    };

    // ✅ AUCUN fichier stocké sur le cloud : seul l'instantané (snapshot JSON +
    // valeurs de paie) est persisté en base. Le .docx et le .pdf seront
    // regénérés à la volée à chaque téléchargement/prévisualisation (voir
    // getDocxBuffer / getPdfBuffer plus bas), toujours à partir de ces mêmes
    // données — donc toujours identiques entre eux.
    const fileName = `${this.slug(templateData.titreContrat)}-${this.slug(
      `${templateData.nom}-${templateData.prenom}`,
    )}`;

    const record = await this.prisma.generatedContract.create({
      data: {
        companyId,
        employeeId: dto.employeeId,
        kind: dto.kind as any,
        contractDuration: dto.contractDuration,
        status: 'GENERE',
        startDate: dto.startDate ? new Date(dto.startDate) : employee.hireDate,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        trialPeriodText: hasEssai ? `${dto.trialPeriodMonths} mois` : null,
        snapshot: templateData as any,
        baseSalary: isTravail ? (dto.salaireBase || 0) : isStage ? (dto.montantForfaitaire || 0) : (dto.emoluments || 0),
        overSalary: dto.sursalaire || 0,
        overtimeFlat: dto.heuresSupplementaires || 0,
        bonuses: (dto.primes || []) as any,
        totalGross: totalGross,
        cnssDeduction: cnssDeduction,
        itsDeduction: itsDeduction,
        tolDeduction: tolDeduction,
        transportAllowance: dto.transport || 0,
        transportIndemnity: dto.indemniteTransport || 0,
        allowances: (dto.indemnites || []) as any,
        netPay,
        fileName,
        generatedByUserId: userId,
      },
    });

    return record;
  }

  async listForEmployee(employeeId: string, companyId: string) {
    return this.prisma.generatedContract.findMany({
      where: { employeeId, companyId },
      orderBy: { generatedAt: 'desc' },
    });
  }

  async listForCompany(companyId: string) {
    return this.prisma.generatedContract.findMany({
      where: { companyId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
            position: true,
            photoUrl: true,
          },
        },
      },
      orderBy: { generatedAt: 'desc' },
    });
  }

  async getOne(id: string, companyId: string) {
    const contract = await this.prisma.generatedContract.findFirst({
      where: { id, companyId },
      include: { employee: true },
    });
    if (!contract) throw new NotFoundException('Contrat introuvable');
    return contract;
  }

  /**
   * 📄 Regénère le .docx à la volée à partir de l'instantané stocké — en
   * remplissant le vrai modèle Word de l'entreprise (mise en forme, articles
   * légaux exacts) — rien n'est jamais lu depuis un stockage externe.
   */
  async getDocxBuffer(id: string, companyId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const contract = await this.getOne(id, companyId);
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    const data = contract.snapshot as unknown as ContractTemplateData;
    const docxBuffer = this.fillTemplate(TEMPLATE_FILE_BY_KIND[contract.kind as GeneratedContractKindDto], data);
    const buffer = company?.logo ? await this.swapLogo(docxBuffer, company.logo) : docxBuffer;
    return { buffer, fileName: `${contract.fileName || 'contrat'}.docx` };
  }

  /**
   * 📄 Regénère le .pdf à la volée à partir de l'instantané stocké — rien
   * n'est jamais lu depuis un stockage externe.
   */
  async getPdfBuffer(id: string, companyId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const contract = await this.getOne(id, companyId);
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    const buffer = await buildContractPdf(
      contract.kind as any,
      contract.snapshot as unknown as ContractTemplateData,
      company?.logo || undefined,
    );
    return { buffer, fileName: `${contract.fileName || 'contrat'}.pdf` };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Remplit le vrai template .docx de l'entreprise avec les données du contrat. */
  private fillTemplate(templateFile: string, data: Record<string, any>): Buffer {
    const templatePath = path.join(TEMPLATES_DIR, templateFile);
    if (!fs.existsSync(templatePath)) {
      throw new BadRequestException(`Modèle de contrat introuvable : ${templateFile}`);
    }
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => '',
    });
    doc.render(data);
    return doc.getZip().generate({ type: 'nodebuffer' });
  }

  /** Remplace le logo de l'entreprise dans le document (toutes les copies —
   * Word duplique parfois la même image sous plusieurs fichiers selon le
   * nombre de variantes d'en-tête). */
  private async swapLogo(docxBuffer: Buffer, logoUrl: string): Promise<Buffer> {
    try {
      const res = await fetch(logoUrl);
      if (!res.ok) return docxBuffer;
      const logoBuffer = Buffer.from(await res.arrayBuffer());
      const zip = new PizZip(docxBuffer);
      const mediaFiles = Object.keys(zip.files).filter((name) =>
        /^word\/media\/.+\.(png|jpe?g)$/i.test(name),
      );
      if (mediaFiles.length === 0) return docxBuffer;
      for (const name of mediaFiles) {
        zip.file(name, logoBuffer);
      }
      return zip.generate({ type: 'nodebuffer' });
    } catch {
      // Le logo n'a pas pu être récupéré — le document sort avec le logo par
      // défaut du modèle plutôt que de faire échouer toute la génération.
      return docxBuffer;
    }
  }

  private maritalLabel(status: MaritalStatus): string {
    const map: Record<string, string> = {
      SINGLE: 'célibataire',
      MARRIED: 'marié(e)',
      DIVORCED: 'divorcé(e)',
      WIDOWED: 'veuf(ve)',
    };
    return map[status] || 'célibataire';
  }

  private slug(text: string): string {
    return (text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}