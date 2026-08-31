// ============================================================================
// 📁 src/reports/payroll-recap.service.ts
// ✅ Récapitulatif "modèle Excel" — mensuel + annuel — par employé.
//
// Colonnes reproduites (cf. PPP_MODELE_GESTION_DU_PERSONNEL) :
//   SAL. BRUT | CNSS 4% | IRPP | RESTE 1 | [INDEMNITÉS...] | S/TOTAL |
//   AVANCE | PHARMACIE | TOL | TAXE DPT | AUTRES (taxes) | NET A PAYER
//
// ⚠️ RÈGLES DE CLASSIFICATION (le cœur du sujet — lire avant de modifier) :
//
// 1) INDEMNITÉS = uniquement les PayrollItem de type GAIN qui sont
//    isTaxable=false ET isCnss=false (fiscalType NON_TAXABLE côté
//    payroll-bonuses.service.ts). C'est la définition métier d'une
//    "indemnité" au Congo : transport, salissure, panier/repas, logement...
//    → n'entre JAMAIS dans le brut cotisable, contrairement à une prime
//      de rendement ou d'ancienneté (celles-là restent dans SAL. BRUT).
//    Les colonnes affichées sont DYNAMIQUES : on n'affiche une colonne que
//    si au moins un employé de la période a perçu ce type d'indemnité
//    (ex: si l'entreprise ne paie pas de logement, pas de colonne Logement).
//
// 2) RETENUES — 3 colonnes reconnues : AVANCE, PHARMACIE et TAXE DPT.
//    Le prêt (LOAN) et toute autre retenue "libre" ne sont PAS affichés
//    ici (ils existent mais ne concernent pas ce tableau).
//
//    Problème connu : en paie MANUELLE, toutes les retenues (avance, prêt,
//    quinzaine, pharmacie, taxe régionale/départementale...) sont saisies
//    dans le même champ libre (code='MANUAL_DEDUCTION', label=texte libre
//    saisi par l'utilisateur). On ne peut donc PAS se fier au code,
//    seulement au texte du label.
//    → on normalise le label (majuscules, sans accents) et on matche par
//      mot-clé. "Quinzaine" est traité comme une AVANCE (remboursement
//      proportionnel à l'avance, donc même case).
//
//    Principe à DEUX SOURCES pour la Taxe Dépt (comme Pharmacie/Avance) :
//    si l'entreprise a configuré une vraie CompanyTax (code CTAX_xxx), on
//    la récupère normalement (règle 3 ci-dessous). Si elle n'a rien
//    configuré et l'a plutôt saisie à la main en paie manuelle ("Taxe
//    régionale", "Taxe départementale" en libellé libre — elle ne se paie
//    qu'une fois par an, donc souvent en saisie ponctuelle), on la
//    reconnaît quand même par mot-clé. Les deux sources s'additionnent
//    naturellement dans la même colonne.
//    ⚠️ Le TOL, lui, N'A PAS besoin de ce filet : il est calculé et stocké
//    chaque mois pour chaque employé selon sa zone (ville/périphérie...)
//    via CompanyTax — donc toujours présent automatiquement, jamais saisi
//    à la main. Seule la règle 3 (CTAX_TOL) s'applique pour lui.
//
//    En paie automatique (masse/individuelle), le code est fiable :
//      - 'ADVANCE'      → avance (généré par payroll-deductions.service)
//      - 'LOAN'         → prêt (jamais affiché ici, volontairement)
//
//    Pharmacie : le module CompanyDeduction (pharmacie, cantine, casse
//    matériel...) n'est PAS encore branché sur la génération automatique
//    de PayrollItem (vérifié dans payroll-generator/payrolls.service).
//    On lit donc CompanyDeduction directement (status DEDUCTED) en plus
//    des MANUAL_DEDUCTION libellées "pharmacie", et on additionne les deux
//    sources — elles sont mutuellement exclusives aujourd'hui. Le jour où
//    CompanyDeduction alimentera aussi un PayrollItem, il faudra dédupliquer
//    ici (ne garder qu'une des deux sources) pour ne pas compter en double.
//
// 3) TAXES CONFIGURABLES (CompanyTax) — matérialisées en PayrollItem avec
//    code = `CTAX_${tax.code}` et label = tax.name. On les répartit en 3
//    colonnes par mot-clé sur le nom/code de la taxe :
//      - TOL       (contient "TOL")
//      - TAXE DPT  (contient "DPT", "DEPART" ou "REGION" — "Taxe Régionale"
//                   et "Taxe Départementale" désignent la même chose selon
//                   l'appellation choisie par l'entreprise dans sa config)
//      - AUTRES    (tout le reste — additionnées ensemble, comme demandé)
//    ⚠️ Pas de logique figée sur "toujours en février" ni de montant par
//    défaut (2000F, 2400F...) : on lit simplement ce qui existe en base
//    pour le mois demandé — que ce soit payé une fois par an, tous les
//    mois, ou jamais. Si rien n'est enregistré, la colonne reste à 0 —
//    dès que l'entreprise saisit la vraie taxe (le mois où elle la paie
//    réellement, avec le vrai montant), elle apparaît automatiquement ici,
//    sans changement de code nécessaire.
//
// 4) NET A PAYER = Payroll.netSalary (source de vérité du bulletin réel,
//    déjà validée par payroll-calculator.service). On NE recalcule PAS
//    "S/TOTAL − retenues affichées" pour le net, car ce tableau n'affiche
//    volontairement pas toutes les retenues possibles (prêt, etc.) — les
//    reconstituer donnerait un faux total. On expose quand même l'écart
//    éventuel (`autresRetenuesNonDetaillees`) pour audit/transparence,
//    sans en faire une colonne du modèle Excel.
// ============================================================================

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ─── Types exposés à l'API ────────────────────────────────────────────────

export interface IndemniteColumn {
  key: string; // ex: 'TRANSPORT'
  label: string; // ex: 'Transport'
}

export interface RecapRow {
  employeeId: string;
  employeeName: string;
  matricule: string | null;

  // ✅ Statut du mois : 'PAYE' = bulletin généré normalement ; 'CONGE' =
  // aucun bulletin mais l'employé est en congé (approuvé) sur la période,
  // donc c'est normal de ne rien voir ; 'SANS_PAIE' = aucun bulletin ET
  // aucun congé trouvé → à vérifier, ça peut être un oubli.
  status: 'PAYE' | 'CONGE' | 'SANS_PAIE';
  leaveLabel?: string | null; // ex: "Congé maladie (12/07 → 28/07)"

  salBrut: number;
  cnss: number;
  irpp: number;
  reste1: number;

  indemnites: Record<string, number>; // clé = IndemniteColumn.key
  sousTotal: number;

  avance: number;
  pharmacie: number;
  tol: number;
  taxeDept: number;
  autresTaxes: number;

  netAPayer: number;
  // Écart informatif (prêt / autres retenues non représentées ici) —
  // permet de vérifier que sousTotal − (retenues affichées) ≠ net
  // n'est pas une erreur de calcul mais une retenue hors-périmètre.
  autresRetenuesNonDetaillees: number;

  // Uniquement renseigné côté récap ANNUEL : les mois de l'année où
  // l'employé était en congé / sans bulletin explicable, pour un coup
  // d'œil rapide sans devoir ouvrir chaque mois.
  moisEnConge?: number[];
  moisSansPaie?: number[];
}

export interface MonthlyRecap {
  month: number;
  year: number;
  indemniteColumns: IndemniteColumn[];
  rows: RecapRow[];
  totals: RecapRow;
}

export interface AnnualRecap {
  year: number;
  indemniteColumns: IndemniteColumn[];
  rows: RecapRow[];
  totals: RecapRow;
  monthlyTotals: { month: number; sousTotal: number; netAPayer: number }[];
}

// ─── Helpers de classification (mots-clés, sans dépendance externe) ───────

function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // retire les accents
    .toUpperCase()
    .trim();
}

const INDEMNITY_PATTERNS: { key: string; label: string; test: (n: string) => boolean }[] = [
  { key: 'TRANSPORT', label: 'Transport', test: (n) => n.includes('TRANSPORT') },
  { key: 'SALISSURE', label: 'Salissure', test: (n) => n.includes('SALISSURE') || n.includes('TENUE') },
  { key: 'PANIER', label: 'Panier', test: (n) => n.includes('PANIER') || n.includes('REPAS') || n.includes('NOURRITURE') },
  { key: 'LOGEMENT', label: 'Logement', test: (n) => n.includes('LOGEMENT') || n.includes('LOYER') },
];

function classifyIndemnite(label: string): { key: string; label: string } {
  const n = normalize(label);
  const known = INDEMNITY_PATTERNS.find((p) => p.test(n));
  return known ? { key: known.key, label: known.label } : { key: 'AUTRES', label: 'Autres' };
}

type DeductionBucket = 'AVANCE' | 'PHARMACIE' | 'TAXE_DPT' | 'IGNORE';

function classifyManualDeductionLabel(label: string): DeductionBucket {
  const n = normalize(label);
  if (n.includes('PHARMA')) return 'PHARMACIE';
  if (n.includes('AVANCE') || n.includes('QUINZAINE')) return 'AVANCE';
  // ⚠️ TOL n'a PAS besoin de ce filet de sécurité : elle est calculée et
  // stockée chaque mois pour chaque employé selon sa zone (ville/périphérie
  // etc.) via CompanyTax — donc toujours présente, jamais saisie à la main.
  // Seule la taxe régionale/départementale (payée une fois par an, pas
  // chaque mois) a besoin d'être aussi reconnue si elle est saisie en paie
  // manuelle plutôt que configurée en CompanyTax.
  if (n.includes('DPT') || n.includes('DEPART') || n.includes('REGION')) return 'TAXE_DPT';
  return 'IGNORE'; // prêt, cantine, casse matériel, etc. — hors périmètre ici
}

type TaxBucket = 'TOL' | 'TAXE_DPT' | 'AUTRES';

function classifyCompanyTax(label: string, code: string): TaxBucket {
  const n = normalize(`${code} ${label}`);
  if (n.includes('TOL')) return 'TOL';
  // "Taxe Départementale" et "Taxe Régionale" désignent la même chose selon
  // l'appellation utilisée par l'entreprise — même case, peu importe le mot
  // exact configuré dans CompanyTax.
  if (n.includes('DPT') || n.includes('DEPART') || n.includes('REGION')) return 'TAXE_DPT';
  return 'AUTRES';
}

// ─── Libellés des types de congé (pour l'affichage du statut CONGE) ──────

const LEAVE_TYPE_LABELS: Record<string, string> = {
  ANNUAL: 'Congé annuel',
  ANNUAL_ANTICIPATED: 'Congé anticipé',
  COMPENSATORY: 'Récupération',
  SICK: 'Congé maladie',
  MATERNITY: 'Congé maternité',
  PATERNITY: 'Congé paternité',
  UNPAID: 'Congé sans solde',
};

function fmtDate(d: Date): string {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function leaveLabel(leave: { type: string; startDate: Date; endDate: Date }): string {
  const typeLabel = LEAVE_TYPE_LABELS[leave.type] ?? 'Congé';
  return `${typeLabel} (${fmtDate(leave.startDate)} → ${fmtDate(leave.endDate)})`;
}

// ─── Ligne vide (pour init des totaux) ────────────────────────────────────

function emptyRow(
  employeeId = '',
  employeeName = '',
  matricule: string | null = null,
  status: RecapRow['status'] = 'PAYE',
  leaveLabelText: string | null = null,
): RecapRow {
  return {
    employeeId,
    employeeName,
    matricule,
    status,
    leaveLabel: leaveLabelText,
    salBrut: 0,
    cnss: 0,
    irpp: 0,
    reste1: 0,
    indemnites: {},
    sousTotal: 0,
    avance: 0,
    pharmacie: 0,
    tol: 0,
    taxeDept: 0,
    autresTaxes: 0,
    netAPayer: 0,
    autresRetenuesNonDetaillees: 0,
  };
}

function addInto(target: RecapRow, source: RecapRow) {
  target.salBrut += source.salBrut;
  target.cnss += source.cnss;
  target.irpp += source.irpp;
  target.reste1 += source.reste1;
  for (const [k, v] of Object.entries(source.indemnites)) {
    target.indemnites[k] = (target.indemnites[k] ?? 0) + v;
  }
  target.sousTotal += source.sousTotal;
  target.avance += source.avance;
  target.pharmacie += source.pharmacie;
  target.tol += source.tol;
  target.taxeDept += source.taxeDept;
  target.autresTaxes += source.autresTaxes;
  target.netAPayer += source.netAPayer;
  target.autresRetenuesNonDetaillees += source.autresRetenuesNonDetaillees;
  if (source.moisEnConge?.length) {
    target.moisEnConge = [...(target.moisEnConge ?? []), ...source.moisEnConge];
  }
  if (source.moisSansPaie?.length) {
    target.moisSansPaie = [...(target.moisSansPaie ?? []), ...source.moisSansPaie];
  }
}

@Injectable()
export class PayrollRecapService {
  constructor(private prisma: PrismaService) {}

  // ── Résolution companyId (même logique que ReportsService) ──────────────
  private async resolveCompanyId(userId: string, overrideCompanyId?: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true },
    });
    const isCabinet = user?.role === 'CABINET_ADMIN' || user?.role === 'CABINET_GESTIONNAIRE';
    return isCabinet && overrideCompanyId ? overrideCompanyId : (user?.companyId ?? null);
  }

  /**
   * ✅ Utilisé par le contrôleur pour l'en-tête du fichier Excel exporté
   * (nom de l'entreprise à afficher dans le sous-titre de la feuille).
   */
  async getCompanyName(userId: string, overrideCompanyId?: string): Promise<string> {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return 'Entreprise';
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { tradeName: true, legalName: true },
    });
    return company?.tradeName ?? company?.legalName ?? 'Entreprise';
  }

  // ══════════════════════════════════════════════════════════════════════
  // RÉCAP MENSUEL
  // ══════════════════════════════════════════════════════════════════════
  async getMonthlyRecap(
    userId: string,
    month: number,
    year: number,
    overrideCompanyId?: string,
  ): Promise<MonthlyRecap> {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) {
      return { month, year, indemniteColumns: [], rows: [], totals: emptyRow('TOTAL', 'TOTAL') };
    }

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0); // dernier jour du mois

    // ── Tous les employés présents dans l'entreprise sur cette période ──
    // (pas seulement ceux qui ont un bulletin) — on exclut l'INTERIM, qui
    // n'est jamais payé par cette entreprise (agence d'intérim), donc son
    // absence de bulletin n'est ni un congé ni une anomalie.
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        contractType: { not: 'INTERIM' },
        hireDate: { lte: monthEnd },
        OR: [{ terminationDate: null }, { terminationDate: { gte: monthStart } }],
      },
      select: { id: true, firstName: true, lastName: true, employeeNumber: true },
      orderBy: { lastName: 'asc' },
    });

    const payrolls = await this.prisma.payroll.findMany({
      where: { companyId, month, year, status: { not: 'CANCELLED' } },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeNumber: true },
        },
        items: true,
      },
    });
    const payrollByEmployee = new Map(payrolls.map((p) => [p.employeeId, p]));

    // Employés SANS bulletin ce mois-ci → on cherche s'ils sont en congé
    const employeesWithoutPayroll = employees.filter((e) => !payrollByEmployee.has(e.id));
    const leaves = employeesWithoutPayroll.length
      ? await this.prisma.leave.findMany({
          where: {
            employeeId: { in: employeesWithoutPayroll.map((e) => e.id) },
            status: 'APPROVED',
            startDate: { lte: monthEnd },
            endDate: { gte: monthStart },
          },
        })
      : [];
    const leaveByEmployee = new Map(leaves.map((l) => [l.employeeId, l]));

    // Pharmacie enregistrée hors circuit PayrollItem (cf. en-tête du fichier)
    const employeeIds = payrolls.map((p) => p.employeeId);
    const companyDeductions = employeeIds.length
      ? await this.prisma.companyDeduction.findMany({
          where: { employeeId: { in: employeeIds }, month, year, status: 'DEDUCTED' },
        })
      : [];
    const pharmacieByEmployee = new Map<string, number>();
    for (const d of companyDeductions) {
      if (classifyManualDeductionLabel(d.label) === 'PHARMACIE') {
        pharmacieByEmployee.set(d.employeeId, (pharmacieByEmployee.get(d.employeeId) ?? 0) + Number(d.amount));
      }
    }

    const { rows: paidRows, indemniteColumns } = this.buildRows(payrolls, pharmacieByEmployee);
    const paidRowByEmployee = new Map(paidRows.map((r) => [r.employeeId, r]));

    // ── Assemblage final : un employé = une ligne, payé ou non ──────────
    const rows: RecapRow[] = employees.map((e) => {
      const paidRow = paidRowByEmployee.get(e.id);
      if (paidRow) return paidRow;

      const leave = leaveByEmployee.get(e.id);
      const name = `${e.lastName} ${e.firstName}`.trim();
      if (leave) {
        return emptyRow(e.id, name, e.employeeNumber ?? null, 'CONGE', leaveLabel(leave));
      }
      return emptyRow(e.id, name, e.employeeNumber ?? null, 'SANS_PAIE');
    });

    const totals = emptyRow('TOTAL', 'TOTAL — MASSE SALARIALE');
    for (const row of rows) addInto(totals, row);

    return { month, year, indemniteColumns, rows, totals };
  }

  // ══════════════════════════════════════════════════════════════════════
  // RÉCAP ANNUEL — même structure, agrégée sur les 12 mois
  // ══════════════════════════════════════════════════════════════════════
  async getAnnualRecap(userId: string, year: number, overrideCompanyId?: string): Promise<AnnualRecap> {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) {
      return { year, indemniteColumns: [], rows: [], totals: emptyRow('TOTAL', 'TOTAL'), monthlyTotals: [] };
    }

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    // Tous les employés présents au moins un jour dans l'année (hors intérim)
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        contractType: { not: 'INTERIM' },
        hireDate: { lte: yearEnd },
        OR: [{ terminationDate: null }, { terminationDate: { gte: yearStart } }],
      },
      select: { id: true, firstName: true, lastName: true, employeeNumber: true },
      orderBy: { lastName: 'asc' },
    });
    const employeeIds = employees.map((e) => e.id);

    const payrolls = await this.prisma.payroll.findMany({
      where: { companyId, year, status: { not: 'CANCELLED' } },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeNumber: true },
        },
        items: true,
      },
      orderBy: [{ employee: { lastName: 'asc' } }, { month: 'asc' }],
    });

    const companyDeductions = employeeIds.length
      ? await this.prisma.companyDeduction.findMany({
          where: { employeeId: { in: employeeIds }, year, status: 'DEDUCTED' },
        })
      : [];
    // Pour l'annuel on cumule la pharmacie par employé (peu importe le mois)
    const pharmacieByEmployee = new Map<string, number>();
    for (const d of companyDeductions) {
      if (classifyManualDeductionLabel(d.label) === 'PHARMACIE') {
        pharmacieByEmployee.set(d.employeeId, (pharmacieByEmployee.get(d.employeeId) ?? 0) + Number(d.amount));
      }
    }

    // Congés approuvés sur l'année, pour expliquer les mois sans bulletin
    const leaves = employeeIds.length
      ? await this.prisma.leave.findMany({
          where: {
            employeeId: { in: employeeIds },
            status: 'APPROVED',
            startDate: { lte: yearEnd },
            endDate: { gte: yearStart },
          },
        })
      : [];

    // 1) Bulletins groupés par employé
    const payrollsByEmployee = new Map<string, typeof payrolls>();
    for (const p of payrolls) {
      const list = payrollsByEmployee.get(p.employeeId) ?? [];
      list.push(p);
      payrollsByEmployee.set(p.employeeId, list);
    }

    const indemniteKeys = new Map<string, string>(); // key -> label
    const rows: RecapRow[] = [];

    for (const e of employees) {
      const empPayrolls = payrollsByEmployee.get(e.id) ?? [];
      const { rows: monthRows, indemniteColumns } = this.buildRows(empPayrolls, new Map());
      for (const c of indemniteColumns) indemniteKeys.set(c.key, c.label);

      const name = `${e.lastName} ${e.firstName}`.trim();
      const yearRow = emptyRow(e.id, name, e.employeeNumber ?? null);
      for (const r of monthRows) addInto(yearRow, r);
      yearRow.pharmacie += pharmacieByEmployee.get(e.id) ?? 0;

      // Mois sans bulletin → congé ou anomalie, mois par mois
      const paidMonths = new Set(empPayrolls.map((p) => p.month));
      const moisEnConge: number[] = [];
      const moisSansPaie: number[] = [];
      for (let m = 1; m <= 12; m++) {
        if (paidMonths.has(m)) continue;
        const mStart = new Date(year, m - 1, 1);
        const mEnd = new Date(year, m, 0);
        const onLeave = leaves.some(
          (l) => l.employeeId === e.id && l.startDate <= mEnd && l.endDate >= mStart,
        );
        if (onLeave) moisEnConge.push(m);
        else moisSansPaie.push(m);
      }
      if (moisEnConge.length) yearRow.moisEnConge = moisEnConge;
      if (moisSansPaie.length) yearRow.moisSansPaie = moisSansPaie;
      // Un employé sans aucun bulletin de toute l'année et sans congé nulle
      // part → probablement un employé pas encore actif sur la paie ; on
      // le signale via le statut au lieu de laisser une ligne à zéro muette.
      if (empPayrolls.length === 0) {
        yearRow.status = moisEnConge.length === 12 ? 'CONGE' : 'SANS_PAIE';
      }

      rows.push(yearRow);
    }

    const indemniteColumns: IndemniteColumn[] = Array.from(indemniteKeys.entries()).map(([key, label]) => ({ key, label }));

    const totals = emptyRow('TOTAL', 'TOTAL — MASSE SALARIALE');
    for (const row of rows) addInto(totals, row);

    // 2) Totaux par mois (pour un petit graphe d'évolution si besoin)
    const monthlyTotals: { month: number; sousTotal: number; netAPayer: number }[] = [];
    for (let m = 1; m <= 12; m++) {
      const monthPayrolls = payrolls.filter((p) => p.month === m);
      if (monthPayrolls.length === 0) continue;
      const { rows: mRows } = this.buildRows(monthPayrolls, new Map());
      const sousTotal = mRows.reduce((s, r) => s + r.sousTotal, 0);
      const netAPayer = mRows.reduce((s, r) => s + r.netAPayer, 0);
      monthlyTotals.push({ month: m, sousTotal, netAPayer });
    }

    return { year, indemniteColumns, rows, totals, monthlyTotals };
  }

  // ══════════════════════════════════════════════════════════════════════
  // CONSTRUCTION DES LIGNES À PARTIR DES PAYROLLS + LEURS PAYROLL_ITEMS
  // ══════════════════════════════════════════════════════════════════════
  private buildRows(
    payrolls: Array<{
      employeeId: string;
      grossSalary: any;
      cnssSalarial: any;
      its: any;
      netSalary: any;
      employee: { id: string; firstName: string; lastName: string; employeeNumber: string | null };
      items: Array<{ type: string; code: string | null; label: string; amount: any; isTaxable: boolean; isCnss: boolean }>;
    }>,
    pharmacieByEmployee: Map<string, number>,
  ): { rows: RecapRow[]; indemniteColumns: IndemniteColumn[] } {
    const indemniteKeys = new Map<string, string>();
    const rows: RecapRow[] = [];

    for (const p of payrolls) {
      const row = emptyRow(
        p.employeeId,
        `${p.employee.lastName} ${p.employee.firstName}`.trim(),
        p.employee.employeeNumber ?? null,
      );

      row.salBrut = Number(p.grossSalary);
      row.cnss = Number(p.cnssSalarial);
      row.irpp = Number(p.its);
      row.reste1 = row.salBrut - row.cnss - row.irpp;

      let indemnitesTotal = 0;
      let avance = 0;
      let tol = 0;
      let taxeDept = 0;
      let autresTaxes = 0;
      let autresRetenues = 0; // prêt + retenues manuelles non classées

      for (const item of p.items) {
        // ── 1) INDEMNITÉS : GAIN non-taxable + non-CNSS ────────────────
        if (item.type === 'GAIN' && item.isTaxable === false && item.isCnss === false) {
          const { key, label } = classifyIndemnite(item.label);
          indemniteKeys.set(key, label);
          row.indemnites[key] = (row.indemnites[key] ?? 0) + Number(item.amount);
          indemnitesTotal += Number(item.amount);
          continue;
        }

        if (item.type !== 'DEDUCTION') continue;

        // ── 2) TAXES CONFIGURABLES (CTAX_xxx) ──────────────────────────
        if (item.code?.startsWith('CTAX_')) {
          const bucket = classifyCompanyTax(item.label, item.code);
          const amt = Number(item.amount);
          if (bucket === 'TOL') tol += amt;
          else if (bucket === 'TAXE_DPT') taxeDept += amt;
          else autresTaxes += amt;
          continue;
        }

        // ── 3) AVANCE (génération automatique) ─────────────────────────
        if (item.code === 'ADVANCE') {
          avance += Number(item.amount);
          continue;
        }

        // ── 4) PRÊT — jamais affiché ici, mais compté dans l'écart ─────
        if (item.code === 'LOAN') {
          autresRetenues += Number(item.amount);
          continue;
        }

        // ── 5) PAIE MANUELLE : retenue libre à classer par mot-clé ──────
        if (item.code === 'MANUAL_DEDUCTION') {
          const bucket = classifyManualDeductionLabel(item.label);
          const amt = Number(item.amount);
          if (bucket === 'AVANCE') avance += amt;
          else if (bucket === 'PHARMACIE') {
            // Seulement si pas déjà comptée via CompanyDeduction pour ce
            // mois — évite un double comptage si les deux circuits sont
            // utilisés en parallèle un jour.
            if (!pharmacieByEmployee.has(p.employeeId)) row.pharmacie += amt;
          } else if (bucket === 'TAXE_DPT') {
            // La taxe régionale/départementale se paie une fois par an,
            // contrairement au TOL (mensuel, toujours via CompanyTax) — si
            // elle n'est pas configurée, elle passe souvent par une saisie
            // manuelle ponctuelle. On la récupère ici plutôt que de la
            // perdre dans "autres retenues non détaillées".
            taxeDept += amt;
          } else autresRetenues += amt; // prêt libellé, cantine, casse matériel...
          continue;
        }

        // Tout autre code de déduction non reconnu → écart, pas affiché
        autresRetenues += Number(item.amount);
      }

      row.sousTotal = row.reste1 + indemnitesTotal;
      row.avance = avance;
      row.tol = tol;
      row.taxeDept = taxeDept;
      row.autresTaxes = autresTaxes;
      row.pharmacie += pharmacieByEmployee.get(p.employeeId) ?? 0;
      row.netAPayer = Number(p.netSalary);
      row.autresRetenuesNonDetaillees = autresRetenues;

      rows.push(row);
    }

    const indemniteColumns: IndemniteColumn[] = Array.from(indemniteKeys.entries()).map(([key, label]) => ({ key, label }));
    return { rows, indemniteColumns };
  }
}