// // ============================================================================
// // 📁 src/payrolls/services/payroll-generator.service.ts
// // ✅ Taxes custom chargées via CompanyTaxService.findActive()
// // ✅ isSubjectToTus récupéré sur company
// // ✅ companyTaxes passé au calculator.calculate()
// // ============================================================================

// import { Injectable, Logger } from '@nestjs/common';
// import { PrismaService } from '../../prisma/prisma.service';
// import { Prisma } from '@prisma/client';
// import { AttendanceSummaryService } from '../../attendance/attendance-summary.service';
// import { PayrollSettingsService } from '../../payroll/settings/settings.service';
// import { PayrollCalculatorService } from './payroll-calculator.service';
// import { PayrollItemsService } from './payroll-items.service';
// import { PayrollSmicProtectionService } from './payroll-smic-protection.service';
// import { PayrollDeductionsService } from './payroll-deductions.service';
// import { CompanyNotFoundException } from '../../exceptions/business.exceptions';
// import { SubscriptionGuard } from '../../subscriptions/guards/subscription.guard';
// import { PayrollBonusesService } from './payroll-bonuses.service';
// import { CompanyTaxService } from '../../company-taxes/company-tax.service'; // ✅

// interface PayrollData {
//   emp: any; calc: any; summary: any;
//   loans: any[]; advances: any[];
//   loansToUpdate: Array<{ id: string; deduction: number }>;
//   advancesToDeduct: string[];
//   deductionWarnings: string[];
//   calculatedBonuses: any[];
//   monthNum: number; year: number;
//   companyId: string; userId: string;
//   customWorkDays?: number; settings: any;
// }

// @Injectable()
// export class PayrollGeneratorService {
//   private readonly logger = new Logger(PayrollGeneratorService.name);

//   constructor(
//     private prisma: PrismaService,
//     private attendanceSummary: AttendanceSummaryService,
//     private payrollSettings: PayrollSettingsService,
//     private calculator: PayrollCalculatorService,
//     private itemsService: PayrollItemsService,
//     private smicProtection: PayrollSmicProtectionService,
//     private deductionsService: PayrollDeductionsService,
//     private subscriptionGuard: SubscriptionGuard,
//     private bonusesService: PayrollBonusesService,
//     private companyTaxService: CompanyTaxService, // ✅
//   ) {}

//   async generate(
//     userId: string, month: number, year: number,
//     employeeIds?: string[], customWorkDays?: number
//   ) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId }, select: { companyId: true }
//     });
//     if (!user?.companyId) throw new CompanyNotFoundException();

//     await this.subscriptionGuard.checkFeatureAccess(user.companyId, 'hasPayrollBulk');

//     const companyId = user.companyId;
//     const monthNum  = typeof month === 'string' ? parseInt(month as any) : month;

//     this.logger.log(`🚀 Génération paie ${monthNum}/${year} pour company ${companyId}`);

//     const [settings, company, companyTaxes] = await Promise.all([
//       this.payrollSettings.getSettingsByCompanyId(companyId),
//       this.prisma.company.findUnique({
//         where: { id: companyId },
//         select: { appliesCnssEmployer: true, cnssEmployerRate: true, isSubjectToTus: true, seniorityMode: true // 🆕 }
//       }),
//       this.companyTaxService.findActive(companyId), // ✅ Charger les taxes actives une seule fois
//     ]);

//     this.logger.log(`💼 ${companyTaxes.length} taxe(s) custom active(s) pour cette paie`);

//     const whereClause: any = { companyId, status: 'ACTIVE' };
//     if (employeeIds?.length) whereClause.id = { in: employeeIds };

//     const employees = await this.prisma.employee.findMany({
//       where: whereClause,
//       select: {
//         id: true, firstName: true, lastName: true, baseSalary: true,
//         maritalStatus: true, numberOfChildren: true,
//         isSubjectToIrpp: true, isSubjectToCnss: true, isSubjectToTus: true,
//         taxExemptionReason: true, tolZone: true
//       }
//     });

//     if (employees.length === 0) {
//       return { success: true, message: 'Aucun employé actif trouvé', count: 0, details: [] };
//     }

//     const employeeIdsList = employees.map(e => e.id);

//     await this.attendanceSummary.generateAndStoreAllMonthlySummaries(companyId, monthNum, year);

//     const summaries = await this.attendanceSummary.getStoredSummaries(
//       companyId, monthNum, year, employeeIdsList
//     );

//     if (summaries.length === 0) {
//       return { success: true, message: 'Aucun résumé RH trouvé', count: 0, details: [] };
//     }

//     const [loansByEmployee, advancesByEmployee, existingPayrolls] = await Promise.all([
//       this.deductionsService.getLoansByEmployees(employeeIdsList),
//       this.deductionsService.getAdvancesByEmployees(employeeIdsList, monthNum, year),
//       this.prisma.payroll.findMany({
//         where: { employeeId: { in: employeeIdsList }, month: monthNum, year, companyId },
//         select: { employeeId: true }
//       })
//     ]);

//     const existingEmployeeIds = new Set(existingPayrolls.map(p => p.employeeId));
//     const results = { success: 0, skipped: 0, failed: 0, warnings: 0, details: [] as any[] };
//     const payrollsToCreate: PayrollData[] = [];

//     const baseSalaries: Record<string, number> = {};
//     employees.forEach(e => baseSalaries[e.id] = Number(e.baseSalary));

//     const bonusesByEmployee = await this.bonusesService.getBonusesByEmployees(
//       employeeIdsList, baseSalaries, monthNum, year
//     );

//     for (const summary of summaries) {
//       try {
//         if (existingEmployeeIds.has(summary.employeeId)) {
//           results.skipped++;
//           results.details.push({
//             employeeId:   summary.employeeId,
//             employeeName: `${summary.employee.firstName} ${summary.employee.lastName}`,
//             status: 'SKIPPED', reason: 'Bulletin déjà existant'
//           });
//           continue;
//         }

//         const emp = employees.find(e => e.id === summary.employeeId);
//         if (!emp) continue;

//         if (summary.daysToPay <= 0) {
//           results.skipped++;
//           results.details.push({
//             employeeId: emp.id, employeeName: `${emp.firstName} ${emp.lastName}`,
//             status: 'SKIPPED', reason: 'Aucun jour travaillé'
//           });
//           continue;
//         }

//         const loans             = loansByEmployee[emp.id]   || [];
//         const advances          = advancesByEmployee[emp.id] || [];
//         const calculatedBonuses = bonusesByEmployee[emp.id]  || [];

//         const hasVoluntaryDeductions = loans.length > 0 || advances.length > 0;
//         const protectionMode = this.smicProtection.determineMode(Number(emp.baseSalary), hasVoluntaryDeductions);

//         const ot10  = Number((summary as any).overtime10Hours  || 0);
//         const ot25  = Number((summary as any).overtime25Hours  || 0);
//         const ot50  = Number(summary.overtime50Hours           || 0);
//         const ot100 = Number((summary as any).overtime100Hours || 0);
//         const workDays = customWorkDays || settings.workDaysPerMonth;

//         // ✅ companyTaxes passé au calculator
//         const prelimCalc = this.calculator.calculate(
//           Number(emp.baseSalary), ot10, ot25, ot50, ot100,
//           calculatedBonuses, [], settings, summary.daysToPay, workDays, emp, company, companyTaxes
//         );

//         const { adjustedDeductions, loansToUpdate, advancesToDeduct, canProceed, warnings: deductionWarnings } =
//           this.smicProtection.handleDeductions(emp, prelimCalc, loans, advances, protectionMode);

//         if (!canProceed) {
//           results.failed++;
//           results.details.push({
//             employeeId: emp.id, employeeName: `${emp.firstName} ${emp.lastName}`,
//             status: 'FAILED', reason: 'Net insuffisant pour SMIC (mode STRICT)'
//           });
//           continue;
//         }

//         if (deductionWarnings.length > 0) {
//           results.warnings++;
//           deductionWarnings.forEach(w => this.logger.warn(w));
//         }

//         // ✅ companyTaxes passé au calculator (calcul final)
//         const calc = this.calculator.calculate(
//           Number(emp.baseSalary), ot10, ot25, ot50, ot100,
//           calculatedBonuses, adjustedDeductions, settings, summary.daysToPay, workDays, emp, company, companyTaxes
//         );

//         payrollsToCreate.push({
//           emp, calc, summary, loans, advances,
//           loansToUpdate, advancesToDeduct, deductionWarnings, calculatedBonuses,
//           monthNum, year, companyId, userId, customWorkDays, settings
//         });

//       } catch (error: any) {
//         results.failed++;
//         results.details.push({
//           employeeId:   summary.employeeId,
//           employeeName: `${summary.employee.firstName} ${summary.employee.lastName}`,
//           status: 'FAILED', reason: error.message || 'Erreur inconnue'
//         });
//       }
//     }

//     for (const data of payrollsToCreate) {
//       try {
//         const payroll = await this.createPayrollTransaction(data);
//         results.success++;
//         results.details.push({
//           employeeId: data.emp.id, employeeName: `${data.emp.firstName} ${data.emp.lastName}`,
//           status: 'SUCCESS', payrollId: payroll.id, netSalary: data.calc.netSalary,
//           warnings: data.deductionWarnings.length > 0 ? data.deductionWarnings.join(', ') : null
//         });
//       } catch (error: any) {
//         results.failed++;
//         let errorMessage = error.message || 'Erreur inconnue';
//         if (error.code === 'P2002') errorMessage = 'Bulletin déjà existant (doublon)';
//         else if (error.code === 'P2028') errorMessage = 'Transaction timeout';
//         results.details.push({
//           employeeId: data.emp.id, employeeName: `${data.emp.firstName} ${data.emp.lastName}`,
//           status: 'FAILED', reason: errorMessage
//         });
//       }
//     }

//     this.logger.log(`✅ Génération : ${results.success} créés, ${results.skipped} ignorés, ${results.failed} échecs`);

//     return {
//       success: true,
//       message: `Génération terminée : ${results.success} créés, ${results.skipped} ignorés, ${results.failed} échecs`,
//       count: results.success, totalEmployees: employees.length,
//       created: results.success, skipped: results.skipped,
//       failed: results.failed, warnings: results.warnings, details: results.details
//     };
//   }

//   private async createPayrollTransaction(data: PayrollData) {
//     return this.prisma.$transaction(async (tx) => {
//       const newPayroll = await tx.payroll.create({
//         data: {
//           employeeId: data.emp.id, companyId: data.companyId,
//           month: data.monthNum, year: data.year,
//           periodStart: new Date(data.year, data.monthNum - 1, 1),
//           periodEnd:   new Date(data.year, data.monthNum, 0),
//           workDays:    data.customWorkDays || data.settings.workDaysPerMonth,
//           workedDays:  data.summary.daysToPay,
//           absenceDays: data.summary.daysToDeduct,
//           daysOnLeave: data.summary.daysOnLeave,
//           daysRemote:  data.summary.daysRemote,
//           daysHoliday: data.summary.daysHoliday,
//           overtimeHours10:  Number((data.summary as any).overtime10Hours  || 0),
//           overtimeHours25:  Number((data.summary as any).overtime25Hours  || 0),
//           overtimeHours50:  Number(data.summary.overtime50Hours  || 0),
//           overtimeHours100: Number((data.summary as any).overtime100Hours || 0),
//           baseSalary:         Number(data.emp.baseSalary),
//           adjustedBaseSalary: data.calc.adjustedBaseSalary,
//           absenceDeduction:   data.calc.absenceDeduction,
//           overtimeAmount10:   data.calc.overtimeAmount10,
//           overtimeAmount25:   data.calc.overtimeAmount25,
//           overtimeAmount50:   data.calc.overtimeAmount50,
//           overtimeAmount100:  data.calc.overtimeAmount100,
//           totalOvertimeAmount: data.calc.totalOvertimeAmount,
//           totalBonuses:       data.calc.totalBonuses,
//           grossSalary:        data.calc.grossSalary,
//           netSalary:          data.calc.netSalary,
//           cnssSalarial:       data.calc.cnssSalarial,
//           cnssEmployer:       data.calc.cnssEmployer,
//           its:                data.calc.its,
//           totalDeductions:    data.calc.totalDeductions,
//           totalEmployerCost:  data.calc.totalEmployerCost,
//           irppAbattement:    data.calc.irppDetails?.abattement    || 0,
//           irppFiscalParts:   data.calc.irppDetails?.fiscalParts   || 1,
//           irppEffectiveRate: data.calc.irppDetails?.effectiveRate || 0,
//           cnssEmployerPension:  data.calc.cnssEmployerPension,
//           cnssEmployerFamily:   data.calc.cnssEmployerFamily,
//           cnssEmployerAccident: data.calc.cnssEmployerAccident,
//           tusDgiAmount:  data.calc.tusDgiAmount,
//           tusCnssAmount: data.calc.tusCnssAmount,
//           tusTotal:      data.calc.tusTotal,
//           // ✅ Taxes custom stockées en BDD
//           employeeCustomTaxTotal: data.calc.employeeCustomTaxTotal,
//           employerCustomTaxTotal: data.calc.employerCustomTaxTotal,
//           status: 'DRAFT', createdById: data.userId
//         } as any
//       });

//       await this.itemsService.create(
//         tx, newPayroll.id, data.emp, data.calc, data.summary,
//         data.loans, data.advances, data.settings, data.calculatedBonuses
//       );

//       for (const loanUpdate of data.loansToUpdate) {
//         const loan = data.loans.find(l => l.id === loanUpdate.id);
//         if (loan) {
//           await this.deductionsService.updateLoan(
//             tx, loanUpdate.id, loanUpdate.deduction, Number(loan.remainingBalance),
//             data.monthNum, data.year, loanUpdate.deduction < Number(loan.monthlyRepayment)
//           );
//         }
//       }

//       await this.deductionsService.markAdvancesAsDeducted(tx, data.advancesToDeduct);
//       return newPayroll;
//     }, { maxWait: 10000, timeout: 20000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
//   }
// }

// ============================================================================
// 📁 src/payrolls/services/payroll-generator.service.ts
// ✅ INTÉGRATION CONGÉS COMPLÈTE
//    - Indemnité de congé calculée sur moyenne 12 mois
//    - Distinction congé payé vs non payé
//    - Primes proratisées selon présence réelle
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AttendanceSummaryService } from '../../attendance/attendance-summary.service';
import { PayrollSettingsService } from '../../payroll/settings/settings.service';
import { PayrollCalculatorService } from './payroll-calculator.service';
import { PayrollItemsService } from './payroll-items.service';
import { PayrollSmicProtectionService } from './payroll-smic-protection.service';
import { PayrollDeductionsService } from './payroll-deductions.service';
import { CompanyNotFoundException } from '../../exceptions/business.exceptions';
import { SubscriptionGuard } from '../../subscriptions/guards/subscription.guard';
import { PayrollBonusesService } from './payroll-bonuses.service';
import { CompanyTaxService } from '../../company-taxes/company-tax.service';
import { LeavesService } from '../../leaves/leaves.service'; // 🆕
import { YtdCheckpointService } from './ytd-checkpoint.service';

// 🆕 Interface pour les données congé passées au calculator
export interface LeaveCalculationOptions {
  leaveIndemnity: number;
  isPaidLeave: boolean;
}

interface PayrollData {
  emp: any;
  calc: any;
  summary: any;
  loans: any[];
  advances: any[];
  loansToUpdate: Array<{ id: string; deduction: number }>;
  advancesToDeduct: string[];
  // 🆕 Retenues diverses (pharmacie, cantine, casse matériel...) — voir
  // PayrollDeductionsService.prepareCompanyDeductionsForCalc.
  companyDeductions: any[];
  companyDeductionsToApply: Array<{ id: string; amount: number; label: string }>;
  deductionWarnings: string[];
  calculatedBonuses: any[];
  monthNum: number;
  year: number;
  companyId: string;
  userId: string;
  customWorkDays?: number;
  settings: any;
  // 🆕 Données congé
  leaveIndemnity: number;
  leaveIndemnityBase?: number;
  leaveIndemnitySeniority?: number;
  // 🆕 Mode ANNIVERSARY : id du Leave ANNUAL dont ce bulletin paie
  // l'indemnité — sert à figer paidIndemnityAmount sur ce Leave une fois
  // le bulletin réellement créé (voir plus bas, après createPayrollTransaction).
  leaveId?: string;
  absenceDeduction: number;
  isPaidLeave: boolean;
  leaveDays: number;
  leaveLabel: string;
  // ✅ Jours servant au libellé/quantité de la ligne indemnité — distinct
  // de leaveDays (jours d'absence physique du mois). Voir
  // payroll-items.service.ts.
  indemnifiedDays?: number;
  indemnifiedSeniorityDays?: number;
  // ✅ Snapshot solde congés figé au moment de la génération
  leaveBalanceSnap: {
    annualEntitled: any;
    annualTaken: any;
    annualRemaining: any;
  } | null;
  // ✅ true si l'indemnité de ce bulletin a puisé dans le cumul
  // d'onboarding (openingCumulativeGross/Months) — à vider sur l'employé
  // UNIQUEMENT après la création réussie du bulletin ci-dessous, jamais
  // avant (voir clearOpeningCumulativeAfterUse dans leaves-indemnity.service.ts).
  shouldClearOpeningCumulative?: boolean;
}

// ✅ Détail enrichi transmis en live à chaque bulletin traité (utilisé pour
// le flux temps réel de la paie en masse — plus juste "succès/échec", mais
// aussi jours travaillés, avances/prêts déduits, net à payer).
export interface PayrollGenerationDetail {
  employeeId: string;
  employeeName: string;
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
  reason?: string | null;
  payrollId?: string;
  netSalary?: number;
  grossSalary?: number;
  workedDays?: number;
  loanDeduction?: number;
  advanceDeduction?: number;
  leaveIndemnity?: number;
  warnings?: string | null;
}

// ✅ Exécute `fn` sur chaque élément de `items` avec au plus `limit` appels
// en vol simultanément — sans dépendance externe (pas de p-limit). Remplace
// les boucles `for...await` strictement séquentielles qui, pour un lot de
// 100+ employés, empilaient les temps de chaque appel réseau/DB un par un
// (100 × ~200-300ms ≈ 20-30s) au lieu de les paralléliser dans une limite
// raisonnable pour le pool de connexions Postgres.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const current = cursor++;
      results[current] = await fn(items[current], current);
    }
  };
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

@Injectable()
export class PayrollGeneratorService {
  private readonly logger = new Logger(PayrollGeneratorService.name);

  constructor(
    private prisma: PrismaService,
    private attendanceSummary: AttendanceSummaryService,
    private payrollSettings: PayrollSettingsService,
    private calculator: PayrollCalculatorService,
    private itemsService: PayrollItemsService,
    private smicProtection: PayrollSmicProtectionService,
    private deductionsService: PayrollDeductionsService,
    private subscriptionGuard: SubscriptionGuard,
    private bonusesService: PayrollBonusesService,
    private companyTaxService: CompanyTaxService,
    private leavesService: LeavesService, // 🆕
    private ytdCheckpointService: YtdCheckpointService,
  ) {}

  async generate(
    userId: string,
    month: number,
    year: number,
    employeeIds?: string[],
    customWorkDays?: number,
    // ✅ Callback optionnel appelé en LIVE dès qu'un bulletin est traité
    // (succès, ignoré ou échec) — permet au contrôleur de streamer la
    // progression réelle au frontend au lieu de tout renvoyer d'un bloc
    // à la toute fin. N'existe que pour l'UX ; le comportement de calcul
    // est identique avec ou sans callback.
    onProgress?: (detail: PayrollGenerationDetail) => void,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new CompanyNotFoundException();

    await this.subscriptionGuard.checkFeatureAccess(
      user.companyId,
      'hasPayrollBulk',
    );

    const companyId = user.companyId;
    const monthNum = typeof month === 'string' ? parseInt(month) : month;

    this.logger.log(
      `🚀 Génération paie ${monthNum}/${year} pour company ${companyId}`,
    );

    const [settings, company, companyTaxes] = await Promise.all([
      this.payrollSettings.getSettingsByCompanyId(companyId),
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: {
          appliesCnssEmployer: true,
          cnssEmployerRate: true,
          isSubjectToTus: true,
        },
      }),
      this.companyTaxService.findActive(companyId),
    ]);

    const whereClause: any = {
      companyId,
      status: 'ACTIVE',
      // INTERIM : pas de bulletin côté entreprise — l'agence d'intérim gère la paie
      contractType: { not: 'INTERIM' },
    };
    if (employeeIds?.length) whereClause.id = { in: employeeIds };

    const employees = await this.prisma.employee.findMany({
      where: whereClause,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        baseSalary: true,
        maritalStatus: true,
        numberOfChildren: true,
        isSubjectToIrpp: true,
        isSubjectToCnss: true,
        isSubjectToTus: true,
        taxExemptionReason: true,
        tolZone: true,
        contractType: true, // ← essentiel pour les règles fiscales par contrat
        hireDate: true, // 🆕 pour calcul ancienneté automatique
      },
    });

    if (employees.length === 0) {
      return {
        success: true,
        message: 'Aucun employé actif trouvé',
        count: 0,
        details: [],
      };
    }

    const employeeIdsList = employees.map((e) => e.id);

    await this.attendanceSummary.generateAndStoreAllMonthlySummaries(
      companyId,
      monthNum,
      year,
    );

    const summaries = await this.attendanceSummary.getStoredSummaries(
      companyId,
      monthNum,
      year,
      employeeIdsList,
    );

    if (summaries.length === 0) {
      return {
        success: true,
        message: 'Aucun résumé RH trouvé',
        count: 0,
        details: [],
      };
    }

    const [loansByEmployee, advancesByEmployee, companyDeductionsByEmployee, existingPayrolls] =
      await Promise.all([
        this.deductionsService.getLoansByEmployees(
          employeeIdsList,
          monthNum,
          year,
        ),
        this.deductionsService.getAdvancesByEmployees(
          employeeIdsList,
          monthNum,
          year,
        ),
        this.deductionsService.getPendingCompanyDeductions(employeeIdsList),
        this.prisma.payroll.findMany({
          where: {
            employeeId: { in: employeeIdsList },
            month: monthNum,
            year,
            companyId,
          },
          select: { employeeId: true },
        }),
      ]);

    const existingEmployeeIds = new Set(
      existingPayrolls.map((p) => p.employeeId),
    );
    const results = {
      success: 0,
      skipped: 0,
      failed: 0,
      warnings: 0,
      details: [] as any[],
    };
    const payrollsToCreate: PayrollData[] = [];

    const baseSalaries: Record<string, number> = {};
    employees.forEach((e) => (baseSalaries[e.id] = Number(e.baseSalary)));

    // 🆕 hireDateMap pour calcul ancienneté auto
    const hireDateMap: Record<string, Date | null> = {};
    employees.forEach((e) => {
      hireDateMap[e.id] = (e as any).hireDate
        ? new Date((e as any).hireDate)
        : null;
    });
    const seniorityMode = (company as any).seniorityMode ?? 'AUTO';

    // 🆕 Charger les impacts congés pour tous les employés en parallèle
    const leaveBalancesByEmployee: Record<string, any> = {};
    await Promise.all(
      // ✅ CORRECTIF (bug trouvé) : snapshot solde congés — lisait
      // seulement le cycle le PLUS RÉCENT de l'employé (findFirst orderBy
      // desc), sous-évaluant le solde d'un employé avec plusieurs cycles
      // non soldés (même correctif que Provision). Solde TOTAL réel
      // désormais (somme de tous les cycles), figé sur chaque bulletin au
      // moment de la génération.
      employeeIdsList.map(async (empId) => {
        try {
          leaveBalancesByEmployee[empId] =
            await this.leavesService.getTotalLeaveBalanceSummary(empId);
        } catch {
          leaveBalancesByEmployee[empId] = null;
        }
      }),
    );
    // ✅ CORRECTIF ("le trou") : leaveImpact n'est plus chargé en bloc AVANT
    // la boucle — il dépend maintenant du brut de travail du mois en cours
    // (calculatedBonuses inclus), qui n'est connu qu'À L'INTÉRIEUR de la
    // boucle, par employé. Voir plus bas (leaveImpactsByEmployee retiré).

    for (const summary of summaries) {
      try {
        if (existingEmployeeIds.has(summary.employeeId)) {
          results.skipped++;
          results.details.push({
            employeeId: summary.employeeId,
            employeeName: `${summary.employee.firstName} ${summary.employee.lastName}`,
            status: 'SKIPPED',
            reason: 'Bulletin déjà existant',
          });
          onProgress?.(results.details[results.details.length - 1]);
          continue;
        }

        const emp = employees.find((e) => e.id === summary.employeeId);
        if (!emp) continue;

        if (summary.daysToPay <= 0) {
          results.skipped++;
          results.details.push({
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            status: 'SKIPPED',
            reason: 'Aucun jour travaillé',
          });
          onProgress?.(results.details[results.details.length - 1]);
          continue;
        }

        const loans = loansByEmployee[emp.id] || [];
        const advances = advancesByEmployee[emp.id] || [];
        const companyDeductions = companyDeductionsByEmployee[emp.id] || [];
        const workDays = customWorkDays || settings.workDaysPerMonth;

        // 🆕 resolveForPayroll gère prorata + ancienneté auto + fiscalType
        const calculatedBonuses = await this.bonusesService.resolveForPayroll(
          emp.id,
          companyId,
          Number(emp.baseSalary),
          monthNum,
          year,
          summary.daysToPay, // jours réels travaillés
          workDays, // jours théoriques
          hireDateMap[emp.id], // hireDate pour ancienneté auto
          seniorityMode,
        );

        const ot10 = Number((summary as any).overtime10Hours || 0);
        const ot25 = Number((summary as any).overtime25Hours || 0);
        const ot50 = Number(summary.overtime50Hours || 0);
        const ot100 = Number((summary as any).overtime100Hours || 0);

        // ✅ CORRECTIF ("le trou") : brut de travail (sans indemnité congé)
        // de CE mois, calculé maintenant qu'on a calculatedBonuses — sert à
        // compléter la moyenne 12 mois si ce mois est justement celui où
        // l'indemnité doit être payée (bulletin pas encore en base).
        const prelimCalcForLeave = this.calculator.calculate(
          Number(emp.baseSalary),
          ot10,
          ot25,
          ot50,
          ot100,
          calculatedBonuses,
          [],
          settings,
          summary.daysToPay,
          workDays,
          emp,
          company,
          companyTaxes,
        );

        const leaveImpact = await this.leavesService
          .getLeaveImpactForPayroll(
            emp.id,
            monthNum,
            year,
            prelimCalcForLeave.grossSalary,
          )
          .catch(() => null);
        const leaveDays = leaveImpact?.leaveDays ?? 0;

        // 🆕 Données congé pour le calcul et le bulletin
        const leaveIndemnity = leaveImpact?.leaveIndemnity ?? 0;
        const leaveIndemnityBase = leaveImpact?.leaveIndemnityBase ?? leaveIndemnity;
        const leaveIndemnitySeniority = leaveImpact?.leaveIndemnitySeniority ?? 0;
        const absenceDeduction = leaveImpact?.absenceDeduction ?? 0;
        const isPaidLeave = leaveImpact?.isPaid ?? false;
        const leaveLabel = isPaidLeave
          ? 'Indemnité de congé'
          : 'Congé sans solde';
        // ✅ Le libellé du bulletin doit citer le nombre de jours INDEMNISÉS
        // (droit total du cycle, ex: 26j), pas le nombre de jours
        // d'absence physique de CE mois (qui peut être différent, voire 0,
        // quand l'indemnité est payée en avance le mois précédent le
        // départ réel). Propagé via data.indemnifiedDays ci-dessous — voir
        // payroll-items.service.ts pour la construction du libellé.

        if (leaveImpact) {
          this.logger.log(
            `🏖️ Congé détecté pour ${emp.firstName} ${emp.lastName}: ${leaveDays}j | Payé: ${isPaidLeave} | Indemnité: ${leaveIndemnity.toLocaleString('fr-FR')} F | Déduction: ${absenceDeduction.toLocaleString('fr-FR')} F`,
          );
        }

        const hasVoluntaryDeductions = loans.length > 0 || advances.length > 0;
        const protectionMode = this.smicProtection.determineMode(
          Number(emp.baseSalary),
          hasVoluntaryDeductions,
        );

        // ✅ FIX ERR 2&3 : leaveOptions encapsulé dans un objet optionnel
        const leaveOptions: LeaveCalculationOptions = {
          leaveIndemnity,
          isPaidLeave,
        };

        // ℹ️ ot10/ot25/ot50/ot100 déjà déclarés plus haut (avant prelimCalcForLeave)
        const prelimCalc = this.calculator.calculate(
          Number(emp.baseSalary),
          ot10,
          ot25,
          ot50,
          ot100,
          calculatedBonuses,
          [],
          settings,
          summary.daysToPay,
          workDays,
          emp,
          company,
          companyTaxes,
          leaveOptions, // 🆕 1 seul argument de plus au lieu de 2
        );

        const {
          adjustedDeductions,
          loansToUpdate,
          advancesToDeduct,
          canProceed,
          warnings: deductionWarnings,
        } = this.smicProtection.handleDeductions(
          emp,
          prelimCalc,
          loans,
          advances,
          protectionMode,
        );

        // ✅ Ne bloque plus la génération même si le net tombe sous le SMIC
        // (mode STRICT) — le RH/Admin reste seul responsable de la décision
        // finale sur les déductions. On informe seulement via un avertissement.
        if (!canProceed) {
          results.warnings++;
          this.logger.warn(
            `⚠️ Net sous le SMIC pour ${emp.firstName} ${emp.lastName} (mode STRICT) — bulletin généré quand même.`,
          );
        }

        if (deductionWarnings.length > 0) {
          results.warnings++;
          deductionWarnings.forEach((w) => this.logger.warn(w));
        }

        // ✅ Retenues diverses — ne passe pas par smicProtection (prêts/avances
        // uniquement) : montant mensuel fixé par le RH via monthlyDeduction.
        const { calcEntries: companyDeductionEntries, toApply: companyDeductionsToApply } =
          this.deductionsService.prepareCompanyDeductionsForCalc(companyDeductions);
        const deductionsForCalc = [...adjustedDeductions, ...companyDeductionEntries];

        const calc = this.calculator.calculate(
          Number(emp.baseSalary),
          ot10,
          ot25,
          ot50,
          ot100,
          calculatedBonuses,
          deductionsForCalc,
          settings,
          summary.daysToPay,
          workDays,
          emp,
          company,
          companyTaxes,
          leaveOptions, // 🆕 1 seul argument de plus au lieu de 2
        );

        payrollsToCreate.push({
          emp,
          calc,
          summary,
          loans,
          advances,
          loansToUpdate,
          advancesToDeduct,
          companyDeductions,
          companyDeductionsToApply,
          deductionWarnings,
          calculatedBonuses,
          monthNum,
          year,
          companyId,
          userId,
          customWorkDays,
          settings,
          leaveIndemnity,
          leaveIndemnityBase,
          leaveIndemnitySeniority,
          leaveId: leaveImpact?.leaveId,
          absenceDeduction,
          isPaidLeave,
          leaveDays,
          leaveLabel,
          indemnifiedDays: leaveImpact?.indemnifiedDays,
          indemnifiedSeniorityDays: leaveImpact?.indemnifiedSeniorityDays,
          // ✅ Snapshot solde congés figé au moment de la génération
          leaveBalanceSnap: leaveBalancesByEmployee[emp.id] ?? null,
          shouldClearOpeningCumulative:
            leaveImpact?.shouldClearOpeningCumulative ?? false,
        });
      } catch (error: any) {
        results.failed++;
        results.details.push({
          employeeId: summary.employeeId,
          employeeName: `${summary.employee.firstName} ${summary.employee.lastName}`,
          status: 'FAILED',
          reason: error.message || 'Erreur inconnue',
        });
        onProgress?.(results.details[results.details.length - 1]);
      }
    }

    // ✅ Persistance en parallèle (limite de concurrence 8) au lieu d'un
    // `for...await` strictement séquentiel — c'était le vrai goulot
    // d'étranglement : chaque bulletin = 1 transaction Prisma (création +
    // ~15-20 lignes + mises à jour prêts/avances), et les enchaîner un par
    // un pour 100 employés pouvait prendre 20-30s. En parallélisant par lot
    // de 8 (le pool de connexions Postgres a une limite, donc pas de
    // Promise.all illimité), le temps total chute nettement sans saturer
    // la base.
    await mapWithConcurrency(payrollsToCreate, 8, async (data) => {
      try {
        const payroll = await this.createPayrollTransaction(data);
        results.success++;
        // ✅ Le cumul d'onboarding vient d'être réellement utilisé dans ce
        // bulletin validé — on le vide maintenant, pas avant (voir
        // shouldClearOpeningCumulative dans PayrollData/getLeaveImpactForPayroll).
        if (data.shouldClearOpeningCumulative) {
          await this.leavesService.clearOpeningCumulativeAfterUse(
            data.emp.id,
          );
        }
        // 🆕 Mode ANNIVERSARY : on fige le montant réellement versé sur le
        // Leave lui-même — c'est cette valeur qui servira de substitut au
        // brut du mois de départ (sinon à 0) quand on calculera la moyenne
        // 12 mois du PROCHAIN cycle (voir leaves-indemnity.service.ts,
        // buildMonthlyGrossHistory). Uniquement si une indemnité a
        // effectivement été versée sur CE bulletin (leaveId présent et
        // montant > 0) — jamais écrasé par 0 sur un mois sans rapport.
        if (data.leaveId && data.leaveIndemnity > 0) {
          await this.prisma.leave
            .update({
              where: { id: data.leaveId },
              data: { paidIndemnityAmount: data.leaveIndemnity },
            })
            .catch((err: any) =>
              this.logger.warn(
                `⚠️ paidIndemnityAmount non enregistré pour le congé ${data.leaveId}: ${err?.message ?? err}`,
              ),
            );

          // ✅ CORRECTIF (bug cumuls confirmé) : jusqu'ici seule la paie
          // MANUELLE posait le YtdCheckpoint de reset post-congé — la paie
          // automatique (individuelle ET batch) ne le faisait jamais,
          // laissant `getYtdWindow` retomber sur le 1er janvier par défaut
          // (cumul annuel qui ne repart jamais au bon moment). On réutilise
          // ici le MÊME signal fiable que ci-dessus (leaveId + montant réel
          // versé) — contrairement au manuel qui devine depuis un texte de
          // prime, ce signal-ci est structurel, jamais de faux positif.
          await this.ytdCheckpointService
            .reconcile(this.prisma, data.emp.id, data.monthNum, data.year, true)
            .catch((err: any) =>
              this.logger.warn(
                `⚠️ YtdCheckpoint non posé pour ${data.emp.id}: ${err?.message ?? err}`,
              ),
            );
        }
        const loanDeduction = data.loansToUpdate.reduce(
          (s, l) => s + Number(l.deduction || 0),
          0,
        );
        const advanceDeduction = data.advances
          .filter((a) => data.advancesToDeduct.includes(a.id))
          .reduce((s, a) => s + Number(a.amount || 0), 0);

        results.details.push({
          employeeId: data.emp.id,
          employeeName: `${data.emp.firstName} ${data.emp.lastName}`,
          status: 'SUCCESS',
          payrollId: payroll.id,
          netSalary: data.calc.netSalary,
          grossSalary: data.calc.grossSalary,
          workedDays: data.summary.daysToPay,
          loanDeduction,
          advanceDeduction,
          leaveIndemnity: data.leaveIndemnity,
          warnings:
            data.deductionWarnings.length > 0
              ? data.deductionWarnings.join(', ')
              : null,
        });
      } catch (error: any) {
        results.failed++;
        let errorMessage = error.message || 'Erreur inconnue';
        if (error.code === 'P2002')
          errorMessage = 'Bulletin déjà existant (doublon)';
        else if (error.code === 'P2028') errorMessage = 'Transaction timeout';
        results.details.push({
          employeeId: data.emp.id,
          employeeName: `${data.emp.firstName} ${data.emp.lastName}`,
          status: 'FAILED',
          reason: errorMessage,
        });
      }
      onProgress?.(results.details[results.details.length - 1]);
    });

    this.logger.log(
      `✅ Génération : ${results.success} créés, ${results.skipped} ignorés, ${results.failed} échecs`,
    );

    return {
      success: true,
      message: `Génération terminée : ${results.success} créés, ${results.skipped} ignorés, ${results.failed} échecs`,
      count: results.success,
      totalEmployees: employees.length,
      created: results.success,
      skipped: results.skipped,
      failed: results.failed,
      warnings: results.warnings,
      details: results.details,
    };
  }

  private async createPayrollTransaction(data: PayrollData) {
    return this.prisma.$transaction(
      async (tx) => {
        const newPayroll = await tx.payroll.create({
          data: {
            employeeId: data.emp.id,
            companyId: data.companyId,
            month: data.monthNum,
            year: data.year,
            periodStart: new Date(data.year, data.monthNum - 1, 1),
            periodEnd: new Date(data.year, data.monthNum, 0),
            workDays: data.customWorkDays || data.settings.workDaysPerMonth,
            workedDays: data.summary.daysToPay,
            absenceDays: data.summary.daysToDeduct,
            daysOnLeave: data.summary.daysOnLeave,
            daysRemote: data.summary.daysRemote,
            daysHoliday: data.summary.daysHoliday,
            // ✅ FIX ERR 4 : suppression du doublon overtimeHours10 (gardé une seule fois)
            overtimeHours10: Number(data.summary.overtime10Hours || 0),
            overtimeHours25: Number(data.summary.overtime25Hours || 0),
            overtimeHours50: Number(data.summary.overtime50Hours || 0),
            overtimeHours100: Number(data.summary.overtime100Hours || 0),
            baseSalary: Number(data.emp.baseSalary),
            adjustedBaseSalary: data.calc.adjustedBaseSalary,
            absenceDeduction: data.calc.absenceDeduction,
            totalBonuses: data.calc.totalBonuses,
            overtimeAmount10: data.calc.overtimeAmount10,
            overtimeAmount25: data.calc.overtimeAmount25,
            overtimeAmount50: data.calc.overtimeAmount50,
            overtimeAmount100: data.calc.overtimeAmount100,
            totalOvertimeAmount: data.calc.totalOvertimeAmount,
            normalHours: Number(data.summary.normalHours || 0),
            grossSalary: data.calc.grossSalary,
            netSalary: data.calc.netSalary,
            totalDeductions: data.calc.totalDeductions,
            totalEmployerCost: data.calc.totalEmployerCost,
            cnssSalarial: data.calc.cnssSalarial,
            cnssEmployer: data.calc.cnssEmployer,
            cnssEmployerPension: data.calc.cnssEmployerPension,
            cnssEmployerFamily: data.calc.cnssEmployerFamily,
            cnssEmployerAccident: data.calc.cnssEmployerAccident,
            its: data.calc.its,
            tusDgiAmount: data.calc.tusDgiAmount,
            tusCnssAmount: data.calc.tusCnssAmount,
            tusTotal: data.calc.tusTotal,
            employeeCustomTaxTotal: data.calc.employeeCustomTaxTotal,
            employerCustomTaxTotal: data.calc.employerCustomTaxTotal,
            irppAbattement: data.calc.irppDetails?.abattement ?? 0,
            irppFiscalParts: data.calc.irppDetails?.fiscalParts ?? 1,
            irppEffectiveRate: data.calc.irppDetails?.effectiveRate ?? 0,
            createdById: data.userId,
            status: 'DRAFT',
          },
        });

        // Créer les lignes du bulletin (PayrollItems)
        await this.itemsService.create(
          tx,
          newPayroll.id,
          data.emp,
          data.calc,
          data.summary,
          data.loans,
          data.advances,
          data.settings,
          data.calculatedBonuses,
          // 🆕 Passer les données congé
          {
            leaveIndemnity: data.leaveIndemnity,
            leaveIndemnityBase: data.leaveIndemnityBase,
            leaveIndemnitySeniority: data.leaveIndemnitySeniority,
            absenceDeduction: data.absenceDeduction,
            isPaidLeave: data.isPaidLeave,
            leaveDays: data.leaveDays,
            leaveLabel: data.leaveLabel,
            indemnifiedDays: data.indemnifiedDays,
            indemnifiedSeniorityDays: data.indemnifiedSeniorityDays,
          },
          // ✅ Snapshot solde congés — figé sur ce bulletin
          data.leaveBalanceSnap
            ? {
                droits: Number(data.leaveBalanceSnap.annualEntitled),
                pris: Number(data.leaveBalanceSnap.annualTaken),
                solde: Number(data.leaveBalanceSnap.annualRemaining),
              }
            : undefined,
          data.companyDeductionsToApply,
        );

        // Mettre à jour les prêts déduits — passe par le service pour journaliser
        // dans LoanRepaymentLog (méthode PAYROLL) et gérer le statut PAID.
        for (const loanUpdate of data.loansToUpdate) {
          const loan = data.loans.find((l) => l.id === loanUpdate.id);
          if (loan) {
            await this.deductionsService.updateLoan(
              tx,
              loanUpdate.id,
              loanUpdate.deduction,
              Number(loan.remainingBalance),
              data.monthNum,
              data.year,
              loanUpdate.deduction < Number(loan.monthlyRepayment),
            );
          }
        }

        // Marquer les avances comme déduites — passe par le service pour
        // journaliser dans AdvanceRepaymentLog (méthode PAYROLL), comme pour
        // les prêts. L'ancien code faisait un updateMany() direct ici, sans
        // journal et sans même remettre remainingBalance à 0.
        await this.deductionsService.markAdvancesAsDeducted(
          tx,
          data.advancesToDeduct,
          data.monthNum,
          data.year,
        );

        // Retenues diverses (pharmacie, cantine, casse matériel...) — même
        // principe que prêts/avances : décrémente remainingBalance et
        // journalise dans CompanyDeductionRepaymentLog (méthode PAYROLL).
        for (const entry of data.companyDeductionsToApply) {
          const deduction = data.companyDeductions.find((d: any) => d.id === entry.id);
          if (deduction) {
            await this.deductionsService.applyCompanyDeduction(
              tx,
              entry.id,
              Number(deduction.remainingBalance),
              deduction.monthlyDeduction != null ? Number(deduction.monthlyDeduction) : null,
              data.monthNum,
              data.year,
            );
          }
        }

        return newPayroll;
      },
      { timeout: 30000 },
    );
  }
}