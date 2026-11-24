// ============================================================================
// 📁 src/payroll-journal/payroll-journal.service.ts
// ✅ JOURNAL DE PAIE — lecture seule. N'écrit RIEN et ne recalcule RIEN :
//    toutes les valeurs viennent des bulletins déjà générés (Payroll +
//    PayrollItem) — donc identiques au bulletin, quel que soit le mois
//    (y compris les mois passés). Seule la paie ÉTRANGÈRE des expatriés
//    (PayrollForeignPay, saisie manuelle en FCFA) vient d'ailleurs.
//
// ORDRE DES LIGNES : du plus payé au moins payé (brut total décroissant =
// brut Congo + brut étranger), puis ordre alphabétique en cas d'égalité.
//
// COLONNES DYNAMIQUES (jamais de colonne vide inutile) :
//   • primes         → une colonne par prime configurée ET réellement payée
//                      ce mois-là (le montant peut varier d'un mois à l'autre)
//   • ancienneté     → colonne dédiée, seulement si au moins un employé en a
//   • congés         → indemnité de congé / congé supplémentaire, si présents
//   • heures sup     → seulement si l'entreprise les a activées
//                      (PayrollSettings.overtimeEnabled) ET qu'il y en a
//   • absences       → déductions d'absence, si présentes
//   • taxes          → une colonne par taxe salarié configurée (CAMU, TOL...)
//   • indemnités     → primes non imposables / non CNSS (transport, panier...)
//                      affichées APRÈS les charges, comme sur la feuille de
//                      paie papier
//   • retenues       → prêt, avance, autres retenues (si présentes)
//
// BRUT / NET CONGO = Payroll.grossSalary / Payroll.netSalary (source de
// vérité du bulletin). TOTAL = Congo + étranger.
// ============================================================================
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveVerifiedCompanyId } from '../common/resolve-verified-company.util';
import { ForeignPayView, toForeignPayView } from './payroll-foreign-pay.service';

// ─── Types exposés à l'API (le front doit rester le miroir de ceci) ────────

export interface JournalColumn {
  key: string;
  label: string;
}

export interface JournalRow {
  rank: number;
  employeeId: string;
  employeeName: string;
  matricule: string | null;
  position: string;
  departmentName: string;
  contractType: string;
  payrollId: string | null;
  payrollStatus: string | null;
  /** 'PAYE' = bulletin Congo existant ; 'ETRANGER_SEUL' = seulement une paie étrangère saisie */
  status: 'PAYE' | 'ETRANGER_SEUL';

  // ── Congo ──
  baseSalary: number;
  primes: Record<string, number>; // clé = JournalColumn.key (primes imposables)
  anciennete: number;
  conges: number;
  overtime: number;
  absences: number; // montant déduit (positif)
  grossCongo: number;

  cnss: number;
  its: number;
  itsLabel: string; // "ITS" ou "BNC" selon le bulletin
  taxes: Record<string, number>;

  indemnites: Record<string, number>; // non imposables, après les charges

  loan: number;
  advance: number;
  otherDeductions: number;
  netCongo: number;

  // ── Étranger (saisie manuelle) ──
  isExpat: boolean;
  foreign: ForeignPayView[];
  foreignGross: number;
  foreignNet: number;

  // ── Total Congo + étranger ──
  totalGross: number;
  totalNet: number;
}

export interface JournalTotals {
  baseSalary: number;
  primes: Record<string, number>;
  anciennete: number;
  conges: number;
  overtime: number;
  absences: number;
  grossCongo: number;
  cnss: number;
  its: number;
  taxes: Record<string, number>;
  indemnites: Record<string, number>;
  loan: number;
  advance: number;
  otherDeductions: number;
  netCongo: number;
  foreignGross: number;
  foreignNet: number;
  totalGross: number;
  totalNet: number;
}

export interface PayrollJournal {
  month: number;
  year: number;
  generatedAt: string;
  company: {
    id: string;
    name: string;
    legalName: string;
    legalForm: string | null;
    logo: string | null;
    address: string;
    city: string;
    phone: string;
    email: string;
    rccm: string;
    cnssNumber: string | null;
    taxNumber: string | null;
    primaryColor: string;
  };
  options: {
    overtimeEnabled: boolean;
    showOvertime: boolean;
    showAnciennete: boolean;
    showConges: boolean;
    showAbsences: boolean;
    showLoan: boolean;
    showAdvance: boolean;
    showOtherDeductions: boolean;
    hasExpat: boolean;
  };
  columns: {
    primes: JournalColumn[];
    taxes: JournalColumn[];
    indemnites: JournalColumn[];
  };
  rows: JournalRow[];
  totals: JournalTotals;
  summary: {
    headcount: number;
    expatCount: number;
    grossCongo: number;
    netCongo: number;
    foreignGross: number;
    foreignNet: number;
    totalGross: number;
    totalNet: number;
    cnssSalarial: number;
    its: number;
    customTaxes: number;
    retenues: number; // prêt + avance + autres
    totalChargesCongo: number; // CNSS + impôt + taxes
    cnssEmployer: number;
    employerCostCongo: number; // coût employeur Congo (bulletins)
    totalCompanyCost: number; // coût employeur Congo + brut étranger
    avgGrossCongo: number;
    avgNetCongo: number;
    netToGrossRatio: number; // net Congo / brut Congo (0-100)
    chargesRatio: number; // charges Congo / brut Congo (0-100)
    foreignShare: number; // part de l'étranger dans le brut total (0-100)
  };
  charts: {
    distribution: { label: string; value: number }[]; // où va l'argent (Congo net / charges / retenues / étranger net)
    grossToNet: { label: string; value: number }[]; // brut → charges → retenues → net
    topEarners: { name: string; totalNet: number; totalGross: number }[];
    byDepartment: {
      name: string;
      headcount: number;
      totalGross: number;
      totalNet: number;
    }[];
    byCountry: {
      countryCode: string;
      countryName: string;
      headcount: number;
      gross: number;
      net: number;
    }[];
    chargesBreakdown: { label: string; value: number }[];
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

const normalize = (s: string | null | undefined): string =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const OVERTIME_CODES = new Set(['HS_10', 'HS_25', 'HS_50', 'HS_100']);
const LEAVE_GAIN_CODES = new Set(['INDEM_CONGE', 'CONGE_SUPP']);
const ABSENCE_CODES = new Set(['ABS_DEDUCT', 'ABS_CONGE']);

const sumInto = (target: Record<string, number>, src: Record<string, number>) => {
  for (const [k, v] of Object.entries(src)) target[k] = (target[k] ?? 0) + v;
};

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

@Injectable()
export class PayrollJournalService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveCompanyId(
    userId: string,
    overrideCompanyId?: string,
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        companyId: true,
        role: true,
        manageMultipleCompanies: true,
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    const companyId = await resolveVerifiedCompanyId(
      this.prisma,
      user,
      overrideCompanyId,
    );
    if (!companyId) throw new NotFoundException('Entreprise introuvable.');
    return companyId;
  }

  async getJournal(
    userId: string,
    month: number,
    year: number,
    overrideCompanyId?: string,
  ): Promise<PayrollJournal> {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);

    const [company, settings, payrolls, foreignRows] = await Promise.all([
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          legalName: true,
          tradeName: true,
          legalForm: true,
          logo: true,
          address: true,
          city: true,
          phone: true,
          email: true,
          rccmNumber: true,
          cnssNumber: true,
          taxNumber: true,
          primaryColor: true,
        },
      }),
      this.prisma.payrollSettings.findFirst({
        where: { companyId },
        orderBy: { effectiveDate: 'desc' },
        select: { overtimeEnabled: true },
      }),
      this.prisma.payroll.findMany({
        where: { companyId, month, year, status: { not: 'CANCELLED' } },
        include: {
          items: true,
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeNumber: true,
              position: true,
              contractType: true,
              department: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.payrollForeignPay.findMany({
        where: { companyId, month, year },
        orderBy: { countryCode: 'asc' },
      }),
    ]);
    if (!company) throw new NotFoundException('Entreprise introuvable.');

    const overtimeEnabled = (settings as any)?.overtimeEnabled !== false;

    // ── Paies étrangères regroupées par employé ──
    const foreignByEmployee = new Map<string, ForeignPayView[]>();
    for (const f of foreignRows) {
      const list = foreignByEmployee.get(f.employeeId) ?? [];
      list.push(toForeignPayView(f));
      foreignByEmployee.set(f.employeeId, list);
    }

    // ── Employés qui ont une paie étrangère mais PAS de bulletin Congo ──
    const payrollEmployeeIds = new Set(payrolls.map((p) => p.employeeId));
    const foreignOnlyIds = [...foreignByEmployee.keys()].filter(
      (id) => !payrollEmployeeIds.has(id),
    );
    const foreignOnlyEmployees = foreignOnlyIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: foreignOnlyIds }, companyId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
            position: true,
            contractType: true,
            department: { select: { name: true } },
          },
        })
      : [];

    // ── Colonnes dynamiques ──
    const primeCols = new Map<string, string>();
    const taxCols = new Map<string, string>();
    const indemCols = new Map<string, string>();

    const rows: JournalRow[] = [];

    for (const p of payrolls) {
      const emp = p.employee;
      const primes: Record<string, number> = {};
      const taxes: Record<string, number> = {};
      const indemnites: Record<string, number> = {};
      let anciennete = 0;
      let conges = 0;
      let overtime = 0;
      let absences = 0;
      let baseSalary = 0;
      let cnss = 0;
      let its = 0;
      let itsLabel = 'ITS';
      let loan = 0;
      let advance = 0;
      let otherDeductions = 0;

      for (const it of p.items) {
        const code = it.code ?? '';
        const amount = n(it.amount);
        if (it.type === 'GAIN') {
          if (code === 'SAL_BASE') {
            baseSalary += amount;
          } else if (OVERTIME_CODES.has(code)) {
            overtime += amount;
          } else if (LEAVE_GAIN_CODES.has(code)) {
            conges += amount;
          } else if (normalize(it.label).includes('ANCIENNET')) {
            anciennete += amount;
          } else {
            const key = normalize(it.label) || code;
            if (!it.isTaxable && !it.isCnss) {
              indemnites[key] = (indemnites[key] ?? 0) + amount;
              if (!indemCols.has(key)) indemCols.set(key, it.label);
            } else {
              primes[key] = (primes[key] ?? 0) + amount;
              if (!primeCols.has(key)) primeCols.set(key, it.label);
            }
          }
        } else if (it.type === 'DEDUCTION') {
          if (ABSENCE_CODES.has(code)) {
            absences += amount;
          } else if (code === 'CNSS_SAL') {
            cnss += amount;
          } else if (code === 'ITS' || code === 'BNC_SOURCE') {
            its += amount;
            itsLabel = code === 'BNC_SOURCE' ? 'BNC' : 'ITS';
          } else if (code.startsWith('CTAX_') && !code.startsWith('CTAX_EMP_')) {
            taxes[code] = (taxes[code] ?? 0) + amount;
            if (!taxCols.has(code)) taxCols.set(code, it.label);
          } else if (code === 'LOAN') {
            loan += amount;
          } else if (code === 'ADVANCE') {
            advance += amount;
          } else {
            // COMPANY_DEDUCTION, MANUAL_DEDUCTION et toute autre retenue
            otherDeductions += amount;
          }
        }
        // EMPLOYER_COST / INFO : ignorés (hors feuille de paie salarié)
      }

      const foreign = foreignByEmployee.get(emp.id) ?? [];
      const foreignGross = foreign.reduce((s, f) => s + f.grossAmount, 0);
      const foreignNet = foreign.reduce((s, f) => s + f.netAmount, 0);
      const grossCongo = n(p.grossSalary);
      const netCongo = n(p.netSalary);

      rows.push({
        rank: 0,
        employeeId: emp.id,
        employeeName: `${emp.lastName} ${emp.firstName}`.trim(),
        matricule: emp.employeeNumber ?? null,
        position: emp.position ?? '',
        departmentName: emp.department?.name ?? '—',
        contractType: String(emp.contractType),
        payrollId: p.id,
        payrollStatus: String(p.status),
        status: 'PAYE',
        baseSalary,
        primes,
        anciennete,
        conges,
        overtime,
        absences,
        grossCongo,
        cnss,
        its,
        itsLabel,
        taxes,
        indemnites,
        loan,
        advance,
        otherDeductions,
        netCongo,
        isExpat: foreign.length > 0,
        foreign,
        foreignGross,
        foreignNet,
        totalGross: grossCongo + foreignGross,
        totalNet: netCongo + foreignNet,
      });
    }

    for (const emp of foreignOnlyEmployees) {
      const foreign = foreignByEmployee.get(emp.id) ?? [];
      const foreignGross = foreign.reduce((s, f) => s + f.grossAmount, 0);
      const foreignNet = foreign.reduce((s, f) => s + f.netAmount, 0);
      rows.push({
        rank: 0,
        employeeId: emp.id,
        employeeName: `${emp.lastName} ${emp.firstName}`.trim(),
        matricule: emp.employeeNumber ?? null,
        position: emp.position ?? '',
        departmentName: emp.department?.name ?? '—',
        contractType: String(emp.contractType),
        payrollId: null,
        payrollStatus: null,
        status: 'ETRANGER_SEUL',
        baseSalary: 0,
        primes: {},
        anciennete: 0,
        conges: 0,
        overtime: 0,
        absences: 0,
        grossCongo: 0,
        cnss: 0,
        its: 0,
        itsLabel: 'ITS',
        taxes: {},
        indemnites: {},
        loan: 0,
        advance: 0,
        otherDeductions: 0,
        netCongo: 0,
        isExpat: true,
        foreign,
        foreignGross,
        foreignNet,
        totalGross: foreignGross,
        totalNet: foreignNet,
      });
    }

    // ── Tri : du plus payé au moins payé ──
    rows.sort(
      (a, b) =>
        b.totalGross - a.totalGross ||
        a.employeeName.localeCompare(b.employeeName, 'fr'),
    );
    rows.forEach((r, i) => (r.rank = i + 1));

    // ── Totaux ──
    const totals: JournalTotals = {
      baseSalary: 0,
      primes: {},
      anciennete: 0,
      conges: 0,
      overtime: 0,
      absences: 0,
      grossCongo: 0,
      cnss: 0,
      its: 0,
      taxes: {},
      indemnites: {},
      loan: 0,
      advance: 0,
      otherDeductions: 0,
      netCongo: 0,
      foreignGross: 0,
      foreignNet: 0,
      totalGross: 0,
      totalNet: 0,
    };
    for (const r of rows) {
      totals.baseSalary += r.baseSalary;
      sumInto(totals.primes, r.primes);
      totals.anciennete += r.anciennete;
      totals.conges += r.conges;
      totals.overtime += r.overtime;
      totals.absences += r.absences;
      totals.grossCongo += r.grossCongo;
      totals.cnss += r.cnss;
      totals.its += r.its;
      sumInto(totals.taxes, r.taxes);
      sumInto(totals.indemnites, r.indemnites);
      totals.loan += r.loan;
      totals.advance += r.advance;
      totals.otherDeductions += r.otherDeductions;
      totals.netCongo += r.netCongo;
      totals.foreignGross += r.foreignGross;
      totals.foreignNet += r.foreignNet;
      totals.totalGross += r.totalGross;
      totals.totalNet += r.totalNet;
    }

    // ── Indicateurs ──
    const customTaxes = Object.values(totals.taxes).reduce((s, v) => s + v, 0);
    const retenues = totals.loan + totals.advance + totals.otherDeductions;
    const totalChargesCongo = totals.cnss + totals.its + customTaxes;
    const paidRows = rows.filter((r) => r.status === 'PAYE');
    const expatRows = rows.filter((r) => r.isExpat);

    const cnssEmployer = payrolls.reduce((s, p) => s + n(p.cnssEmployer), 0);
    const employerCostCongo = payrolls.reduce(
      (s, p) => s + n(p.totalEmployerCost),
      0,
    );

    // Graphique "brut → net" (Congo) : ce qui reste après chaque étape
    const grossToNet = [
      { label: 'Brut Congo', value: totals.grossCongo },
      { label: 'Charges (CNSS, impôt, taxes)', value: totalChargesCongo },
      { label: 'Retenues (prêt, avance...)', value: retenues },
      { label: 'Net Congo', value: totals.netCongo },
    ];

    const distribution = [
      { label: 'Net payé au Congo', value: totals.netCongo },
      { label: 'Charges salariales', value: totalChargesCongo },
      { label: 'Retenues', value: retenues },
      { label: 'Net payé à l\'étranger', value: totals.foreignNet },
    ].filter((d) => d.value > 0);

    const topEarners = rows.slice(0, 8).map((r) => ({
      name: r.employeeName,
      totalNet: r.totalNet,
      totalGross: r.totalGross,
    }));

    const deptMap = new Map<
      string,
      { name: string; headcount: number; totalGross: number; totalNet: number }
    >();
    for (const r of rows) {
      const d = deptMap.get(r.departmentName) ?? {
        name: r.departmentName,
        headcount: 0,
        totalGross: 0,
        totalNet: 0,
      };
      d.headcount += 1;
      d.totalGross += r.totalGross;
      d.totalNet += r.totalNet;
      deptMap.set(r.departmentName, d);
    }
    const byDepartment = [...deptMap.values()].sort(
      (a, b) => b.totalGross - a.totalGross,
    );

    const countryMap = new Map<
      string,
      {
        countryCode: string;
        countryName: string;
        employees: Set<string>;
        gross: number;
        net: number;
      }
    >();
    for (const f of foreignRows) {
      const c = countryMap.get(f.countryCode) ?? {
        countryCode: f.countryCode,
        countryName: f.countryName,
        employees: new Set<string>(),
        gross: 0,
        net: 0,
      };
      c.employees.add(f.employeeId);
      c.gross += n(f.grossAmount);
      c.net += n(f.netAmount);
      countryMap.set(f.countryCode, c);
    }
    const byCountry = [...countryMap.values()]
      .map((c) => ({
        countryCode: c.countryCode,
        countryName: c.countryName,
        headcount: c.employees.size,
        gross: c.gross,
        net: c.net,
      }))
      .sort((a, b) => b.gross - a.gross);

    const chargesBreakdown = [
      { label: 'CNSS salarié', value: totals.cnss },
      { label: 'ITS / BNC', value: totals.its },
      ...[...taxCols.entries()].map(([code, label]) => ({
        label,
        value: totals.taxes[code] ?? 0,
      })),
    ].filter((c) => c.value > 0);

    const toCols = (m: Map<string, string>): JournalColumn[] =>
      [...m.entries()].map(([key, label]) => ({ key, label }));

    return {
      month,
      year,
      generatedAt: new Date().toISOString(),
      company: {
        id: company.id,
        name: company.tradeName || company.legalName,
        legalName: company.legalName,
        legalForm: company.legalForm ?? null,
        logo: company.logo ?? null,
        address: company.address,
        city: company.city,
        phone: company.phone,
        email: company.email,
        rccm: company.rccmNumber,
        cnssNumber: company.cnssNumber ?? null,
        taxNumber: company.taxNumber ?? null,
        primaryColor: company.primaryColor,
      },
      options: {
        overtimeEnabled,
        // Heures sup : seulement si l'entreprise les a activées ET qu'il y en a
        showOvertime: overtimeEnabled && totals.overtime > 0,
        showAnciennete: totals.anciennete > 0,
        showConges: totals.conges > 0,
        showAbsences: totals.absences > 0,
        showLoan: totals.loan > 0,
        showAdvance: totals.advance > 0,
        showOtherDeductions: totals.otherDeductions > 0,
        hasExpat: expatRows.length > 0,
      },
      columns: {
        primes: toCols(primeCols),
        taxes: toCols(taxCols),
        indemnites: toCols(indemCols),
      },
      rows,
      totals,
      summary: {
        headcount: rows.length,
        expatCount: expatRows.length,
        grossCongo: totals.grossCongo,
        netCongo: totals.netCongo,
        foreignGross: totals.foreignGross,
        foreignNet: totals.foreignNet,
        totalGross: totals.totalGross,
        totalNet: totals.totalNet,
        cnssSalarial: totals.cnss,
        its: totals.its,
        customTaxes,
        retenues,
        totalChargesCongo,
        cnssEmployer,
        employerCostCongo,
        totalCompanyCost: employerCostCongo + totals.foreignGross,
        avgGrossCongo: paidRows.length
          ? Math.round(totals.grossCongo / paidRows.length)
          : 0,
        avgNetCongo: paidRows.length
          ? Math.round(totals.netCongo / paidRows.length)
          : 0,
        netToGrossRatio: pct(totals.netCongo, totals.grossCongo),
        chargesRatio: pct(totalChargesCongo, totals.grossCongo),
        foreignShare: pct(totals.foreignGross, totals.totalGross),
      },
      charts: {
        distribution,
        grossToNet,
        topEarners,
        byDepartment,
        byCountry,
        chargesBreakdown,
      },
    };
  }
}