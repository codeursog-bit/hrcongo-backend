// ============================================================================
// 📁 src/contract-templates/contract-templates.service.ts
//
// Modèles de contrat DYNAMIQUES : le modèle vit en JSON dans Postgres, le
// Word/PDF est fabriqué à la demande, en mémoire. Aucun fichier stocké.
//
// ✅ Seul système de génération de contrats de l'app (l'ancien générateur à
//    3 modèles .docx fixes a été supprimé). Tables : contract_templates,
//    contract_custom_variables, custom_contracts.
// 🔒 Toutes les lectures/écritures sont filtrées par companyId (isolation
//    entre entreprises) ; les modèles système (companyId nul) sont en lecture seule.
// ============================================================================

import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ContractBreakdownService } from './contract-breakdown.service';
import { LegalParametersService } from '../legal-parameters/legal-parameters.service';
import { DEFAULT_LEGAL_PARAMS } from '../legal-parameters/legal-parameters.core';
import {
  DocNode, TemplateSettings, DEFAULT_SETTINGS, sanitizeDoc, sanitizeSettings,
  extractVariableKeys, applyValues, fmtMoney, fmtDateFr,
} from './contract-doc';
import {
  VARIABLE_CATALOG, CATALOG_BY_KEY, CONVENTION_LABELS, CUSTOM_KEY_RE, VariableDef, numberToFrench,
} from './contract-variables.catalog';
import { renderDocx, LetterheadInfo } from './contract-doc.render-docx';
import { renderPdf } from './contract-doc.render-pdf';
import { CreateTemplateDto, UpdateTemplateDto, CustomVariableDto } from './contract-templates.dto';
import { importDocx, ImportResult } from './contract-docx-import';

const MARITAL: Record<string, string> = {
  SINGLE: 'célibataire', MARRIED: 'marié(e)', DIVORCED: 'divorcé(e)', WIDOWED: 'veuf(ve)',
};

/** « 350 000 », « 350000 FCFA » → 350000 */
const toNum = (s: string | undefined | null): number => {
  const n = parseFloat(String(s ?? '').replace(/[^\d,.-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export interface ResolvedVariable {
  key: string;
  label: string;
  group: string;
  source: string;
  type: string;
  value: string;
  missing: boolean; // vide ET sans valeur saisie → à compléter avant de générer
  overridden: boolean;
}

/** 🔒 Valeurs saisies par l'utilisateur : clés strictes (a-z, 0-9, _), taille bornée, aucun objet imbriqué. */
const OVERRIDE_KEY_RE = /^[a-z][a-z0-9_]{0,59}$/;
function sanitizeOverrides(input: unknown): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  let n = 0;
  for (const [k, val] of Object.entries(input as Record<string, unknown>)) {
    if (!OVERRIDE_KEY_RE.test(k)) continue;
    if (typeof val !== 'string' && typeof val !== 'number') continue;
    if (++n > 150) throw new BadRequestException('Trop de valeurs saisies');
    out[k] = String(val).slice(0, 2000);
  }
  return out;
}

@Injectable()
export class ContractTemplatesService {
  constructor(
    private prisma: PrismaService,
    private contractGen: ContractBreakdownService,
    @Optional() private legalParameters?: LegalParametersService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // VARIABLES
  // ══════════════════════════════════════════════════════════════════════════

  /** Catalogue + variables personnalisées de l'entreprise (pour le panneau de l'éditeur). */
  async getCatalog(companyId: string) {
    const custom = await this.prisma.contractCustomVariable.findMany({
      where: { companyId },
      orderBy: { label: 'asc' },
    });
    return [
      ...VARIABLE_CATALOG,
      ...custom
        .filter((c) => !CATALOG_BY_KEY[c.key]) // une valeur enregistrée pour « sigle » n'est pas une 2e variable
        .map((c) => ({
          key: c.key, label: c.label, group: 'Personnalisées', source: 'CUSTOM' as const,
          type: 'text' as const, example: c.value,
        })),
    ];
  }

  async listCustomVariables(companyId: string) {
    return this.prisma.contractCustomVariable.findMany({ where: { companyId }, orderBy: { label: 'asc' } });
  }

  async upsertCustomVariable(companyId: string, dto: CustomVariableDto) {
    const key = dto.key.trim().toLowerCase();
    if (!CUSTOM_KEY_RE.test(key)) {
      throw new BadRequestException('Nom invalide : lettres minuscules, chiffres et _ (ex. sigle_entreprise)');
    }
    if (CATALOG_BY_KEY[key]) throw new BadRequestException('Ce nom est déjà utilisé par une variable du système');
    return this.prisma.contractCustomVariable.upsert({
      where: { companyId_key: { companyId, key } },
      create: { companyId, key, label: dto.label.trim(), value: dto.value },
      update: { label: dto.label.trim(), value: dto.value },
    });
  }

  /**
   * Enregistre UNE FOIS une valeur au niveau de l'entreprise, directement depuis
   * l'écran de génération : les prochains contrats la reprennent seuls.
   *  • variable « Entreprise » du système (sigle, NIU, capital, représentant…) :
   *    sert de valeur de repli quand la fiche entreprise est vide ;
   *  • variable personnalisée : met à jour sa valeur.
   * Les infos « Employé » / « Paie » ne s'enregistrent pas ici (elles viennent
   * de la fiche employé et du calcul).
   */
  async saveDefault(companyId: string, key: string, value: string) {
    const def = CATALOG_BY_KEY[key];
    if (!value.trim()) {
      await this.prisma.contractCustomVariable.deleteMany({ where: { companyId, key } });
      return { success: true, removed: true };
    }
    if (def) {
      if (def.source !== 'COMPANY') {
        throw new BadRequestException('Cette information vient de la fiche employé ou du calcul de paie : elle ne s\'enregistre pas au niveau de l\'entreprise');
      }
      return this.prisma.contractCustomVariable.upsert({
        where: { companyId_key: { companyId, key } },
        create: { companyId, key, label: def.label, value },
        update: { value },
      });
    }
    const existing = await this.prisma.contractCustomVariable.findUnique({ where: { companyId_key: { companyId, key } } });
    if (!existing) throw new NotFoundException('Variable inconnue');
    return this.prisma.contractCustomVariable.update({ where: { companyId_key: { companyId, key } }, data: { value } });
  }

  /** Lit un .docx EN MÉMOIRE → JSON de modèle. Le fichier n'est ni stocké ni écrit sur disque. */
  importFromDocx(buffer: Buffer): ImportResult {
    return importDocx(buffer);
  }

  async deleteCustomVariable(companyId: string, key: string) {
    await this.prisma.contractCustomVariable.deleteMany({ where: { companyId, key } });
    return { success: true };
  }

  /** Calcule TOUTES les valeurs par défaut (employé, entreprise, taux, paie) — puis applique les overrides. */
  private async buildValues(companyId: string, employeeId: string, overrides: Record<string, string> = {}) {
    const [employee, company, custom] = await Promise.all([
      this.prisma.employee.findFirst({ where: { id: employeeId, companyId }, include: { department: true } }),
      this.prisma.company.findUnique({ where: { id: companyId } }),
      this.prisma.contractCustomVariable.findMany({ where: { companyId } }),
    ]);
    if (!employee) throw new NotFoundException('Employé introuvable');
    if (!company) throw new NotFoundException('Entreprise introuvable');
    const emp: any = employee;
    const comp: any = company;

    overrides = sanitizeOverrides(overrides);
    const legal = this.legalParameters?.getAt() ?? DEFAULT_LEGAL_PARAMS;
    const ov = (k: string) => (overrides[k] !== undefined && overrides[k] !== '' ? overrides[k] : undefined);

    // ── Rémunération : mêmes entrées que le générateur existant, même moteur ──
    const salaireBase = ov('salaire_base') !== undefined ? toNum(ov('salaire_base')) : Number(emp.baseSalary || 0);
    const sursalaire = toNum(ov('sursalaire'));
    const primes = toNum(ov('primes_total'));
    const indemTransport = toNum(ov('indemnite_transport'));
    const isCdd = !!(ov('date_fin') || ov('duree_mois') || emp.contractEndDate);

    const companyTaxes = await this.prisma.companyTax.findMany({
      where: { companyId, isActive: true, isRecurring: true },
      orderBy: { name: 'asc' },
    });
    const b = this.contractGen.computeBreakdown({
      salaireBase,
      sursalaire,
      primes: primes ? [{ label: 'Primes', amount: primes }] : [],
      indemniteTransport: indemTransport,
      tolZone: emp.tolZone,
      maritalStatus: emp.maritalStatus,
      numberOfChildren: emp.numberOfChildren,
      applyDeductions: true,
      companyTaxes,
      contractType: isCdd ? 'CDD' : 'CDI',
      isSubjectToIrpp: emp.isSubjectToIrpp,
      isSubjectToCnss: emp.isSubjectToCnss,
    });
    const net = b.totalGross - b.cnssDeduction - b.itsDeduction - b.tolDeduction - b.otherTaxesTotal + indemTransport;

    const nat = String(emp.nationality || '').trim();
    const natLabel = !nat ? '' : /^(CG|COG|CONGO)$/i.test(nat) ? 'congolaise' : nat;

    const v: Record<string, string> = {
      // Salarié
      civilite: emp.gender === 'FEMALE' ? 'Madame' : 'Monsieur',
      nom: emp.lastName || '',
      prenom: emp.firstName || '',
      nom_complet: `${emp.lastName || ''} ${emp.firstName || ''}`.trim(),
      date_naissance: fmtDateFr(emp.dateOfBirth),
      lieu_naissance: emp.placeOfBirth || '',
      nationalite: natLabel,
      cni: emp.nationalIdNumber || '',
      situation_matrimoniale: MARITAL[emp.maritalStatus] || '',
      nombre_enfants: emp.numberOfChildren != null ? String(emp.numberOfChildren) : '',
      nom_pere: emp.fatherName || '',
      nom_mere: emp.motherName || '',
      adresse_salarie: emp.address || '',
      telephone_salarie: emp.phone || '',
      matricule: emp.employeeNumber || '',
      date_embauche: fmtDateFr(emp.hireDate),
      poste: emp.position || '',
      categorie: emp.professionalCategory || '',
      echelon: emp.echelon || '',
      departement: emp.department?.name || '',
      lieu_travail: emp.city || '',
      // Employeur
      nom_entreprise: comp.tradeName || comp.legalName || '',
      raison_sociale: comp.legalName || '',
      forme_juridique: comp.legalForm || '',
      rccm: comp.rccmNumber || '',
      adresse_entreprise: `${comp.address || ''}${comp.city ? ', ' + comp.city : ''}`.replace(/^, /, ''),
      ville_entreprise: comp.city || '',
      telephone_entreprise: comp.phone || '',
      representant: comp.contractRepresentativeName || '',
      fonction_representant: comp.contractRepresentativeRole || '',
      numero_cnss_employeur: comp.cnssNumber || '',
      convention_collective: CONVENTION_LABELS[String(comp.leaveConventionKey || '').toUpperCase()] || '',
      // Rémunération
      salaire_base: fmtMoney(salaireBase),
      sursalaire: fmtMoney(sursalaire),
      primes_total: fmtMoney(primes),
      indemnite_transport: fmtMoney(indemTransport),
      salaire_brut: fmtMoney(b.totalGross),
      cnss_salarie: fmtMoney(b.cnssDeduction),
      its: fmtMoney(b.itsDeduction),
      tol: fmtMoney(b.tolDeduction),
      autres_taxes: fmtMoney(b.otherTaxesTotal),
      salaire_net: fmtMoney(net),
      salaire_net_lettres: numberToFrench(net),
      // Taux légaux
      taux_cnss_salarie: String(+(legal.cnss.salarialRate * 100).toFixed(2)).replace('.', ','),
      taux_cnss_employeur: String(Number(comp.cnssEmployerRate ?? 20.28)).replace('.', ','),
      // À saisir : valeurs par défaut utiles
      nombre_exemplaires: '3',
      lieu_signature: comp.contractSignatureCity || comp.city || '',
      date_signature: fmtDateFr(new Date()),
      lieu_emploi: emp.city || '',
      date_debut: fmtDateFr(emp.hireDate),
      date_fin: fmtDateFr(emp.contractEndDate),
    };
    for (const c of custom) {
      // variable du système (sigle, NIU…) : valeur enregistrée = repli seulement si la fiche entreprise est vide
      if (CATALOG_BY_KEY[c.key]) { if (!v[c.key]) v[c.key] = c.value; }
      else v[c.key] = c.value;
    }

    // Les overrides gagnent TOUJOURS (l'utilisateur a le dernier mot)
    const overridden = new Set<string>();
    for (const [k, val] of Object.entries(overrides)) {
      if (val !== undefined && val !== null && String(val) !== '') {
        v[k] = String(val);
        overridden.add(k);
      }
    }
    return { values: v, overridden, custom, company: comp };
  }

  /** Pour l'écran de génération : chaque variable du modèle, sa source, sa valeur, et si elle manque. */
  async resolve(companyId: string, templateId: string, employeeId: string, overrides: Record<string, string> = {}) {
    const tpl = await this.getTemplate(templateId, companyId);
    const keys = extractVariableKeys(tpl.content as unknown as DocNode);
    const { values, overridden, custom } = await this.buildValues(companyId, employeeId, overrides);
    const customByKey = new Map(custom.map((c) => [c.key, c]));

    const variables: ResolvedVariable[] = keys.map((key) => {
      const def: VariableDef | undefined = CATALOG_BY_KEY[key];
      const cv = customByKey.get(key);
      const value = values[key] ?? '';
      return {
        key,
        label: def?.label || cv?.label || key,
        group: def?.group || 'Personnalisées',
        source: def?.source || (cv ? 'CUSTOM' : 'UNKNOWN'),
        type: def?.type || 'text',
        value,
        missing: !value.trim(),
        overridden: overridden.has(key),
      };
    });
    return {
      template: { id: tpl.id, name: tpl.name, category: tpl.category },
      variables,
      missingCount: variables.filter((x) => x.missing).length,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODÈLES
  // ══════════════════════════════════════════════════════════════════════════

  /** Modèles système (Konza) + modèles de l'entreprise. Sans le contenu (liste légère). */
  async listTemplates(companyId: string) {
    return this.prisma.contractTemplate.findMany({
      where: { OR: [{ companyId: null }, { companyId }] },
      select: {
        id: true, name: true, category: true, description: true, isSystem: true,
        companyId: true, version: true, updatedAt: true, settings: true,
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }

  async getTemplate(id: string, companyId: string) {
    const tpl = await this.prisma.contractTemplate.findFirst({
      where: { id, OR: [{ companyId: null }, { companyId }] },
    });
    if (!tpl) throw new NotFoundException('Modèle introuvable');
    return tpl;
  }

  async createTemplate(companyId: string, userId: string | undefined, dto: CreateTemplateDto) {
    const content = sanitizeDoc(dto.content);
    return this.prisma.contractTemplate.create({
      data: {
        companyId,
        name: dto.name.trim(),
        category: dto.category || 'AUTRE',
        description: dto.description?.trim() || null,
        isSystem: false,
        content: content as any,
        settings: sanitizeSettings(dto.settings) as any,
        createdByUserId: userId || null,
      },
    });
  }

  async updateTemplate(id: string, companyId: string, dto: UpdateTemplateDto) {
    const tpl = await this.getTemplate(id, companyId);
    if (tpl.isSystem || tpl.companyId !== companyId) {
      throw new ForbiddenException('Un modèle système ne se modifie pas : utilisez « Dupliquer » pour en faire votre copie');
    }
    return this.prisma.contractTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.description !== undefined && { description: dto.description.trim() || null }),
        ...(dto.content !== undefined && { content: sanitizeDoc(dto.content) as any }),
        ...(dto.settings !== undefined && { settings: sanitizeSettings(dto.settings) as any }),
        version: { increment: 1 },
      },
    });
  }

  async deleteTemplate(id: string, companyId: string) {
    const tpl = await this.getTemplate(id, companyId);
    if (tpl.isSystem || tpl.companyId !== companyId) throw new ForbiddenException('Modèle système non supprimable');
    // Les contrats déjà générés gardent leur propre copie du contenu → aucun impact.
    await this.prisma.contractTemplate.delete({ where: { id } });
    return { success: true };
  }

  /** « Utiliser ce modèle » : copie un modèle (système ou autre) dans l'entreprise. */
  async duplicateTemplate(id: string, companyId: string, userId?: string) {
    const src = await this.getTemplate(id, companyId);
    return this.prisma.contractTemplate.create({
      data: {
        companyId,
        name: src.isSystem ? src.name : `${src.name} (copie)`,
        category: src.category,
        description: src.description,
        isSystem: false,
        content: src.content as any,
        // Une copie d'un modèle Konza est marquée « non relue » : l'entreprise doit l'adapter
        // puis confirmer elle-même qu'un juriste l'a relue (rappel affiché à la génération).
        settings: (src.isSystem
          ? { ...sanitizeSettings(src.settings), fromSystemTemplate: src.id, legalReviewed: false }
          : sanitizeSettings(src.settings)) as any,
        createdByUserId: userId || null,
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GÉNÉRATION
  // ══════════════════════════════════════════════════════════════════════════

  async generate(
    companyId: string,
    userId: string | undefined,
    input: { templateId: string; employeeId: string; overrides?: Record<string, string>; name?: string },
  ) {
    const tpl = await this.getTemplate(input.templateId, companyId);
    const resolved = await this.resolve(companyId, input.templateId, input.employeeId, input.overrides || {});
    if (resolved.missingCount > 0) {
      const names = resolved.variables.filter((x) => x.missing).map((x) => x.label).join(', ');
      throw new BadRequestException(`Valeurs manquantes : ${names}`);
    }
    const usedValues: Record<string, string> = {};
    for (const x of resolved.variables) usedValues[x.key] = x.value;

    const employee = await this.prisma.employee.findFirst({
      where: { id: input.employeeId, companyId },
      select: { firstName: true, lastName: true },
    });

    return this.prisma.customContract.create({
      data: {
        companyId,
        employeeId: input.employeeId,
        templateId: tpl.id,
        name: input.name?.trim() || `${tpl.name} — ${employee?.lastName || ''} ${employee?.firstName || ''}`.trim(),
        // Copie du modèle au moment de la génération : modifier le modèle ensuite ne change jamais un contrat déjà émis
        content: tpl.content as any,
        settings: (tpl.settings as any) ?? (DEFAULT_SETTINGS as any),
        values: usedValues as any,
        generatedByUserId: userId || null,
      },
    });
  }

  async listContracts(companyId: string, employeeId?: string) {
    return this.prisma.customContract.findMany({
      where: { companyId, ...(employeeId && { employeeId }) },
      select: {
        id: true, name: true, employeeId: true, templateId: true, generatedAt: true,
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, position: true, photoUrl: true } },
      },
      orderBy: { generatedAt: 'desc' },
    });
  }

  async deleteContract(id: string, companyId: string) {
    const r = await this.prisma.customContract.deleteMany({ where: { id, companyId } });
    if (!r.count) throw new NotFoundException('Contrat introuvable');
    return { success: true };
  }

  private slug(t: string) {
    return (t || 'contrat').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'contrat';
  }

  private async letterhead(companyId: string): Promise<LetterheadInfo> {
    const c: any = await this.prisma.company.findUnique({ where: { id: companyId } });
    const line1 = [c?.legalName, c?.legalForm].filter(Boolean).join(' · ');
    const line2 = [c?.address && `${c.address}${c.city ? ', ' + c.city : ''}`, c?.phone && `Tél : ${c.phone}`, c?.rccmNumber && `RCCM : ${c.rccmNumber}`]
      .filter(Boolean).join(' · ');
    return { companyName: c?.tradeName || c?.legalName || '', logo: c?.logo || null, footerLines: [line1, line2].filter(Boolean) };
  }

  private async rendered(id: string, companyId: string) {
    const contract = await this.prisma.customContract.findFirst({ where: { id, companyId } });
    if (!contract) throw new NotFoundException('Contrat introuvable');
    const doc = applyValues(contract.content as unknown as DocNode, contract.values as Record<string, string>);
    const settings = sanitizeSettings(contract.settings);
    return { doc, settings, contract, letterhead: await this.letterhead(companyId) };
  }

  async getDocx(id: string, companyId: string) {
    const { doc, settings, contract, letterhead } = await this.rendered(id, companyId);
    return { buffer: await renderDocx(doc, settings, letterhead), fileName: `${this.slug(contract.name)}.docx` };
  }

  async getPdf(id: string, companyId: string) {
    const { doc, settings, contract, letterhead } = await this.rendered(id, companyId);
    return { buffer: await renderPdf(doc, settings, letterhead), fileName: `${this.slug(contract.name)}.pdf` };
  }

  /** Aperçu PDF d'un modèle AVANT génération, avec les valeurs d'exemple (pour l'éditeur). */
  async previewTemplatePdf(id: string, companyId: string) {
    const tpl = await this.getTemplate(id, companyId);
    const examples: Record<string, string> = {};
    for (const v of VARIABLE_CATALOG) examples[v.key] = v.example;
    const custom = await this.prisma.contractCustomVariable.findMany({ where: { companyId } });
    for (const c of custom) if (!CATALOG_BY_KEY[c.key]) examples[c.key] = c.value;
    const doc = applyValues(tpl.content as unknown as DocNode, examples);
    return renderPdf(doc, sanitizeSettings(tpl.settings), await this.letterhead(companyId));
  }
}