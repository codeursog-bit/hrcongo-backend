// ============================================================================
// das-declaration.service.ts — DAS I (Déclaration Annuelle des Salaires)
// CNSS-Impôts Congo-Brazzaville — déclaration ANNUELLE (contrairement à la
// CNSS mensuelle) : cumul des 12 bulletins de paie validés de l'année.
//
// ⚠️ MAPPING DES COLONNES DU FORMULAIRE — déduit visuellement du fichier
// fourni par l'utilisateur, puis confirmé/corrigé contre le code de calcul
// réel (payroll-calculator.service.ts / payroll-items.service.ts) :
//   a = salaire brut cumulé (Payroll.grossSalary)
//   b = salaire plafonné cumulé (base CNSS, plafond 1 200 000/mois)
//   c = salaire de présence = f − d (vérifié à l'euro près sur les 7
//       salariés du fichier original fourni — pas une donnée à part,
//       c'est le reliquat du taxable une fois l'indemnité de congé retirée)
//   d = salaire de congé cumulé (détail de la source plus bas, avec i/j)
//   e = avantages en nature (nature + montant) — non modélisé actuellement
//       dans PayrollItem, laissé vide (TODO si un jour tracké séparément)
//   f = salaire brut taxable cumulé = a − cnssSalarial (part salariale
//       CNSS déjà stockée sur chaque bulletin) — vérifié à l'euro près
//       (exactement -4%) sur les 7 salariés du fichier original fourni
//   g = base imposable = 80% de f (formule imprimée sur le formulaire lui-même)
//   h = IRPP/ITS retenu cumulé (Payroll.its)
//   i = deux valeurs empilées par salarié sur le formulaire — reprises de
//       la même classification que payroll-recap.service.ts (déjà
//       éprouvée) plutôt que recalculées ou laissées à 0 :
//         · ligne "PARTI LE" (ind1) : taxe départementale/régionale —
//           cumul des PayrollItem DEDUCTION dont le code commence par
//           'CTAX_' (classifyCompanyTax → 'TAXE_DPT') + celles saisies à
//           la main en paie manuelle (code 'MANUAL_DEDUCTION', libellé
//           contenant DPT/DEPART/REGION)
//         · ligne "DUREE EMPLOI" (ind2) : la TOL — cumul des PayrollItem
//           DEDUCTION 'CTAX_' classifiées 'TOL'. Jamais saisie à la main
//           (toujours configurée en CompanyTax), donc pas de filet mot-clé
//           nécessaire pour elle contrairement à la taxe départementale.
//   j = deux primes non imposables précises, chacune sur sa propre ligne
//       du formulaire — pas un regroupement générique de toutes les
//       primes non taxables :
//         · "T" = prime de transport (PayrollItem GAIN, isTaxable=false
//           ET isCnss=false — définition exacte d'une "indemnité" au
//           Congo, cf. payroll-recap.service.ts —, libellé "transport")
//         · "P" = prime de panier (idem, libellé "panier"/"repas")
//       Toute autre prime non imposable (risque, rendement, etc.) n'a pas
//       d'emplacement sur ce formulaire et n'est donc pas reportée.
//   d = salaire de congé cumulé — détecté par mot-clé sur le libellé
//       (contient "congé") plutôt que par un code dédié : la paie
//       manuelle et les primes calculées passent par le système générique
//       de primes (code 'BONUS_xxx'/'AUTO_BONUS_xxx', libellé texte libre
//       = bonus.bonusType), jamais par un code congé fixe et fiable —
//       même principe de détection que hasCongesPaies dans
//       manual-payroll.service.ts (/cong[eé]/i).
//
// ⚠️ CORRECTIONS APPORTÉES SUITE AUX ERREURS TSC :
//   1. Le select Company ne demandait plus `niu` (champ qui n'existe QUE
//      sur Employee, pas sur Company) et n'a plus besoin de `as any` — un
//      `as any` sur un `select` casse l'inférence de type de TOUT le retour
//      Prisma (TS retombe sur l'union de tous les shapes possibles du
//      client, d'où l'erreur "Property 'replace' does not exist..." sur
//      un type qui ressemblait à Payment/Transaction). Le NIU entreprise
//      correspond au champ `taxNumber` du modèle Company.
//   2. `archiver` est récupéré via require() typé — voir plus bas pour le
//      détail (décalage de version entre le paquet runtime et ses types).
//   3. L'accumulateur de cumul annuel a un type explicite (plus de
//      `Map<string, any>`) pour que `sexe`/`situationMatrimoniale` gardent
//      leur type littéral ('M'|'F'|'' etc.) jusqu'à `buildExportPayload` —
//      un `any` en cours de route élargit silencieusement ces champs en
//      `string` et casse l'assignation à `DasEmployeeLine`.
// ============================================================================

import { Injectable, BadRequestException } from '@nestjs/common';
import { PassThrough } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import {
  fillDasTemplate,
  DasExportPayload,
  DasEmployeeLine,
} from './export-das-template';

// ⚠️ Le package `archiver` installé (5.x) exporte une fonction factory
// callable (`archiver('zip', options)`), mais `@types/archiver` (8.x) ne
// déclare plus cette factory dans ses types — seulement les classes
// `ZipArchive`/`TarArchive`. C'est un décalage de version entre le paquet
// runtime et ses types, pas une erreur de notre code : on récupère donc le
// module via `require()` brut pour contourner les types ambiants erronés.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const archiver: (format: string, options?: any) => any = require('archiver');

const CNSS_PENSION_CEILING = 1_200_000; // plafond mensuel — voir PayrollSettings.cnssPensionCeiling
// ─── Classification des PayrollItem — repris tel quel de
// payroll-recap.service.ts (logique déjà éprouvée en production) ──────────
// La paie manuelle et les primes calculées ne passent PAS par des codes
// fixes ('INDEM_CONGE', 'CTAX_TOL'...) : elles utilisent des labels texte
// libre classés par mot-clé (voir manual-payroll.service.ts /
// payroll-items.service.ts — code 'BONUS_xxx' / 'MANUAL_DEDUCTION').
// D'où l'importance de reprendre exactement la même logique ici plutôt que
// de se fier uniquement aux codes, qui ratent la majorité des cas réels.
function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

type TaxBucket = 'TOL' | 'TAXE_DPT' | 'AUTRES';

function classifyCompanyTax(label: string, code: string): TaxBucket {
  const n = normalize(`${code} ${label}`);
  if (n.includes('TOL')) return 'TOL';
  // "Taxe Départementale" et "Taxe Régionale" désignent la même chose selon
  // l'appellation utilisée par l'entreprise — même case.
  if (n.includes('DPT') || n.includes('DEPART') || n.includes('REGION')) return 'TAXE_DPT';
  return 'AUTRES';
}

function isManualTaxeDept(label: string): boolean {
  const n = normalize(label);
  // ⚠️ Le TOL n'a PAS besoin de ce filet : toujours via CompanyTax
  // (CTAX_TOL), jamais saisi à la main. Seule la taxe départementale
  // (payée une fois par an) a besoin de ce filet de sécurité.
  return n.includes('DPT') || n.includes('DEPART') || n.includes('REGION');
}

function isCongeLabel(label: string): boolean {
  // Les indemnités de congé passent par le système de primes générique
  // (code 'BONUS_xxx'/'AUTO_BONUS_xxx', label = bonus.bonusType en texte
  // libre) — jamais par un code dédié fiable, d'où la détection par
  // mot-clé (même logique que manual-payroll.service.ts: /cong[eé]/i).
  return normalize(label).includes('CONGE');
}

export type Sexe = 'M' | 'F' | '';
export type SituationMatrimoniale = 'C' | 'M' | 'V' | 'D';

export interface EmployeeAccumulator {
  employee: {
    id: string;
    employeeNumber: string;
    cnssNumber: string | null;
    niu: string | null;
    firstName: string;
    lastName: string;
    position: string;
    address: string;
    gender: string;
    maritalStatus: string;
    numberOfChildren: number;
    nationality: string | null;
    hireDate: Date;
    terminationDate: Date | null;
    contractType: string;
  };
  salaireBrut: number;
  salairePlafonne: number;
  salaireBrutTaxable: number;
  salaireDeConge: number; // d — somme des PayrollItem INDEM_CONGE / CONGE_SUPP
  irppRetenu: number;
  tolAnnuel: number; // i (ligne "DUREE EMPLOI") — cumul des PayrollItem CTAX_TOL de l'année
  taxeDeptAnnuel: number; // i (ligne "PARTI LE") — cumul CTAX_ + saisie manuelle "DPT/DEPART/REGION"
  indemniteTransport: number; // j "T" — primes non imposables dont le libellé contient "transport"
  indemnitePanier: number; // j "P" — primes non imposables dont le libellé contient "panier"
}

export interface DasRecapLine {
  employeeId: string;
  matricule: string;
  nom: string;
  prenom: string;
  profession: string;
  adresse: string;
  sexe: Sexe;
  situationMatrimoniale: SituationMatrimoniale;
  nbEnfants: number;
  nationaliteCode: string;
  dateEmbauche: Date;
  dateParti: Date | null;
  dureeEmploi: string;
  cnssNumber: string | null; // matricule CNSS du salarié (distinct du NIU)
  niu: string | null; // NIU réel du salarié — vide si non renseigné, jamais inventé
  salaireBrut: number;
  salairePlafonne: number;
  salaireBrutTaxable: number;
  salaireDeConge: number; // d
  salaireDePresence: number; // c = salaireBrutTaxable - salaireDeConge
  baseImposable: number;
  irppRetenu: number;
  tolAnnuel: number; // i (ligne "DUREE EMPLOI") — TOL réelle cumulée sur l'année
  taxeDeptAnnuel: number; // i (ligne "PARTI LE") — taxe départementale/régionale réelle cumulée
  indemniteTransport: number; // j "T"
  indemnitePanier: number; // j "P"
}

export interface DasRecap {
  company: {
    legalName: string;
    cnssAffiliationNumber: string | null;
    cnssNumber: string | null;
    address: string;
    taxNumber: string | null;
  } | null;

  year: number;
  deadlineLabel: string;
  employees: DasRecapLine[];
  totals: { effectif: number; salaireBrut: number; irppRetenu: number };
}

function n(v: any): number {
  const x = Number(v ?? 0);
  return isNaN(x) ? 0 : x;
}

// Année N → échéance légale de dépôt (20 février N+1, valeur actuelle —
// a varié par le passé selon les textes, cf. exemples 2018/2019 vus dans le
// fichier fourni ; à rendre configurable si la CNSS change à nouveau la date)
function getDasDeadlineLabel(year: number): string {
  return `20 Février ${year + 1}`;
}

function formatDateDas(d: Date | null | undefined): string {
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd} - ${mm} - ${yy}`;
}

const SEXE_MAP: Record<string, Sexe> = {
  MALE: 'M',
  FEMALE: 'F',
  OTHER: '',
};

const SITUATION_MAP: Record<string, SituationMatrimoniale> = {
  SINGLE: 'C',
  MARRIED: 'M',
  WIDOWED: 'V',
  DIVORCED: 'D',
};

@Injectable()
export class DasDeclarationService {
  constructor(private prisma: PrismaService) {}

  private async getCompanyId(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new BadRequestException('Accès refusé');
    return user.companyId;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Années disponibles (pour le sélecteur "2020 → 2026" côté frontend)
  // ══════════════════════════════════════════════════════════════════════
  async getAvailableYears(userId: string): Promise<number[]> {
    const companyId = await this.getCompanyId(userId);
    const rows = await this.prisma.payroll.findMany({
      where: {
        companyId,
        status: { not: 'DRAFT' },
        // ⚠️ DAS I ne concerne que les salariés CDI/CDD — les prestataires,
        // stagiaires, consultants et intérimaires n'y figurent pas.
        employee: { contractType: { in: ['CDI', 'CDD'] } },
      },
      distinct: ['year'],
      select: { year: true },
      orderBy: { year: 'desc' },
    });
    return rows.map((r) => r.year);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Cumul annuel par salarié — utilisé pour l'affichage écran ET l'export
  // ══════════════════════════════════════════════════════════════════════
  async getAnnualRecap(userId: string, year: number): Promise<DasRecap> {
    const companyId = await this.getCompanyId(userId);

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        legalName: true,
        cnssAffiliationNumber: true,
        cnssNumber: true,
        address: true,
        taxNumber: true, // ← NIU entreprise (le champ `niu` n'existe que sur Employee)
      },
    });

    const payrolls = await this.prisma.payroll.findMany({
      where: {
        companyId,
        year,
        status: { not: 'DRAFT' },
        // ⚠️ DAS I ne concerne que les salariés CDI/CDD — les prestataires,
        // stagiaires, consultants et intérimaires n'y figurent pas.
        employee: { contractType: { in: ['CDI', 'CDD'] } },
      },
      select: {
        grossSalary: true,
        cnssSalarial: true,
        its: true,
        employeeId: true,
        // ⚠️ on ne filtre plus par type ici : on a besoin des GAIN (congé,
        // transport, panier) ET des DEDUCTION (TOL, taxe départementale).
        // Le tri se fait entièrement dans la boucle ci-dessous, avec la
        // même classification que payroll-recap.service.ts.
        items: {
          select: { type: true, code: true, label: true, amount: true, isTaxable: true, isCnss: true },
        },
        employee: {
          select: {
            id: true,
            employeeNumber: true,
            cnssNumber: true,
            niu: true,
            firstName: true,
            lastName: true,
            position: true,
            address: true,
            gender: true,
            maritalStatus: true,
            numberOfChildren: true,
            nationality: true,
            hireDate: true,
            terminationDate: true,
            contractType: true,
          },
        },
      },
      orderBy: { employee: { lastName: 'asc' } },
    });

    // ── Regroupement par salarié (12 bulletins → 1 ligne DAS) ─────────────
    const byEmployee = new Map<string, EmployeeAccumulator>();

    for (const p of payrolls) {
      const emp = p.employee;
      if (!byEmployee.has(emp.id)) {
        byEmployee.set(emp.id, {
          employee: emp,
          salaireBrut: 0,
          salairePlafonne: 0,
          salaireBrutTaxable: 0,
          salaireDeConge: 0,
          irppRetenu: 0,
          tolAnnuel: 0,
          taxeDeptAnnuel: 0,
          indemniteTransport: 0,
          indemnitePanier: 0,
        });
      }
      const acc = byEmployee.get(emp.id)!;
      const brut = n(p.grossSalary);
      const cnssSalarial = n(p.cnssSalarial);
      acc.salaireBrut += brut;
      acc.salairePlafonne += Math.min(brut, CNSS_PENSION_CEILING);
      // f = salaire brut taxable = brut − part salariale CNSS (vérifié à
      // l'euro près, exactement -4% sur les 7 salariés du fichier original)
      acc.salaireBrutTaxable += brut - cnssSalarial;
      acc.irppRetenu += n(p.its);

      for (const item of p.items) {
        const amt = n(item.amount);

        if (item.type === 'GAIN') {
          if (isCongeLabel(item.label)) {
            // d = salaire de congé — déjà inclus dans grossSalary/f, on
            // l'isole seulement pour le split c/d de la déclaration DAS.
            // Détection par mot-clé car la paie manuelle/primes calculées
            // ne posent pas de code dédié fiable (voir isCongeLabel).
            acc.salaireDeConge += amt;
          } else if (item.isTaxable === false && item.isCnss === false) {
            // j = uniquement Transport ("T") et Panier ("P") — les 2 seules
            // cases physiques du formulaire. Toute autre prime non imposable
            // (risque, rendement...) n'a pas d'emplacement sur ce formulaire.
            const label = normalize(item.label);
            if (label.includes('TRANSPORT')) {
              acc.indemniteTransport += amt;
            } else if (label.includes('PANIER') || label.includes('REPAS')) {
              acc.indemnitePanier += amt;
            }
          }
          continue;
        }

        if (item.type === 'DEDUCTION') {
          if (item.code?.startsWith('CTAX_')) {
            const bucket = classifyCompanyTax(item.label, item.code);
            if (bucket === 'TOL') acc.tolAnnuel += amt;
            else if (bucket === 'TAXE_DPT') acc.taxeDeptAnnuel += amt;
          } else if (item.code === 'MANUAL_DEDUCTION' && isManualTaxeDept(item.label)) {
            // Taxe départementale saisie à la main (paie manuelle) plutôt
            // que configurée en CompanyTax — se paie souvent une fois par
            // an, donc fréquemment en saisie ponctuelle.
            acc.taxeDeptAnnuel += amt;
          }
        }
      }
    }

    const lines: DasRecapLine[] = Array.from(byEmployee.values()).map((acc) => {
      const emp = acc.employee;
      const sexe: Sexe = SEXE_MAP[emp.gender] ?? '';
      const situationMatrimoniale: SituationMatrimoniale =
        SITUATION_MAP[emp.maritalStatus] ?? 'C';
      const nationaliteCode: string =
        !emp.nationality || emp.nationality === 'CG' ? 'C' : emp.nationality;

      // c = salaire de présence = f − d (vérifié sur le fichier original)
      const salaireDePresence = Math.max(
        0,
        acc.salaireBrutTaxable - acc.salaireDeConge,
      );

      return {
        employeeId: emp.id,
        matricule: emp.employeeNumber,
        nom: emp.lastName,
        prenom: emp.firstName,
        profession: emp.position,
        adresse: emp.address,
        sexe,
        situationMatrimoniale,
        nbEnfants: emp.numberOfChildren || 0,
        nationaliteCode,
        dateEmbauche: emp.hireDate,
        dateParti: emp.terminationDate,
        dureeEmploi: emp.contractType,
        cnssNumber: emp.cnssNumber,
        niu: emp.niu,
        salaireBrut: acc.salaireBrut,
        salairePlafonne: acc.salairePlafonne,
        salaireBrutTaxable: acc.salaireBrutTaxable,
        salaireDeConge: acc.salaireDeConge,
        salaireDePresence,
        baseImposable: Math.round(acc.salaireBrutTaxable * 0.8),
        irppRetenu: acc.irppRetenu,
        tolAnnuel: acc.tolAnnuel,
        taxeDeptAnnuel: acc.taxeDeptAnnuel,
        indemniteTransport: acc.indemniteTransport,
        indemnitePanier: acc.indemnitePanier,
      };
    });

    return {
      company,
      year,
      deadlineLabel: getDasDeadlineLabel(year),
      employees: lines,
      totals: {
        effectif: lines.length,
        salaireBrut: lines.reduce((s, l) => s + l.salaireBrut, 0),
        irppRetenu: lines.reduce((s, l) => s + l.irppRetenu, 0),
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Export .xlsx (template officiel DAS I rempli — mise en page identique
  // au fichier fourni par l'utilisateur)
  // ══════════════════════════════════════════════════════════════════════
  async exportDas(
    userId: string,
    year: number,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const recap = await this.getAnnualRecap(userId, year);
    const payload = this.buildExportPayload(recap);
    const buffer = await fillDasTemplate(payload);
    const safeCompany = (recap.company?.legalName || 'entreprise')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .slice(0, 40);
    return {
      buffer,
      filename: `DAS_I_${safeCompany}_${year}.xlsx`,
    };
  }

  // Export sur une plage d'années (ex: 2020 → 2026) → zip contenant un .xlsx par année
  async exportDasRange(
    userId: string,
    startYear: number,
    endYear: number,
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (endYear < startYear) {
      throw new BadRequestException("Plage d'années invalide");
    }
    // ⚠️ nécessite `archiver` (npm install archiver @types/archiver)

    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(c));

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(stream);

    for (let y = startYear; y <= endYear; y++) {
      const recap = await this.getAnnualRecap(userId, y);
      if (recap.employees.length === 0) continue; // pas de paie cette année-là
      const payload = this.buildExportPayload(recap);
      const buffer = await fillDasTemplate(payload);
      archive.append(buffer, { name: `DAS_I_${y}.xlsx` });
    }

    await archive.finalize();
    await new Promise((resolve) => stream.on('end', resolve));

    return {
      buffer: Buffer.concat(chunks),
      filename: `DAS_I_${startYear}-${endYear}.zip`,
    };
  }

  private buildExportPayload(recap: DasRecap): DasExportPayload {
    const company = recap.company;
    const employees: DasEmployeeLine[] = recap.employees.map((e) => {
      return {
        nomPrenom: `${e.nom} ${e.prenom}`.toUpperCase(),
        profession: e.profession || '',
        // ⚠️ Cette case est sous le libellé "NIU:" du formulaire — c'est
        // bien le NIU du salarié qu'il faut ici, pas son matricule CNSS
        // (deux champs distincts sur Employee). Laissé vide si le salarié
        // n'a pas de NIU renseigné — jamais de valeur de repli inventée.
        matriculeAssurance: e.niu || '',
        sexe: e.sexe,
        situationMatrimoniale: e.situationMatrimoniale,
        nationaliteCode: e.nationaliteCode,
        nbEnfants: e.nbEnfants,
        dateEmbauche: formatDateDas(e.dateEmbauche),
        dateParti: formatDateDas(e.dateParti),
        dureeEmploi: e.dureeEmploi,
        adresseLigne1: e.adresse || '',
        adresseLigne2: '',
        salaireBrut: e.salaireBrut,
        salairePlafonne: e.salairePlafonne,
        salaireDePresence: e.salaireDePresence, // c = f − d
        salaireDeConge: e.salaireDeConge, // d = primes libellées "congé" (voir isCongeLabel)
        avantageNature: '',
        avantageMontant: undefined, // e = avantages en nature : non tracké, cellule laissée vide plutôt qu'à 0
        salaireBrutTaxable: e.salaireBrutTaxable,
        baseImposable: e.baseImposable,
        irppRetenu: e.irppRetenu,
        // j "T" = prime de transport non imposable — la case "i" de cette
        // ligne porte la vraie taxe départementale/régionale cumulée
        // (CompanyTax CTAX_ + saisie manuelle "DPT/DEPART/REGION")
        indemnite1:
          e.indemniteTransport > 0 || e.taxeDeptAnnuel > 0
            ? { nature: 'T', montant: e.indemniteTransport || undefined, taxeRegionale: e.taxeDeptAnnuel || undefined }
            : undefined,
        // j "P" = prime de panier non imposable — la case "i" de cette
        // ligne porte la vraie TOL cumulée de l'année (CompanyTax CTAX_TOL,
        // jamais saisie à la main — voir isManualTaxeDept)
        indemnite2:
          e.indemnitePanier > 0 || e.tolAnnuel > 0
            ? { nature: 'P', montant: e.indemnitePanier || undefined, taxeRegionale: e.tolAnnuel || undefined }
            : undefined,
      };
    });

    return {
      company: {
        legalName: company?.legalName || '',
        addressLine1: company?.address || '',
        addressLine2: '',
        cnssAffiliationNumber:
          company?.cnssAffiliationNumber || company?.cnssNumber || '',
        niu: company?.taxNumber || '',
      },
      year: recap.year,
      deadlineLabel: recap.deadlineLabel,
      employees,
    };
  }
}