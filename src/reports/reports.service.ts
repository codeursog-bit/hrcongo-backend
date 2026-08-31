// ============================================================================
// 📁 src/reports/reports.service.ts
// ✅ CONFORME DÉCRET 78-360 : heures sup 10/25/50/100
// ✅ Multi-PME : overrideCompanyId pour rôles cabinet
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConventionsService,
  ConventionCategory,
} from '../conventions/conventions.service';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private conventionsService: ConventionsService,
  ) {}

  // ─── Résolution du companyId (PME directe ou cabinet) ────────────────────
  private async resolveCompanyId(
    userId: string,
    overrideCompanyId?: string,
  ): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true },
    });
    const isCabinet =
      user?.role === 'CABINET_ADMIN' || user?.role === 'CABINET_GESTIONNAIRE';
    return isCabinet && overrideCompanyId
      ? overrideCompanyId
      : (user?.companyId ?? null);
  }

  // ============================================================
  // VUE D'ENSEMBLE
  // ============================================================
  async getOverview(userId: string, overrideCompanyId?: string) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return {};

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    const headcount = await this.prisma.employee.count({
      where: { companyId, status: 'ACTIVE' },
    });

    const payrollSum = await this.prisma.payroll.aggregate({
      where: { companyId, month: currentMonth, year: currentYear },
      _sum: { grossSalary: true, netSalary: true, totalEmployerCost: true },
    });

    const activeLeaves = await this.prisma.leave.count({
      where: { companyId, status: 'APPROVED' },
    });

    const departments = await this.prisma.department.findMany({
      where: { companyId },
      include: { _count: { select: { employees: true } } },
    });

    const deptDistribution = departments.map((d) => ({
      name: d.name,
      value: d._count.employees,
      color: d.color || '#' + Math.floor(Math.random() * 16777215).toString(16),
    }));

    const trend = await this.prisma.payroll.groupBy({
      by: ['month'],
      where: { companyId, year: currentYear },
      _sum: { grossSalary: true, netSalary: true, totalEmployerCost: true },
      orderBy: { month: 'asc' },
      take: 6,
    });

    const salaryTrend = trend.map((t) => ({
      month: new Date(0, t.month - 1).toLocaleString('fr-FR', {
        month: 'short',
      }),
      brut: Number(t._sum.grossSalary || 0) / 1_000_000,
      net: Number(t._sum.netSalary || 0) / 1_000_000,
      charges:
        (Number(t._sum.totalEmployerCost || 0) -
          Number(t._sum.grossSalary || 0)) /
        1_000_000,
    }));

    return {
      headcount,
      payrollTotal: payrollSum._sum.grossSalary || 0,
      activeLeaves,
      deptDistribution,
      salaryTrend,
    };
  }

  // ============================================================
  // ÉVOLUTION PLURIANNUELLE — "comment était l'entreprise il y a 2 ans,
  // 5 ans, de 2020 à 2022..." — utilisé par le filtre "Plage d'années"
  // disponible sur les pages de rapports. Un point par ANNÉE (pas par
  // mois), sur la plage demandée, avec le détail brut / net / charges
  // patronales / charges salariales pour voir précisément ce qui monte
  // ou baisse d'une année à l'autre.
  //
  // - Si `month` est fourni : compare CE mois précis d'une année à
  //   l'autre (ex: "chaque août depuis 2020").
  // - Sinon : compare le CUMUL de l'année entière (les 12 mois).
  // ============================================================
  async getYearlyTrend(
    userId: string,
    yearFrom: number,
    yearTo: number,
    month?: number,
    overrideCompanyId?: string,
  ) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return { years: [] };

    // Garde-fous : plage raisonnable (max 20 ans), ordre correct.
    const from = Math.min(yearFrom, yearTo);
    const to = Math.max(yearFrom, yearTo);
    const safeTo = Math.min(to, from + 20);

    const years: {
      year: number;
      effectif: number;
      brut: number;
      net: number;
      chargesSalariales: number; // CNSS salarié (4%) + IRPP retenus au salarié
      chargesPatronales: number; // CNSS employeur + TUS + autres charges employeur
      coutTotalEmployeur: number; // brut + charges patronales (= totalEmployerCost)
    }[] = [];

    for (let year = from; year <= safeTo; year++) {
      const where = month
        ? { companyId, year, month, status: { not: 'CANCELLED' as const } }
        : { companyId, year, status: { not: 'CANCELLED' as const } };

      const agg = await this.prisma.payroll.aggregate({
        where,
        _sum: {
          grossSalary: true,
          netSalary: true,
          cnssSalarial: true,
          its: true,
          totalEmployerCost: true,
        },
      });

      // Effectif distinct sur la période (nb d'employés ayant eu au moins
      // un bulletin cette année/ce mois) — pas juste l'effectif ACTUEL,
      // pour refléter fidèlement l'année passée même si des gens sont
      // partis depuis.
      const effectif = await this.prisma.payroll
        .findMany({ where, select: { employeeId: true }, distinct: ['employeeId'] })
        .then((rows) => rows.length);

      const brut = Number(agg._sum.grossSalary || 0);
      const net = Number(agg._sum.netSalary || 0);
      const coutTotalEmployeur = Number(agg._sum.totalEmployerCost || 0);
      const chargesSalariales = Number(agg._sum.cnssSalarial || 0) + Number(agg._sum.its || 0);
      const chargesPatronales = coutTotalEmployeur - brut;

      years.push({
        year,
        effectif,
        brut,
        net,
        chargesSalariales,
        chargesPatronales,
        coutTotalEmployeur,
      });
    }

    return { yearFrom: from, yearTo: safeTo, month: month ?? null, years };
  }

  // ============================================================
  // ANALYSE PAIE
  // ============================================================
  async getPayrollAnalysis(userId: string, overrideCompanyId?: string) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return {};

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    const totalPayroll = await this.prisma.payroll.aggregate({
      where: { companyId, month: currentMonth, year: currentYear },
      _sum: {
        grossSalary: true,
        netSalary: true,
        cnssSalarial: true,
        cnssEmployer: true,
        its: true,
        totalEmployerCost: true,
      },
    });

    const trendData = await this.prisma.payroll.groupBy({
      by: ['month'],
      where: { companyId, year: currentYear },
      _sum: { grossSalary: true, netSalary: true, totalEmployerCost: true },
      orderBy: { month: 'asc' },
      take: 6,
    });

    const trend = trendData.map((t) => ({
      month: new Date(0, t.month - 1).toLocaleString('fr-FR', {
        month: 'short',
      }),
      brut: Number(t._sum.grossSalary || 0) / 1_000_000,
      net: Number(t._sum.netSalary || 0) / 1_000_000,
      charges:
        (Number(t._sum.totalEmployerCost || 0) -
          Number(t._sum.grossSalary || 0)) /
        1_000_000,
    }));

    const depts = await this.prisma.department.findMany({
      where: { companyId },
      include: {
        employees: {
          where: { status: 'ACTIVE' },
          include: {
            payrolls: {
              where: { month: currentMonth, year: currentYear },
              take: 1,
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    const departments = depts
      .map((d) => {
        const employeesWithPayroll = d.employees.filter(
          (emp) => emp.payrolls.length > 0,
        );
        const mass = employeesWithPayroll.reduce(
          (acc, emp) => acc + Number(emp.payrolls[0]?.grossSalary || 0),
          0,
        );
        return {
          name: d.name,
          headcount: employeesWithPayroll.length,
          mass,
          avg:
            employeesWithPayroll.length > 0
              ? mass / employeesWithPayroll.length
              : 0,
          color:
            d.color || '#' + Math.floor(Math.random() * 16777215).toString(16),
        };
      })
      .filter((d) => d.mass > 0);

    return {
      summary: [
        {
          label: 'Masse Salariale Brute',
          value: (totalPayroll._sum.grossSalary || 0).toLocaleString(),
          currency: 'FCFA',
          trend: `${new Date(0, currentMonth - 1).toLocaleString('fr-FR', { month: 'long' })} ${currentYear}`,
        },
        {
          label: 'CNSS Patronale (20,28%)',
          value: (totalPayroll._sum.cnssEmployer || 0).toLocaleString(),
          currency: 'FCFA',
          sub: 'Charges Employeur',
        },
        {
          label: 'Salaires Nets Versés',
          value: (totalPayroll._sum.netSalary || 0).toLocaleString(),
          currency: 'FCFA',
        },
        {
          label: 'Total ITS Collecté',
          value: (totalPayroll._sum.its || 0).toLocaleString(),
          currency: 'FCFA',
        },
        {
          label: 'Coût Employeur Totale',
          value: (totalPayroll._sum.totalEmployerCost || 0).toLocaleString(),
          currency: 'FCFA',
          sub: 'Brut + CNSS (20,28%)',
        },
      ],
      trend:
        trend.length > 0
          ? trend
          : [{ month: 'N/A', brut: 0, net: 0, charges: 0 }],
      departments,
    };
  }

  // ============================================================
  // ANALYSE EFFECTIFS — données réelles (âges, ancienneté, turnover, retraite)
  // ============================================================

  private readonly LEGAL_RETIREMENT_AGE = 60; // Âge légal de départ à la retraite (CNSS Congo)

  private ageInYears(dateOfBirth: Date, atDate: Date = new Date()): number {
    let age = atDate.getFullYear() - dateOfBirth.getFullYear();
    const hadBirthday =
      atDate.getMonth() > dateOfBirth.getMonth() ||
      (atDate.getMonth() === dateOfBirth.getMonth() &&
        atDate.getDate() >= dateOfBirth.getDate());
    if (!hadBirthday) age--;
    return age;
  }

  private tenureInYears(hireDate: Date, atDate: Date = new Date()): number {
    return (
      (atDate.getTime() - hireDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
    );
  }

  private readonly RUPTURE_LABELS: Record<string, string> = {
    DEMISSION: 'Démission',
    LICENCIEMENT_FAUTE_SIMPLE: 'Licenciement (faute simple)',
    LICENCIEMENT_FAUTE_GRAVE: 'Licenciement (faute grave)',
    LICENCIEMENT_FAUTE_LOURDE: 'Licenciement (faute lourde)',
    LICENCIEMENT_ECONOMIQUE: 'Licenciement économique',
    RUPTURE_CONVENTIONNELLE: 'Rupture conventionnelle',
    FIN_CDD: 'Fin de CDD',
    FIN_PERIODE_ESSAI: "Fin de période d'essai",
    RETRAITE: 'Retraite',
    DECES: 'Décès',
    FORCE_MAJEURE: 'Force majeure',
    INVALIDITE: 'Invalidité',
  };

  // 🆕 Nombre de jours ouvrés (lundi-vendredi) entre deux dates, bornes incluses — hors jours fériés
  private countWeekdays(start: Date, end: Date): number {
    let count = 0;
    const d = new Date(start);
    while (d <= end) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }

  private readonly CONTRACT_LABELS: Record<string, string> = {
    CDI: 'CDI',
    CDD: 'CDD',
    STAGE: 'Stagiaire',
    INTERIM: 'Intérimaire',
    CONSULTANT: 'Consultant',
    PRESTATAIRE: 'Prestataire',
  };

  // 🆕 "Congolais" si la nationalité renseignée correspond au Congo, sinon "Étranger"
  private nationalityBucket(
    nationality?: string | null,
  ): 'CONGOLAIS' | 'ETRANGER' | 'NON_RENSEIGNE' {
    if (!nationality || !nationality.trim()) return 'NON_RENSEIGNE';
    const n = nationality.trim().toLowerCase();
    return n === 'cg' || n === 'cog' || n.includes('congo')
      ? 'CONGOLAIS'
      : 'ETRANGER';
  }

  // 🆕 Classification CSP (Cadres / Agents de Maîtrise / Employés-Ouvriers / Hors catégorie)
  // Basée sur mots-clés du libellé de grille, avec repli sur la position relative dans la grille
  // (par minSalary croissant) quand le libellé ne le précise pas. C'est une estimation, pas une
  // classification légale — affichée comme telle côté frontend.
  private classifyCsp(
    category: ConventionCategory,
    allCategories: ConventionCategory[],
  ): string {
    const norm = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    const text = norm(`${category.code} ${category.label}`);
    if (text.includes('hors')) return 'Hors catégorie';
    if (text.includes('cadre')) return 'Cadres';
    if (text.includes('maitrise')) return 'Agents de Maîtrise';
    if (
      text.includes('manoeuvre') ||
      text.includes('ouvrier') ||
      text.includes('execution')
    )
      return 'Employés / Exécution';

    // Repli positionnel : classement par minSalary croissant dans la grille de la convention
    const sorted = [...allCategories].sort((a, b) => a.minSalary - b.minSalary);
    const rank = sorted.findIndex((c) => c.code === category.code);
    if (rank === -1) return 'Non catégorisé';
    const pct = (rank + 1) / sorted.length;
    if (pct > 0.85) return 'Cadres';
    if (pct > 0.65) return 'Agents de Maîtrise';
    return 'Employés / Exécution';
  }

  async getWorkforceAnalysis(
    userId: string,
    overrideCompanyId?: string,
    filters?: {
      department?: string;
      contractType?: string;
      nationality?: string;
      year?: number;
    },
  ) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return {};

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearAgo = new Date(
      now.getFullYear() - 1,
      now.getMonth(),
      now.getDate(),
    );

    // 🆕 Filtres du rapport — département, type de contrat, nationalité
    // (mêmes filtres que la liste employés, appliqués ici à toute l'analyse :
    // tendance, pyramides, nationalité, turnover...)
    const whereClause: any = { companyId };
    if (filters?.department && filters.department !== 'Tous') {
      whereClause.department = { name: filters.department };
    }
    if (filters?.contractType && filters.contractType !== 'Tous') {
      whereClause.contractType = filters.contractType;
    }
    if (filters?.nationality && filters.nationality !== 'Tous') {
      whereClause.nationality =
        filters.nationality === 'Non renseigné' ? null : filters.nationality;
    }

    // Un seul aller-retour DB : on récupère tout le monde (actifs + partis) pour calculer historique
    const all = await this.prisma.employee.findMany({
      where: whereClause,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        gender: true,
        dateOfBirth: true,
        hireDate: true,
        terminationDate: true,
        status: true,
        position: true,
        department: { select: { name: true } },
        contractType: true,
        nationality: true,
        professionalCategory: true,
      },
    });

    const isCurrentlyIn = (e: (typeof all)[number]) =>
      !['TERMINATED', 'RETIRED'].includes(e.status);
    const current = all.filter(isCurrentlyIn);
    const totalActive = current.length;

    // ── Nouveaux / départs du mois + turnover annualisé (12 derniers mois) ──
    const hiresThisMonth = all.filter(
      (e) => e.hireDate && new Date(e.hireDate) >= monthStart,
    ).length;
    const departuresThisMonth = all.filter(
      (e) => e.terminationDate && new Date(e.terminationDate) >= monthStart,
    ).length;
    const departures12mo = all.filter(
      (e) => e.terminationDate && new Date(e.terminationDate) >= yearAgo,
    ).length;
    // Effectif moyen sur 12 mois ≈ moyenne (effectif il y a 1 an, effectif actuel)
    const headcountAt = (date: Date) =>
      all.filter(
        (e) =>
          e.hireDate &&
          new Date(e.hireDate) <= date &&
          (!e.terminationDate || new Date(e.terminationDate) > date),
      ).length;
    const avgHeadcount12mo = (headcountAt(yearAgo) + totalActive) / 2;
    const turnoverRate =
      avgHeadcount12mo > 0
        ? Math.round((departures12mo / avgHeadcount12mo) * 1000) / 10
        : 0;

    // ── 🆕 Tendance effectif par année sélectionnée (réel, pas inventé) ──────
    // Avant : 12 mois glissants depuis aujourd'hui. Maintenant : Jan → Déc de
    // l'année choisie (par défaut l'année en cours), avec une 2e série pour
    // l'année précédente afin de comparer "on avait combien en mars cette
    // année vs l'an dernier".
    const targetYear = filters?.year || now.getFullYear();
    const buildYearTrend = (year: number) => {
      const lastMonth = year === now.getFullYear() ? now.getMonth() : 11; // pas de mois futurs pour l'année en cours
      const out: { month: string; total: number }[] = [];
      for (let m = 0; m <= lastMonth; m++) {
        const monthEnd = new Date(year, m + 1, 0);
        out.push({
          month: monthEnd.toLocaleDateString('fr-FR', { month: 'short' }),
          total: headcountAt(monthEnd),
        });
      }
      return out;
    };
    const trend = buildYearTrend(targetYear);
    const trendPreviousYear = buildYearTrend(targetYear - 1);

    // 🆕 Historique pluriannuel — effectif au 31 déc. (ou aujourd'hui pour
    // l'année en cours) des 5 dernières années, pour voir si ça monte ou
    // descend d'une année sur l'autre.
    const yearlyHeadcount: { year: number; total: number }[] = [];
    for (let y = targetYear - 4; y <= targetYear; y++) {
      const refDate = y === now.getFullYear() ? now : new Date(y, 11, 31);
      yearlyHeadcount.push({ year: y, total: headcountAt(refDate) });
    }

    // 🆕 Années disponibles pour le sélecteur — depuis la 1ère embauche connue
    const hireYears = all
      .filter((e) => e.hireDate)
      .map((e) => new Date(e.hireDate as any).getFullYear());
    const earliestYear = hireYears.length
      ? Math.min(...hireYears)
      : now.getFullYear();
    const availableYears: number[] = [];
    for (let y = now.getFullYear(); y >= earliestYear; y--)
      availableYears.push(y);

    // ── Pyramide des âges (réelle, par genre) ────────────────────────────────
    const ageBuckets = [
      { label: '< 25 ans', min: 0, max: 24 },
      { label: '25-34 ans', min: 25, max: 34 },
      { label: '35-44 ans', min: 35, max: 44 },
      { label: '45-54 ans', min: 45, max: 54 },
      { label: '55-59 ans', min: 55, max: 59 },
      { label: '60 ans +', min: 60, max: 999 },
    ];
    const pyramid = ageBuckets.map((b) => {
      const inBucket = current.filter(
        (e) =>
          e.dateOfBirth &&
          this.ageInYears(new Date(e.dateOfBirth)) >= b.min &&
          this.ageInYears(new Date(e.dateOfBirth)) <= b.max,
      );
      return {
        label: b.label,
        male: inBucket.filter((e) => e.gender === 'MALE').length,
        female: inBucket.filter((e) => e.gender === 'FEMALE').length,
      };
    });

    // ── Pyramide de l'ancienneté (réelle) ────────────────────────────────────
    const tenureBuckets = [
      { label: '< 1 an', min: 0, max: 1 },
      { label: '1-3 ans', min: 1, max: 3 },
      { label: '3-5 ans', min: 3, max: 5 },
      { label: '5-10 ans', min: 5, max: 10 },
      { label: '10 ans +', min: 10, max: 999 },
    ];
    const seniority = tenureBuckets.map((b) => {
      const inBucket = current.filter(
        (e) =>
          e.hireDate &&
          this.tenureInYears(new Date(e.hireDate)) >= b.min &&
          this.tenureInYears(new Date(e.hireDate)) < b.max,
      );
      return {
        label: b.label,
        male: inBucket.filter((e) => e.gender === 'MALE').length,
        female: inBucket.filter((e) => e.gender === 'FEMALE').length,
      };
    });

    // ── 🆕 Veille départs à la retraite ───────────────────────────────────────
    // "Critique" : ≤ 2 ans avant l'âge légal (60 ans) — à préparer en priorité
    // "À anticiper" : entre 2 et 5 ans avant l'âge légal
    const retirementCandidates = current
      .filter((e) => e.dateOfBirth)
      .map((e) => {
        const age = this.ageInYears(new Date(e.dateOfBirth));
        const yearsRemaining = this.LEGAL_RETIREMENT_AGE - age;
        return {
          id: e.id,
          name: `${e.firstName} ${e.lastName}`,
          position: e.position,
          department: e.department?.name ?? null,
          age,
          yearsRemaining: Math.max(yearsRemaining, 0),
        };
      })
      .filter((e) => e.age >= this.LEGAL_RETIREMENT_AGE - 5)
      .sort((a, b) => a.yearsRemaining - b.yearsRemaining);

    const retirementWatch = {
      legalRetirementAge: this.LEGAL_RETIREMENT_AGE,
      critical: retirementCandidates.filter(
        (e) => e.age >= this.LEGAL_RETIREMENT_AGE - 2,
      ), // ≤ 2 ans restants (ou déjà éligibles)
      upcoming: retirementCandidates.filter(
        (e) => e.age < this.LEGAL_RETIREMENT_AGE - 2,
      ), // entre 2 et 5 ans restants
    };

    // ── 🆕 Répartition par type de contrat ───────────────────────────────────
    const contractCounts = new Map<string, number>();
    for (const e of current)
      contractCounts.set(
        e.contractType,
        (contractCounts.get(e.contractType) || 0) + 1,
      );
    const byContractType = Array.from(contractCounts.entries())
      .map(([type, count]) => ({
        type,
        label: this.CONTRACT_LABELS[type] ?? type,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    // ── 🆕 Répartition détaillée par nationalité (un pays = une barre réelle,
    // ex. Congolais / Gabonais / Camerounais... — plus le simple bloc binaire
    // Congolais/Étranger d'avant). Le champ est déjà normalisé à la création/
    // édition de l'employé (common/utils/nationality.util.ts).
    const natCounts = new Map<string, { male: number; female: number }>();
    for (const e of current) {
      const label = e.nationality?.trim() || 'Non renseigné';
      const entry = natCounts.get(label) || { male: 0, female: 0 };
      if (e.gender === 'MALE') entry.male++;
      else if (e.gender === 'FEMALE') entry.female++;
      natCounts.set(label, entry);
    }
    const byNationality = Array.from(natCounts, ([label, v]) => ({
      label,
      male: v.male,
      female: v.female,
      count: v.male + v.female,
    })).sort((a, b) => b.count - a.count);

    // 🆕 Résumé pour le narratif RH ("X nationalités différentes, Y% d'étrangers")
    const foreignCount = current.filter(
      (e) => this.nationalityBucket(e.nationality) === 'ETRANGER',
    ).length;
    const nationalitySummary = {
      distinctCount: byNationality.filter((n) => n.label !== 'Non renseigné')
        .length,
      foreignCount,
      foreignPercentage:
        totalActive > 0
          ? Math.round((foreignCount / totalActive) * 1000) / 10
          : 0,
      unspecifiedCount:
        (natCounts.get('Non renseigné')?.male ?? 0) +
        (natCounts.get('Non renseigné')?.female ?? 0),
    };

    // ── 🆕 Répartition par catégorie/échelon conventionnel + regroupement CSP ─
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { collectiveAgreement: true },
    });
    const gridCategories = company?.collectiveAgreement
      ? this.conventionsService.getCategoriesByConvention(
          company.collectiveAgreement,
        )
      : [];
    const categoryByCode = new Map(gridCategories.map((c) => [c.code, c]));

    const categoryCounts = new Map<string, number>();
    const cspCounts = new Map<string, number>();
    for (const e of current) {
      const code = e.professionalCategory?.trim();
      const cat = code ? categoryByCode.get(code) : undefined;
      const catLabel = cat ? cat.label : code || 'Non catégorisé';
      categoryCounts.set(catLabel, (categoryCounts.get(catLabel) || 0) + 1);
      const cspTier = cat
        ? this.classifyCsp(cat, gridCategories)
        : 'Non catégorisé';
      cspCounts.set(cspTier, (cspCounts.get(cspTier) || 0) + 1);
    }
    const byCategory = Array.from(categoryCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
    const cspOrder = [
      'Cadres',
      'Agents de Maîtrise',
      'Employés / Exécution',
      'Hors catégorie',
      'Non catégorisé',
    ];
    const csp = cspOrder
      .filter((tier) => cspCounts.has(tier))
      .map((tier) => ({ label: tier, count: cspCounts.get(tier)! }));

    // ══════════════════════════════════════════════════════════════════════
    // 🆕 ÉTAPE 3 — KPI Bilan Social : turnover détaillé + absentéisme
    // ══════════════════════════════════════════════════════════════════════

    // ── Turnover mensuel (12 derniers mois) ──────────────────────────────────
    const turnoverMonthly: { month: string; rate: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const departuresInMonth = all.filter(
        (e) =>
          e.terminationDate &&
          new Date(e.terminationDate) >= mStart &&
          new Date(e.terminationDate) <= mEnd,
      ).length;
      const avgHc = (headcountAt(mStart) + headcountAt(mEnd)) / 2;
      turnoverMonthly.push({
        month: mEnd.toLocaleDateString('fr-FR', { month: 'short' }),
        rate:
          avgHc > 0 ? Math.round((departuresInMonth / avgHc) * 1000) / 10 : 0,
      });
    }

    // ── Turnover par motif de rupture (12 derniers mois, source = ContractRupture) ─
    const ruptures12mo = await this.prisma.contractRupture.findMany({
      where: {
        companyId,
        ruptureDate: { gte: yearAgo },
        status: { in: ['VALIDE', 'PAYE', 'CONTESTE', 'ARCHIVE'] },
      },
      select: { ruptureType: true, employeeId: true },
    });
    const motifCounts = new Map<string, number>();
    for (const r of ruptures12mo)
      motifCounts.set(r.ruptureType, (motifCounts.get(r.ruptureType) || 0) + 1);
    const turnoverByMotif = Array.from(motifCounts.entries())
      .map(([motif, count]) => ({
        motif,
        label: this.RUPTURE_LABELS[motif] ?? motif,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    // ── Turnover par département (12 derniers mois) ──────────────────────────
    const deptById = new Map(
      all.map((e) => [e.id, e.department?.name ?? 'Sans département']),
    );
    const deptDepartureCounts = new Map<string, number>();
    for (const r of ruptures12mo) {
      const dept = deptById.get(r.employeeId) ?? 'Sans département';
      deptDepartureCounts.set(dept, (deptDepartureCounts.get(dept) || 0) + 1);
    }
    const turnoverByDepartment = Array.from(deptDepartureCounts.entries())
      .map(([department, count]) => ({ department, count }))
      .sort((a, b) => b.count - a.count);

    const turnoverDetail = {
      recordedRuptures: ruptures12mo.length, // motifs réellement enregistrés (peut être < total départs si certaines fins de contrat n'ont pas été saisies via le module rupture)
      monthly: turnoverMonthly,
      byMotif: turnoverByMotif,
      byDepartment: turnoverByDepartment,
    };

    // ── Absentéisme (12 derniers mois, source = AbsenceRequest approuvées) ───
    const absences12mo = await this.prisma.absenceRequest.findMany({
      where: { companyId, status: 'APPROVED', startDate: { gte: yearAgo } },
      select: { workingDays: true },
    });
    const totalAbsenceDays = absences12mo.reduce(
      (sum, a) => sum + Number(a.workingDays),
      0,
    );
    const totalAbsenceCount = absences12mo.length;
    const avgAbsenceDuration =
      totalAbsenceCount > 0
        ? Math.round((totalAbsenceDays / totalAbsenceCount) * 10) / 10
        : 0;
    // Jours ouvrés théoriques sur 12 mois × effectif moyen
    const theoreticalWorkingDaysPerPerson = this.countWeekdays(yearAgo, now);
    const theoreticalWorkingDays = Math.round(
      theoreticalWorkingDaysPerPerson * avgHeadcount12mo,
    );
    const absenteeismRate =
      theoreticalWorkingDays > 0
        ? Math.round((totalAbsenceDays / theoreticalWorkingDays) * 1000) / 10
        : 0;

    const absenteeism = {
      rate: absenteeismRate,
      avgDurationDays: avgAbsenceDuration,
      totalAbsenceDays: Math.round(totalAbsenceDays * 10) / 10,
      totalAbsenceCount,
      theoreticalWorkingDays,
    };

    // ── 🆕 Mouvement par département sur l'année sélectionnée (pour le conseil
    // "la baisse/hausse vient surtout de tel département") ───────────────────
    const headcountAtByDept = (date: Date) => {
      const map = new Map<string, number>();
      for (const e of all) {
        if (
          e.hireDate &&
          new Date(e.hireDate) <= date &&
          (!e.terminationDate || new Date(e.terminationDate) > date)
        ) {
          const name = e.department?.name || 'Sans département';
          map.set(name, (map.get(name) || 0) + 1);
        }
      }
      return map;
    };
    const yearStartDate = new Date(targetYear, 0, 1);
    const yearEndDate =
      targetYear === now.getFullYear() ? now : new Date(targetYear, 11, 31);
    const deptAtStart = headcountAtByDept(yearStartDate);
    const deptAtEnd = headcountAtByDept(yearEndDate);
    const deptMovers = Array.from(
      new Set([...deptAtStart.keys(), ...deptAtEnd.keys()]),
    )
      .map((name) => ({
        name,
        delta: (deptAtEnd.get(name) || 0) - (deptAtStart.get(name) || 0),
      }))
      .filter((d) => d.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    // ── 🆕 Conseils RH — synthèse rédigée en langage RH, pas technique ───────
    // Regroupe tendance, turnover, retraite, absentéisme et nationalité dans
    // un seul bloc "assistant" plutôt que dispersés sur toute la page.
    type Insight = { type: 'success' | 'warning' | 'info'; title: string; message: string };
    const insights: Insight[] = [];

    // Tendance effectif de l'année vs année précédente
    if (trend.length >= 2) {
      const startTotal = trend[0].total;
      const endTotal = trend[trend.length - 1].total;
      const delta = endTotal - startTotal;
      const pct = startTotal > 0 ? Math.round((delta / startTotal) * 100) : 0;
      const mover = deptMovers[0];
      const moverText = mover
        ? ` — principalement au niveau de ${mover.name} (${mover.delta > 0 ? '+' : ''}${mover.delta} sur la période)`
        : '';
      if (delta === 0) {
        insights.push({
          type: 'info',
          title: `Effectif stable en ${targetYear}`,
          message: `L'effectif n'a pas varié depuis le début de l'année (${endTotal} personnes).`,
        });
      } else if (delta > 0) {
        insights.push({
          type: 'success',
          title: `Croissance de l'effectif en ${targetYear}`,
          message: `L'effectif est passé de ${startTotal} à ${endTotal} personnes depuis janvier (+${Math.abs(pct)}%)${moverText}. Vérifiez que l'intégration (accueil, matériel, paie) suit bien ce rythme.`,
        });
      } else {
        insights.push({
          type: 'warning',
          title: `Baisse de l'effectif en ${targetYear}`,
          message: `L'effectif est passé de ${startTotal} à ${endTotal} personnes depuis janvier (${pct}%)${moverText}. Identifiez si ce sont des fins de contrat naturelles ou des départs à surveiller.`,
        });
      }
    }

    // Comparaison avec l'année précédente (même nombre de mois écoulés)
    if (trendPreviousYear.length > 0 && trend.length > 0) {
      const sameMonthLastYear =
        trendPreviousYear[Math.min(trend.length, trendPreviousYear.length) - 1];
      const currentValue = trend[trend.length - 1].total;
      if (sameMonthLastYear) {
        const diffYoY = currentValue - sameMonthLastYear.total;
        if (diffYoY !== 0) {
          insights.push({
            type: diffYoY > 0 ? 'success' : 'info',
            title: `Comparaison avec ${targetYear - 1}`,
            message: `À la même période l'an dernier, l'effectif était de ${sameMonthLastYear.total} personnes, contre ${currentValue} aujourd'hui (${diffYoY > 0 ? '+' : ''}${diffYoY}).`,
          });
        }
      }
    }

    // Turnover
    if (turnoverRate > 15) {
      insights.push({
        type: 'warning',
        title: 'Turnover élevé',
        message: `Le turnover annualisé atteint ${turnoverRate}%, au-dessus du seuil de vigilance habituel (15%). Un point avec les managers concernés peut aider à comprendre les motifs de départ.`,
      });
    } else if (turnoverRate > 0) {
      insights.push({
        type: 'info',
        title: 'Turnover sous contrôle',
        message: `Le turnover annualisé est de ${turnoverRate}%, un niveau raisonnable pour l'activité.`,
      });
    }

    // Retraite (fusionné ici pour une lecture d'un seul tenant)
    if (retirementWatch.critical.length > 0) {
      insights.push({
        type: 'warning',
        title: 'Départs à la retraite imminents',
        message: `${retirementWatch.critical.length} salarié${retirementWatch.critical.length > 1 ? 's ont' : ' a'} atteint ou presque l'âge légal de départ. Anticipez le recrutement et la transmission de leurs compétences dès maintenant (détail ci-contre).`,
      });
    } else if (retirementWatch.upcoming.length > 0) {
      insights.push({
        type: 'info',
        title: 'Départs à la retraite à anticiper',
        message: `${retirementWatch.upcoming.length} salarié${retirementWatch.upcoming.length > 1 ? 's partiront' : ' partira'} à la retraite dans les prochaines années. Pas d'urgence, mais à intégrer dans le plan de recrutement.`,
      });
    }

    // Absentéisme
    if (absenteeism.rate > 5) {
      insights.push({
        type: 'warning',
        title: 'Absentéisme à surveiller',
        message: `Le taux d'absentéisme est de ${absenteeism.rate}% sur les 12 derniers mois (durée moyenne : ${absenteeism.avgDurationDays} jours). Vérifiez s'il est concentré sur certains services.`,
      });
    }

    // Diversité des nationalités
    if (nationalitySummary.foreignPercentage > 0) {
      insights.push({
        type: 'info',
        title: 'Diversité des nationalités',
        message: `${nationalitySummary.foreignPercentage}% de l'effectif est de nationalité étrangère, répartis sur ${nationalitySummary.distinctCount} nationalité${nationalitySummary.distinctCount > 1 ? 's' : ''}. Pensez à vérifier la validité des titres de séjour/permis de travail à jour.`,
      });
    }

    return {
      metrics: [
        {
          label: 'Effectif Total',
          value: totalActive.toString(),
          sub: `${current.filter((e) => e.status === 'ACTIVE').length} en activité`,
        },
        {
          label: 'Nouveaux',
          value: hiresThisMonth.toString(),
          sub: 'Ce mois-ci',
        },
        {
          label: 'Départs',
          value: departuresThisMonth.toString(),
          sub: `Turnover annualisé : ${turnoverRate}%`,
        },
      ],
      trend,
      trendPreviousYear, // 🆕
      yearlyHeadcount, // 🆕
      availableYears, // 🆕
      selectedYear: targetYear, // 🆕
      insights, // 🆕 conseils RH consolidés
      pyramid,
      seniority, // 🆕
      retirementWatch, // 🆕
      byContractType, // 🆕
      byNationality, // 🆕
      nationalitySummary, // 🆕 — pour le narratif RH ("X nationalités, Y% d'étrangers")
      byCategory, // 🆕
      csp, // 🆕 — estimation, cf. classifyCsp()
      hasConvention: !!company?.collectiveAgreement, // 🆕
      turnoverDetail, // 🆕 étape 3
      absenteeism, // 🆕 étape 3
    };
  }

  /**
   * 🆕 Détail des employés d'une nationalité donnée — alimente le panneau
   * latéral ouvert au clic sur une barre du graphique "Effectif par
   * nationalité" de la page Rapport Effectifs.
   * GET /reports/workforce/nationality/:nationality
   */
  async getEmployeesByNationality(
    userId: string,
    nationality: string,
    overrideCompanyId?: string,
  ) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return [];

    const isUnspecified = nationality === 'Non renseigné';
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        status: { notIn: ['TERMINATED', 'RETIRED'] },
        nationality: isUnspecified ? null : nationality,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        position: true,
        hireDate: true,
        gender: true,
        department: { select: { name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return employees.map((e) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName}`,
      position: e.position,
      department: e.department?.name ?? null,
      hireDate: e.hireDate,
      gender: e.gender,
    }));
  }

  /**
   * 🆕 Liste des employés présents à une date donnée (fin du mois/année
   * choisis), paginée, avec recherche par nom/matricule/poste.
   *
   * IMPORTANT : la recherche est appliquée AVANT la pagination (dans la
   * requête Prisma), donc un employé trouvé apparaît toujours dès la
   * première page du résultat filtré — peu importe où il se trouverait
   * dans la liste complète non filtrée.
   *
   * GET /reports/workforce/employees?year=&month=&search=&page=&limit=
   */
  async getEmployeesAtDate(
    userId: string,
    options: {
      year: number;
      month?: number; // 1-12, optionnel = fin d'année
      search?: string;
      department?: string;
      contractType?: string;
      nationality?: string;
      page?: number;
      limit?: number;
    },
    overrideCompanyId?: string,
  ) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return { data: [], total: 0, page: 1, limit: 25, totalPages: 0 };

    const now = new Date();
    const year = options.year || now.getFullYear();
    const month = options.month; // 1-12 ou undefined
    // Date de référence = fin du mois choisi, plafonnée à aujourd'hui
    let refDate: Date;
    if (month) {
      const candidate = new Date(year, month, 0, 23, 59, 59);
      refDate = candidate > now ? now : candidate;
    } else {
      const candidate = new Date(year, 11, 31, 23, 59, 59);
      refDate = candidate > now ? now : candidate;
    }

    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 25));
    const search = options.search?.trim();

    const andConditions: any[] = [
      { companyId },
      { hireDate: { lte: refDate } },
      { OR: [{ terminationDate: null }, { terminationDate: { gt: refDate } }] },
    ];
    if (options.department && options.department !== 'Tous') {
      andConditions.push({ department: { name: options.department } });
    }
    if (options.contractType && options.contractType !== 'Tous') {
      andConditions.push({ contractType: options.contractType });
    }
    if (options.nationality && options.nationality !== 'Tous') {
      andConditions.push({
        nationality:
          options.nationality === 'Non renseigné' ? null : options.nationality,
      });
    }
    if (search) {
      andConditions.push({
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { employeeNumber: { contains: search, mode: 'insensitive' } },
          { position: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    const whereClause = { AND: andConditions };

    const [total, employees] = await Promise.all([
      this.prisma.employee.count({ where: whereClause }),
      this.prisma.employee.findMany({
        where: whereClause,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeNumber: true,
          position: true,
          hireDate: true,
          gender: true,
          contractType: true,
          nationality: true,
          department: { select: { name: true } },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: employees.map((e) => ({
        id: e.id,
        name: `${e.firstName} ${e.lastName}`,
        employeeNumber: e.employeeNumber,
        position: e.position,
        department: e.department?.name ?? null,
        contractType: e.contractType,
        nationality: e.nationality,
        hireDate: e.hireDate,
        gender: e.gender,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      referenceDate: refDate,
    };
  }

  // ============================================================
  // ANALYSE CONGÉS
  // ============================================================
  private readonly LEAVE_TYPE_COLORS: Record<string, string> = {
    ANNUAL: '#0EA5E9',
    SICK: '#EF4444',
    MATERNITY: '#EC4899',
    PATERNITY: '#8B5CF6',
    UNPAID: '#94A3B8',
    COMPENSATORY: '#10B981',
  };
  private readonly LEAVE_TYPE_LABELS: Record<string, string> = {
    ANNUAL: 'Congé annuel',
    SICK: 'Maladie',
    MATERNITY: 'Maternité',
    PATERNITY: 'Paternité',
    UNPAID: 'Sans solde',
    COMPENSATORY: 'Récupération',
  };

  async getLeaveAnalysis(userId: string, overrideCompanyId?: string) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return {};

    const now = new Date();
    const currentYear = now.getFullYear();
    const yearAgo = new Date(
      now.getFullYear() - 1,
      now.getMonth(),
      now.getDate(),
    );

    const [
      leaveStats,
      pendingCount,
      rejectedCount,
      approvedCount,
      balances,
      leaves12mo,
    ] = await Promise.all([
      this.prisma.leave.groupBy({
        by: ['type'],
        where: { companyId, status: 'APPROVED' },
        _count: { id: true },
      }),
      this.prisma.leave.count({ where: { companyId, status: 'PENDING' } }),
      this.prisma.leave.count({ where: { companyId, status: 'REJECTED' } }),
      this.prisma.leave.count({ where: { companyId, status: 'APPROVED' } }),
      this.prisma.leaveBalance.findMany({
        where: { year: currentYear, employee: { companyId, status: 'ACTIVE' } },
        select: { annualRemaining: true },
      }),
      this.prisma.leave.findMany({
        where: { companyId, status: 'APPROVED', startDate: { gte: yearAgo } },
        select: { type: true, startDate: true },
      }),
    ]);

    // ── Répartition par type (réelle, couleurs fixes — pas de random) ────────
    const distribution = leaveStats
      .map((s) => ({
        name: this.LEAVE_TYPE_LABELS[s.type] ?? s.type,
        value: s._count.id,
        color: this.LEAVE_TYPE_COLORS[s.type] ?? '#94A3B8',
      }))
      .sort((a, b) => b.value - a.value);

    // ── Solde moyen réel (LeaveBalance.annualRemaining, année en cours) ──────
    const avgBalance =
      balances.length > 0
        ? Math.round(
            (balances.reduce((sum, b) => sum + Number(b.annualRemaining), 0) /
              balances.length) *
              10,
          ) / 10
        : 0;

    // ── Taux d'approbation ────────────────────────────────────────────────
    const decided = approvedCount + rejectedCount;
    const approvalRate =
      decided > 0 ? Math.round((approvedCount / decided) * 1000) / 10 : 0;

    // ── Saisonnalité réelle — 12 derniers mois, Annual vs Sick (clés attendues par le frontend) ──
    const seasonal: { month: string; Annual: number; Sick: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const inMonth = leaves12mo.filter(
        (l) => new Date(l.startDate) >= mStart && new Date(l.startDate) <= mEnd,
      );
      seasonal.push({
        month: mEnd.toLocaleDateString('fr-FR', { month: 'short' }),
        Annual: inMonth.filter((l) => l.type === 'ANNUAL').length,
        Sick: inMonth.filter((l) => l.type === 'SICK').length,
      });
    }

    return {
      kpi: [
        {
          label: 'Total Demandes',
          value: (approvedCount + pendingCount + rejectedCount).toString(),
          sub: `${approvedCount} approuvée(s)`,
        },
        {
          label: 'Solde Moyen',
          value: `${avgBalance}j`,
          sub: `${currentYear}`,
        },
        { label: 'En attente', value: pendingCount.toString() },
        { label: "Taux d'approbation", value: `${approvalRate}%` },
      ],
      distribution:
        distribution.length > 0
          ? distribution
          : [{ name: 'Aucune demande', value: 1, color: '#e5e7eb' }],
      seasonal,
    };
  }

  // ============================================================
  // 🆕 INDICATEURS PERFORMANCE — Objectifs (Goal) & Entretiens (PerformanceReview)
  // ============================================================
  async getPerformanceIndicators(userId: string, overrideCompanyId?: string) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return {};

    const now = new Date();
    const currentYear = now.getFullYear();
    const yearStart = new Date(currentYear, 0, 1);

    const [activeEmployees, goals, reviews] = await Promise.all([
      this.prisma.employee.findMany({
        where: { companyId, status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.goal.findMany({
        where: { employee: { companyId } },
        select: { status: true, progress: true, endDate: true },
      }),
      this.prisma.performanceReview.findMany({
        where: { employee: { companyId }, date: { gte: yearStart } },
        select: {
          employeeId: true,
          status: true,
          overallScore: true,
          rating: true,
        },
      }),
    ]);

    const activeIds = new Set(activeEmployees.map((e) => e.id));

    // ── Objectifs (Goals) ─────────────────────────────────────────────────
    const goalStatusCounts: Record<string, number> = {
      NOT_STARTED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };
    for (const g of goals)
      goalStatusCounts[g.status] = (goalStatusCounts[g.status] || 0) + 1;
    const activeGoals = goals.filter((g) => g.status !== 'CANCELLED');
    const avgProgress =
      activeGoals.length > 0
        ? Math.round(
            activeGoals.reduce((s, g) => s + g.progress, 0) /
              activeGoals.length,
          )
        : 0;
    const overdueGoals = goals.filter(
      (g) =>
        g.status !== 'COMPLETED' &&
        g.status !== 'CANCELLED' &&
        new Date(g.endDate) < now,
    ).length;

    // ── Entretiens (PerformanceReview) — année en cours ──────────────────
    const reviewedEmployeeIds = new Set(reviews.map((r) => r.employeeId));
    const coverageRate =
      activeIds.size > 0
        ? Math.round((reviewedEmployeeIds.size / activeIds.size) * 1000) / 10
        : 0;
    const scored = reviews.filter((r) => r.overallScore !== null);
    const avgScore =
      scored.length > 0
        ? Math.round(
            (scored.reduce((s, r) => s + Number(r.overallScore), 0) /
              scored.length) *
              100,
          ) / 100
        : null;
    const reviewStatusCounts: Record<string, number> = {
      DRAFT: 0,
      SUBMITTED: 0,
      ACKNOWLEDGED: 0,
    };
    for (const r of reviews)
      reviewStatusCounts[r.status] = (reviewStatusCounts[r.status] || 0) + 1;

    return {
      goals: {
        total: goals.length,
        avgProgress,
        overdue: overdueGoals,
        byStatus: [
          {
            label: 'Non démarrés',
            status: 'NOT_STARTED',
            count: goalStatusCounts.NOT_STARTED,
          },
          {
            label: 'En cours',
            status: 'IN_PROGRESS',
            count: goalStatusCounts.IN_PROGRESS,
          },
          {
            label: 'Atteints',
            status: 'COMPLETED',
            count: goalStatusCounts.COMPLETED,
          },
          {
            label: 'Annulés',
            status: 'CANCELLED',
            count: goalStatusCounts.CANCELLED,
          },
        ],
      },
      reviews: {
        total: reviews.length,
        activeEmployeeCount: activeIds.size,
        reviewedEmployeeCount: reviewedEmployeeIds.size,
        coverageRate, // % de l'effectif actif ayant eu au moins un entretien cette année
        avgScore, // note moyenne /20 (ou échelle utilisée par l'entreprise), null si aucun score
        byStatus: [
          {
            label: 'Brouillon',
            status: 'DRAFT',
            count: reviewStatusCounts.DRAFT,
          },
          {
            label: 'Soumis',
            status: 'SUBMITTED',
            count: reviewStatusCounts.SUBMITTED,
          },
          {
            label: 'Accusé réception',
            status: 'ACKNOWLEDGED',
            count: reviewStatusCounts.ACKNOWLEDGED,
          },
        ],
      },
    };
  }

  // ============================================================
  // 🆕 INDICATEURS RECRUTEMENT — Offres (JobOffer) & Candidatures (Candidate)
  // ============================================================
  async getRecruitmentIndicators(userId: string, overrideCompanyId?: string) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return {};

    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [offers, candidates] = await Promise.all([
      this.prisma.jobOffer.findMany({
        where: { companyId },
        select: { status: true },
      }),
      this.prisma.candidate.findMany({
        where: { jobOffer: { companyId }, createdAt: { gte: sixMonthsAgo } },
        select: { hrDecision: true, aiSuggestion: true, createdAt: true },
      }),
    ]);

    const OFFER_STATUS_LABELS: Record<string, string> = {
      DRAFT: 'Brouillon',
      PUBLISHED: 'Publiée',
      CLOSED: 'Clôturée',
      ARCHIVED: 'Archivée',
    };
    const offersByStatus = Object.entries(
      offers.reduce((acc: Record<string, number>, o) => {
        acc[o.status] = (acc[o.status] || 0) + 1;
        return acc;
      }, {}),
    ).map(([status, count]) => ({
      label: OFFER_STATUS_LABELS[status] ?? status,
      status,
      count,
    }));

    const DECISION_LABELS: Record<string, string> = {
      RETENU: 'Retenu',
      MOYENNE: 'Moyen',
      SECONDE_CHANCE: 'Seconde chance',
      REFUS: 'Refusé',
    };
    const candidatesByDecision = Object.entries(
      candidates.reduce((acc: Record<string, number>, c) => {
        const key = c.hrDecision || c.aiSuggestion || 'EN_ATTENTE';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    ).map(([key, count]) => ({
      label: DECISION_LABELS[key] ?? 'En attente',
      status: key,
      count,
    }));

    // ── Candidatures reçues — 6 derniers mois ────────────────────────────
    const candidatesTrend: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      candidatesTrend.push({
        month: mEnd.toLocaleDateString('fr-FR', { month: 'short' }),
        count: candidates.filter(
          (c) =>
            new Date(c.createdAt) >= mStart && new Date(c.createdAt) <= mEnd,
        ).length,
      });
    }

    return {
      totalOffers: offers.length,
      totalCandidates: candidates.length,
      offersByStatus,
      candidatesByDecision,
      candidatesTrend,
    };
  }

  // ============================================================
  // 🆕 INDICATEURS FORMATION — TrainingCourse & EmployeeTraining
  // ============================================================
  async getTrainingIndicators(userId: string, overrideCompanyId?: string) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return {};

    const sessions = await this.prisma.employeeTraining.findMany({
      where: { course: { companyId } },
      select: {
        status: true,
        course: { select: { category: true, cost: true, durationHours: true } },
      },
    });

    const STATUS_LABELS: Record<string, string> = {
      REQUESTED: 'Demandée',
      APPROVED: 'Approuvée',
      PLANNED: 'Planifiée',
      IN_PROGRESS: 'En cours',
      COMPLETION_REQUESTED: 'Clôture demandée',
      COMPLETED: 'Terminée',
      CANCELLED: 'Annulée',
    };
    const sessionsByStatus = Object.entries(
      sessions.reduce((acc: Record<string, number>, s) => {
        acc[s.status] = (acc[s.status] || 0) + 1;
        return acc;
      }, {}),
    ).map(([status, count]) => ({
      label: STATUS_LABELS[status] ?? status,
      status,
      count,
    }));

    const costByCategory = new Map<string, number>();
    const hoursByCategory = new Map<string, number>();
    for (const s of sessions) {
      const cat = s.course.category || 'Non catégorisé';
      costByCategory.set(
        cat,
        (costByCategory.get(cat) || 0) + Number(s.course.cost || 0),
      );
      hoursByCategory.set(
        cat,
        (hoursByCategory.get(cat) || 0) + Number(s.course.durationHours || 0),
      );
    }
    const byCategory = Array.from(costByCategory.keys())
      .map((cat) => ({
        label: cat,
        cost: Math.round(costByCategory.get(cat) || 0),
        hours: hoursByCategory.get(cat) || 0,
      }))
      .sort((a, b) => b.cost - a.cost);

    return {
      totalSessions: sessions.length,
      totalCost: Math.round(
        Array.from(costByCategory.values()).reduce((s, v) => s + v, 0),
      ),
      sessionsByStatus,
      byCategory,
    };
  }

  // ============================================================
  // ⏰ ANALYSE HEURES SUP — DÉCRET 78-360 (4 catégories)
  // ============================================================
  async getOvertimeAnalysis(
    userId: string,
    month: number,
    year: number,
    overrideCompanyId?: string,
  ) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) {
      return {
        summary: {
          totalHours: '0.00',
          totalAmount: '0 FCFA',
          employeesWithOvertime: 0,
        },
        byEmployee: [],
      };
    }

    this.logger.log(
      `📊 Heures sup: mois=${month}, année=${year}, company=${companyId}`,
    );

    const payrolls = await this.prisma.payroll.findMany({
      where: { companyId, month, year },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    this.logger.log(
      `✅ ${payrolls.length} bulletins trouvés pour ${month}/${year}`,
    );

    const overtimeByEmployee = payrolls
      .filter(
        (p) =>
          Number((p as any).overtimeHours10 || 0) +
            Number((p as any).overtimeHours25 || 0) +
            Number((p as any).overtimeHours50 || 0) +
            Number((p as any).overtimeHours100 || 0) >
          0,
      )
      .map((p) => {
        const h10 = Number((p as any).overtimeHours10 || 0);
        const h25 = Number((p as any).overtimeHours25 || 0);
        const h50 = Number((p as any).overtimeHours50 || 0);
        const h100 = Number((p as any).overtimeHours100 || 0);
        const a10 = Number((p as any).overtimeAmount10 || 0);
        const a25 = Number((p as any).overtimeAmount25 || 0);
        const a50 = Number((p as any).overtimeAmount50 || 0);
        const a100 = Number((p as any).overtimeAmount100 || 0);
        return {
          name: `${p.employee.firstName} ${p.employee.lastName}`,
          department: p.employee.department?.name || 'N/A',
          overtime10: h10,
          overtime25: h25,
          overtime50: h50,
          overtime100: h100,
          totalOvertime: h10 + h25 + h50 + h100,
          amount: a10 + a25 + a50 + a100,
        };
      });

    this.logger.log(`⏰ ${overtimeByEmployee.length} employés avec heures sup`);

    const totalOvertime = overtimeByEmployee.reduce(
      (sum, e) => sum + e.totalOvertime,
      0,
    );
    const totalAmount = overtimeByEmployee.reduce(
      (sum, e) => sum + e.amount,
      0,
    );

    return {
      summary: {
        totalHours: totalOvertime.toFixed(2),
        totalAmount: totalAmount.toLocaleString() + ' FCFA',
        employeesWithOvertime: overtimeByEmployee.length,
      },
      byEmployee: overtimeByEmployee,
    };
  }

  // ============================================================
  // ANALYSE PAR DÉPARTEMENT
  // ============================================================
  async getDepartmentAnalysis(userId: string, overrideCompanyId?: string) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return [];

    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    const departments = await this.prisma.department.findMany({
      where: { companyId },
      include: {
        employees: {
          where: { status: 'ACTIVE' },
          include: {
            payrolls: {
              where: { month: currentMonth, year: currentYear },
              orderBy: { createdAt: 'desc' },
            },
            leaves: { where: { status: 'APPROVED' } },
          },
        },
      },
    });

    return departments
      .map((dept) => {
        const employeesWithPayroll = dept.employees.filter(
          (emp) => emp.payrolls.length > 0,
        );
        const totalGross = employeesWithPayroll.reduce(
          (sum, emp) => sum + Number(emp.payrolls[0]?.grossSalary || 0),
          0,
        );
        const totalNet = employeesWithPayroll.reduce(
          (sum, emp) => sum + Number(emp.payrolls[0]?.netSalary || 0),
          0,
        );
        const totalCNSS = employeesWithPayroll.reduce(
          (sum, emp) => sum + Number(emp.payrolls[0]?.cnssEmployer || 0),
          0,
        );
        const totalITS = employeesWithPayroll.reduce(
          (sum, emp) => sum + Number(emp.payrolls[0]?.its || 0),
          0,
        );
        const totalLeaves = dept.employees.reduce(
          (sum, emp) => sum + emp.leaves.length,
          0,
        );

        const totalOvertime = employeesWithPayroll.reduce((sum, emp) => {
          const p = emp.payrolls[0] as any;
          if (!p) return sum;
          return (
            sum +
            Number(p.overtimeHours10 || 0) +
            Number(p.overtimeHours25 || 0) +
            Number(p.overtimeHours50 || 0) +
            Number(p.overtimeHours100 || 0)
          );
        }, 0);

        return {
          id: dept.id,
          name: dept.name,
          headcount: employeesWithPayroll.length,
          totalGross,
          totalNet,
          totalCNSS,
          totalITS,
          totalEmployerCost: totalGross + totalCNSS,
          avgSalary:
            employeesWithPayroll.length > 0
              ? totalGross / employeesWithPayroll.length
              : 0,
          totalOvertime: parseFloat(totalOvertime.toFixed(2)),
          totalLeaves,
          color: dept.color,
        };
      })
      .filter((d) => d.totalGross > 0);
  }

  // ============================================================
  // 🆕 VUE DÉPARTEMENT UNIFIÉE — coût + effectif + absences + retards + turnover
  // ============================================================
  async getDepartmentTraceability(userId: string, overrideCompanyId?: string) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return { departments: [], period: { start: '', end: '' } };

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth() - 2, 1); // 3 derniers mois glissants
    const periodStartStr = periodStart.toISOString().slice(0, 10);
    const periodEndStr = now.toISOString().slice(0, 10);

    const [
      departments,
      costData,
      employees,
      lateAttendances,
      absences,
      ruptures12mo,
    ] = await Promise.all([
      this.prisma.department.findMany({
        where: { companyId },
        select: { id: true, name: true, color: true },
      }),
      this.getDepartmentAnalysis(userId, companyId),
      this.prisma.employee.findMany({
        where: { companyId, status: 'ACTIVE' },
        select: { id: true, departmentId: true },
      }),
      this.prisma.attendance.findMany({
        where: {
          companyId,
          status: 'LATE',
          date: { gte: periodStartStr, lte: periodEndStr },
        },
        select: { employeeId: true },
      }),
      this.prisma.absenceRequest.findMany({
        where: {
          companyId,
          status: 'APPROVED',
          startDate: { gte: periodStart },
        },
        select: { employeeId: true, type: true, workingDays: true },
      }),
      this.prisma.contractRupture.findMany({
        where: {
          companyId,
          ruptureDate: { gte: periodStart },
          status: { in: ['VALIDE', 'PAYE', 'CONTESTE', 'ARCHIVE'] },
        },
        select: { employeeId: true },
      }),
    ]);

    const deptIdByEmployeeId = new Map(
      employees.map((e) => [e.id, e.departmentId]),
    );
    const headcountByDept = new Map<string, number>();
    for (const e of employees)
      if (e.departmentId)
        headcountByDept.set(
          e.departmentId,
          (headcountByDept.get(e.departmentId) || 0) + 1,
        );

    const lateByDept = new Map<string, number>();
    for (const a of lateAttendances) {
      const deptId = deptIdByEmployeeId.get(a.employeeId);
      if (deptId) lateByDept.set(deptId, (lateByDept.get(deptId) || 0) + 1);
    }

    const absenceCountByDept = new Map<string, number>();
    const absenceDaysByDept = new Map<string, number>();
    const absenceByTypeByDept = new Map<string, Record<string, number>>();
    for (const a of absences) {
      const deptId = deptIdByEmployeeId.get(a.employeeId);
      if (!deptId) continue;
      absenceCountByDept.set(deptId, (absenceCountByDept.get(deptId) || 0) + 1);
      absenceDaysByDept.set(
        deptId,
        (absenceDaysByDept.get(deptId) || 0) + Number(a.workingDays),
      );
      const byType = absenceByTypeByDept.get(deptId) || {
        MALADIE: 0,
        CONVENTIONNELLE: 0,
        EXCEPTIONNELLE: 0,
      };
      byType[a.type] = (byType[a.type] || 0) + 1;
      absenceByTypeByDept.set(deptId, byType);
    }

    const departuresByDept = new Map<string, number>();
    for (const r of ruptures12mo) {
      const deptId = deptIdByEmployeeId.get(r.employeeId);
      if (deptId)
        departuresByDept.set(deptId, (departuresByDept.get(deptId) || 0) + 1);
    }

    const costById = new Map(costData.map((d: any) => [d.id, d]));

    const rows = departments.map((dept) => {
      const headcount = headcountByDept.get(dept.id) || 0;
      const cost = costById.get(dept.id);
      return {
        id: dept.id,
        name: dept.name,
        color: dept.color,
        headcount,
        totalEmployerCost: cost?.totalEmployerCost || 0,
        avgSalary: cost?.avgSalary || 0,
        totalOvertime: cost?.totalOvertime || 0,
        lateCount: lateByDept.get(dept.id) || 0,
        absenceCount: absenceCountByDept.get(dept.id) || 0,
        absenceDays:
          Math.round((absenceDaysByDept.get(dept.id) || 0) * 10) / 10,
        absencesByType: absenceByTypeByDept.get(dept.id) || {
          MALADIE: 0,
          CONVENTIONNELLE: 0,
          EXCEPTIONNELLE: 0,
        },
        departureCount: departuresByDept.get(dept.id) || 0,
        // Taux "pour 10 employés" — comparable même si les départements n'ont pas la même taille
        lateRatePer10:
          headcount > 0
            ? Math.round(
                ((lateByDept.get(dept.id) || 0) / headcount) * 10 * 10,
              ) / 10
            : 0,
        absenceRatePer10:
          headcount > 0
            ? Math.round(
                ((absenceCountByDept.get(dept.id) || 0) / headcount) * 10 * 10,
              ) / 10
            : 0,
      };
    });

    // ── Moyennes de l'entreprise, pour détecter les départements hors norme ──
    const nonEmpty = rows.filter((r) => r.headcount > 0);
    const avg = (key: 'lateRatePer10' | 'absenceRatePer10') =>
      nonEmpty.length > 0
        ? nonEmpty.reduce((s, r) => s + r[key], 0) / nonEmpty.length
        : 0;
    const avgLateRate = avg('lateRatePer10');
    const avgAbsenceRate = avg('absenceRatePer10');

    // 🆕 Alertes : département à ≥ 1.5x la moyenne entreprise sur retards ou absences
    const alerts = rows
      .filter(
        (r) =>
          r.headcount > 0 &&
          ((avgLateRate > 0 && r.lateRatePer10 >= avgLateRate * 1.5) ||
            (avgAbsenceRate > 0 && r.absenceRatePer10 >= avgAbsenceRate * 1.5)),
      )
      .map((r) => ({
        department: r.name,
        reason:
          r.lateRatePer10 >= avgLateRate * 1.5 &&
          r.absenceRatePer10 >= avgAbsenceRate * 1.5
            ? 'Retards et absences au-dessus de la moyenne'
            : r.lateRatePer10 >= avgLateRate * 1.5
              ? 'Retards au-dessus de la moyenne'
              : 'Absences au-dessus de la moyenne',
      }));

    return {
      period: {
        start: periodStartStr,
        end: periodEndStr,
        label: '3 derniers mois',
      },
      companyAverages: {
        lateRatePer10: Math.round(avgLateRate * 10) / 10,
        absenceRatePer10: Math.round(avgAbsenceRate * 10) / 10,
      },
      departments: rows.sort((a, b) => b.headcount - a.headcount),
      alerts,
    };
  }

  // ============================================================
  // 🆕 VUE EMPLOYÉ / TRAÇABILITÉ INDIVIDUELLE
  // ============================================================
  async getEmployeeTraceability(userId: string, overrideCompanyId?: string) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId)
      return {
        employees: [],
        period: { start: '', end: '', label: '' },
        companyAverages: { late: 0, absences: 0 },
        alerts: [],
      };

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth() - 2, 1); // 3 derniers mois glissants
    const periodStartStr = periodStart.toISOString().slice(0, 10);
    const periodEndStr = now.toISOString().slice(0, 10);
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const [employees, lateAttendances, absences] = await Promise.all([
      this.prisma.employee.findMany({
        where: { companyId, status: 'ACTIVE' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          position: true,
          hireDate: true,
          department: { select: { name: true } },
          payrolls: {
            where: { month: currentMonth, year: currentYear },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.attendance.findMany({
        where: {
          companyId,
          status: 'LATE',
          date: { gte: periodStartStr, lte: periodEndStr },
        },
        select: { employeeId: true },
      }),
      this.prisma.absenceRequest.findMany({
        where: {
          companyId,
          status: 'APPROVED',
          startDate: { gte: periodStart },
        },
        select: { employeeId: true, type: true, workingDays: true },
      }),
    ]);

    const lateByEmployee = new Map<string, number>();
    for (const a of lateAttendances)
      lateByEmployee.set(
        a.employeeId,
        (lateByEmployee.get(a.employeeId) || 0) + 1,
      );

    const absenceCountByEmployee = new Map<string, number>();
    const absenceDaysByEmployee = new Map<string, number>();
    const absenceByTypeByEmployee = new Map<string, Record<string, number>>();
    for (const a of absences) {
      absenceCountByEmployee.set(
        a.employeeId,
        (absenceCountByEmployee.get(a.employeeId) || 0) + 1,
      );
      absenceDaysByEmployee.set(
        a.employeeId,
        (absenceDaysByEmployee.get(a.employeeId) || 0) + Number(a.workingDays),
      );
      const byType = absenceByTypeByEmployee.get(a.employeeId) || {
        MALADIE: 0,
        CONVENTIONNELLE: 0,
        EXCEPTIONNELLE: 0,
      };
      byType[a.type] = (byType[a.type] || 0) + 1;
      absenceByTypeByEmployee.set(a.employeeId, byType);
    }

    const rows = employees.map((e) => {
      const p = e.payrolls[0] as any;
      const h10 = Number(p?.overtimeHours10 || 0);
      const h25 = Number(p?.overtimeHours25 || 0);
      const h50 = Number(p?.overtimeHours50 || 0);
      const h100 = Number(p?.overtimeHours100 || 0);
      return {
        id: e.id,
        name: `${e.firstName} ${e.lastName}`,
        position: e.position,
        department: e.department?.name ?? 'Sans département',
        seniorityYears:
          Math.round(this.tenureInYears(new Date(e.hireDate)) * 10) / 10,
        grossSalary: Number(p?.grossSalary || 0),
        overtimeHours: Math.round((h10 + h25 + h50 + h100) * 100) / 100,
        lateCount: lateByEmployee.get(e.id) || 0,
        absenceCount: absenceCountByEmployee.get(e.id) || 0,
        absenceDays:
          Math.round((absenceDaysByEmployee.get(e.id) || 0) * 10) / 10,
        absencesByType: absenceByTypeByEmployee.get(e.id) || {
          MALADIE: 0,
          CONVENTIONNELLE: 0,
          EXCEPTIONNELLE: 0,
        },
      };
    });

    // ── Moyennes entreprise (par employé) pour détecter les cas hors norme ──
    const avg = (key: 'lateCount' | 'absenceCount') =>
      rows.length > 0 ? rows.reduce((s, r) => s + r[key], 0) / rows.length : 0;
    const avgLate = avg('lateCount');
    const avgAbsences = avg('absenceCount');

    // 🆕 Alertes individuelles : ≥ 2x la moyenne entreprise (seuil plus large qu'au niveau département,
    // pour éviter de signaler trop d'employés sur de petits écarts individuels) ET au moins 3 incidents
    const alerts = rows
      .filter(
        (r) =>
          (r.lateCount >= 3 && avgLate > 0 && r.lateCount >= avgLate * 2) ||
          (r.absenceCount >= 3 &&
            avgAbsences > 0 &&
            r.absenceCount >= avgAbsences * 2),
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        department: r.department,
        reason:
          r.lateCount >= avgLate * 2 && r.absenceCount >= avgAbsences * 2
            ? 'Retards et absences fréquents'
            : r.lateCount >= avgLate * 2
              ? 'Retards fréquents'
              : 'Absences fréquentes',
      }));

    return {
      period: {
        start: periodStartStr,
        end: periodEndStr,
        label: '3 derniers mois',
      },
      companyAverages: {
        late: Math.round(avgLate * 10) / 10,
        absences: Math.round(avgAbsences * 10) / 10,
      },
      employees: rows.sort(
        (a, b) => b.lateCount + b.absenceCount - (a.lateCount + a.absenceCount),
      ),
      alerts,
    };
  }

  // ============================================================
  // COMPARAISON MOIS
  // ============================================================
  async getMonthComparison(
    userId: string,
    currentMonth: number,
    currentYear: number,
    overrideCompanyId?: string,
  ) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return {};

    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    const [current, previous] = await Promise.all([
      this.prisma.payroll.aggregate({
        where: { companyId, month: currentMonth, year: currentYear },
        _sum: { grossSalary: true, netSalary: true, totalEmployerCost: true },
        _count: true,
      }),
      this.prisma.payroll.aggregate({
        where: { companyId, month: prevMonth, year: prevYear },
        _sum: { grossSalary: true, netSalary: true, totalEmployerCost: true },
        _count: true,
      }),
    ]);

    const calcVariation = (curr: number, prev: number) => {
      if (prev === 0) return 0;
      return parseFloat((((curr - prev) / prev) * 100).toFixed(2));
    };

    return {
      current: {
        month: currentMonth,
        year: currentYear,
        gross: current._sum.grossSalary || 0,
        net: current._sum.netSalary || 0,
        cost: current._sum.totalEmployerCost || 0,
        count: current._count,
      },
      previous: {
        month: prevMonth,
        year: prevYear,
        gross: previous._sum.grossSalary || 0,
        net: previous._sum.netSalary || 0,
        cost: previous._sum.totalEmployerCost || 0,
        count: previous._count,
      },
      variations: {
        grossPercent: calcVariation(
          Number(current._sum.grossSalary || 0),
          Number(previous._sum.grossSalary || 0),
        ),
        netPercent: calcVariation(
          Number(current._sum.netSalary || 0),
          Number(previous._sum.netSalary || 0),
        ),
        costPercent: calcVariation(
          Number(current._sum.totalEmployerCost || 0),
          Number(previous._sum.totalEmployerCost || 0),
        ),
        countDiff: current._count - previous._count,
      },
    };
  }

  // ============================================================
  // TOP EMPLOYÉS
  // ============================================================
  async getTopEmployeesReport(userId: string, overrideCompanyId?: string) {
    const companyId = await this.resolveCompanyId(userId, overrideCompanyId);
    if (!companyId) return { topOvertime: [], topLeaves: [] };

    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE' },
      include: {
        payrolls: { take: 1, orderBy: { createdAt: 'desc' } },
        leaves: { where: { status: 'APPROVED' } },
        department: { select: { name: true } },
      },
    });

    const withOvertime = employees
      .filter((emp) => {
        const p = emp.payrolls[0] as any;
        if (!p) return false;
        return (
          Number(p.overtimeHours10 || 0) +
            Number(p.overtimeHours25 || 0) +
            Number(p.overtimeHours50 || 0) +
            Number(p.overtimeHours100 || 0) >
          0
        );
      })
      .map((emp) => {
        const p = emp.payrolls[0] as any;
        const h10 = Number(p.overtimeHours10 || 0);
        const h25 = Number(p.overtimeHours25 || 0);
        const h50 = Number(p.overtimeHours50 || 0);
        const h100 = Number(p.overtimeHours100 || 0);
        const a10 = Number(p.overtimeAmount10 || 0);
        const a25 = Number(p.overtimeAmount25 || 0);
        const a50 = Number(p.overtimeAmount50 || 0);
        const a100 = Number(p.overtimeAmount100 || 0);
        return {
          id: emp.id,
          name: `${emp.firstName} ${emp.lastName}`,
          department: emp.department?.name || 'N/A',
          overtime10: h10,
          overtime25: h25,
          overtime50: h50,
          overtime100: h100,
          totalOvertime: h10 + h25 + h50 + h100,
          overtimeAmount: a10 + a25 + a50 + a100,
        };
      })
      .sort((a, b) => b.totalOvertime - a.totalOvertime);

    const withMostLeaves = employees
      .map((emp) => ({
        id: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        department: emp.department?.name || 'N/A',
        leavesCount: emp.leaves.length,
        leavesDays: emp.leaves.reduce((sum, l) => sum + Number(l.daysCount), 0),
      }))
      .sort((a, b) => b.leavesDays - a.leavesDays);

    return { topOvertime: withOvertime, topLeaves: withMostLeaves };
  }
}