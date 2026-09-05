// // ============================================================================
// // src/payrolls/services/manual-payroll.service.ts
// //
// // Service dédié à la saisie manuelle de paie.
// // ✅ Reset YTD post-congé pour tous les clients (paie manuelle uniquement).
// // ============================================================================

// import { Injectable, BadRequestException, Logger } from '@nestjs/common';
// import { Prisma } from '@prisma/client';
// import { PrismaService } from '../../prisma/prisma.service';
// import { PayrollCalculatorService } from './payroll-calculator.service';
// import { PayrollItemsService } from './payroll-items.service';
// import { PayrollDeductionsService } from './payroll-deductions.service';
// import { PayrollSmicProtectionService } from './payroll-smic-protection.service';
// import { PayrollSettingsService } from '../../payroll/settings/settings.service';
// import { CompanyTaxService } from '../../company-taxes/company-tax.service';
// import { LeavesService } from '../../leaves/leaves.service';
// import { YtdCheckpointService } from './ytd-checkpoint.service';
// import {
//   CompanyNotFoundException,
//   EmployeeNotFoundException,
//   PayrollAlreadyExistsException,
// } from '../../exceptions/business.exceptions';

// export interface ManualBonus {
//   bonusType: string;
//   amount: number;
//   base?: number;
//   rate?: number;
//   isTaxable?: boolean;
//   isCnss?: boolean;
//   fiscalType?: 'TAXABLE_CNSS' | 'TAXABLE_NO_CNSS' | 'NON_TAXABLE';
// }

// export interface ManualDeduction {
//   label: string;
//   amount: number;
// }

// export interface CreateManualPayrollDto {
//   employeeId: string;
//   companyId?: string;
//   month: number;
//   year: number;
//   workedDays: number;
//   baseSalary?: number;
//   overtimeHours10?: number;
//   overtimeHours25?: number;
//   overtimeHours50?: number;
//   overtimeHours100?: number;
//   manualBonuses?: ManualBonus[];
//   manualDeductions?: ManualDeduction[];
//   congesDroits?: number;
//   congesPris?: number;
//   congesSolde?: number;
//   joursCongesPris?: number;
// }

// @Injectable()
// export class ManualPayrollService {
//   private readonly logger = new Logger(ManualPayrollService.name);

//   // ✅ Cycle d'acquisition congé (12 mois glissants) — miroir de
//   // LeavesService.resolveCycleWindow(), dupliqué ici (plutôt qu'appelé) pour
//   // rester dans la même transaction Prisma que le reste de cette méthode.
//   private resolveLeaveCycleStart(
//     hireDate: Date,
//     leaveCycleStartDate: Date | null,
//   ): Date {
//     return new Date(leaveCycleStartDate ?? hireDate);
//   }

//   constructor(
//     private prisma: PrismaService,
//     private calculator: PayrollCalculatorService,
//     private itemsService: PayrollItemsService,
//     private deductionsService: PayrollDeductionsService,
//     private smicProtection: PayrollSmicProtectionService,
//     private payrollSettings: PayrollSettingsService,
//     private companyTaxService: CompanyTaxService,
//     private leavesService: LeavesService,
//     private ytdCheckpointService: YtdCheckpointService,
//   ) {}

//   private async resolveCompanyId(
//     userId: string,
//     overrideCompanyId?: string,
//   ): Promise<string> {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true, role: true },
//     });
//     const isCabinet =
//       user?.role === 'CABINET_ADMIN' || user?.role === 'CABINET_GESTIONNAIRE';
//     const companyId = isCabinet ? overrideCompanyId : user?.companyId;
//     if (!companyId) throw new CompanyNotFoundException();
//     return companyId;
//   }

//   private async loadEntities(employeeId: string, companyId: string) {
//     const [employee, company] = await Promise.all([
//       this.prisma.employee.findUnique({
//         where: { id: employeeId },
//         select: {
//           id: true,
//           firstName: true,
//           lastName: true,
//           baseSalary: true,
//           maritalStatus: true,
//           numberOfChildren: true,
//           isSubjectToIrpp: true,
//           isSubjectToCnss: true,
//           isSubjectToTus: true,
//           taxExemptionReason: true,
//           tolZone: true,
//           contractType: true,
//           isResident: true,
//           hireDate: true,
//         },
//       }),
//       this.prisma.company.findUnique({
//         where: { id: companyId },
//         select: {
//           appliesCnssEmployer: true,
//           cnssEmployerRate: true,
//           isSubjectToTus: true,
//           seniorityMode: true,
//         },
//       }),
//     ]);

//     if (!employee) throw new EmployeeNotFoundException(employeeId);
//     if (!company) throw new CompanyNotFoundException();

//     if ((employee as any).contractType === 'INTERIM') {
//       throw new BadRequestException(
//         'Les intérimaires sont gérés par leur agence. Aucun bulletin ne peut être généré côté entreprise.',
//       );
//     }

//     return { employee, company };
//   }

//   private buildCalculatedBonuses(manualBonuses: ManualBonus[] = []): any[] {
//     return manualBonuses
//       .filter((b) => b.amount > 0)
//       .map((b, i) => {
//         let isTaxable = b.isTaxable ?? true;
//         let isCnss = b.isCnss ?? true;
//         if (b.fiscalType) {
//           isTaxable = b.fiscalType !== 'NON_TAXABLE';
//           isCnss = b.fiscalType === 'TAXABLE_CNSS';
//         }
//         return {
//           id: `manual-${i}-${Date.now()}`,
//           bonusType: b.bonusType || 'Prime',
//           amount: Number(b.amount),
//           base:
//             b.base != null && Number(b.base) > 0 ? Number(b.base) : undefined,
//           rate:
//             b.rate != null && Number(b.rate) > 0 ? Number(b.rate) : undefined,
//           isTaxable,
//           isCnss,
//           source: 'MANUAL',
//           isRecurring: true,
//         };
//       });
//   }

//   // ══════════════════════════════════════════════════════════════════════════
//   // SIMULATE
//   // ══════════════════════════════════════════════════════════════════════════

//   async simulate(dto: CreateManualPayrollDto, userId: string) {
//     const companyId = await this.resolveCompanyId(userId, dto.companyId);
//     const { employee, company } = await this.loadEntities(
//       dto.employeeId,
//       companyId,
//     );

//     const [settings, companyTaxes, loans, advances, companyDeductions] = await Promise.all([
//       this.payrollSettings.getSettingsByCompanyId(companyId),
//       this.companyTaxService.findActive(companyId),
//       this.deductionsService.getActiveLoans(
//         dto.employeeId,
//         dto.month,
//         dto.year,
//       ),
//       this.deductionsService.getApprovedAdvances(
//         dto.employeeId,
//         dto.month,
//         dto.year,
//       ),
//       this.deductionsService.getPendingCompanyDeductionsForEmployee(dto.employeeId),
//     ]);

//     const effectiveBaseSalary =
//       dto.baseSalary != null && dto.baseSalary > 0
//         ? dto.baseSalary
//         : Number(employee.baseSalary);

//     const daysToPay = Math.min(
//       dto.workedDays ?? settings.workDaysPerMonth,
//       settings.workDaysPerMonth,
//     );
//     const eff10 = Number(dto.overtimeHours10 ?? 0);
//     const eff25 = Number(dto.overtimeHours25 ?? 0);
//     const eff50 = Number(dto.overtimeHours50 ?? 0);
//     const eff100 = Number(dto.overtimeHours100 ?? 0);

//     const calculatedBonuses = this.buildCalculatedBonuses(dto.manualBonuses);
//     const manualDeductionTotal = (dto.manualDeductions ?? []).reduce(
//       (s, d) => s + (Number(d.amount) || 0),
//       0,
//     );

//     const protectionMode = this.smicProtection.determineMode(
//       effectiveBaseSalary,
//       loans.length > 0 || advances.length > 0 || manualDeductionTotal > 0,
//     );
//     const prelimCalc = this.calculator.calculate(
//       effectiveBaseSalary,
//       eff10,
//       eff25,
//       eff50,
//       eff100,
//       calculatedBonuses,
//       [],
//       settings,
//       daysToPay,
//       settings.workDaysPerMonth,
//       employee,
//       company,
//       companyTaxes,
//     );
//     const { adjustedDeductions } = this.smicProtection.handleDeductions(
//       employee,
//       prelimCalc,
//       loans,
//       advances,
//       protectionMode,
//     );
//     const { calcEntries: companyDeductionEntries } =
//       this.deductionsService.prepareCompanyDeductionsForCalc(companyDeductions);
//     const deductionsForCalc = [...adjustedDeductions, ...companyDeductionEntries];
//     const calc = this.calculator.calculate(
//       effectiveBaseSalary,
//       eff10,
//       eff25,
//       eff50,
//       eff100,
//       calculatedBonuses,
//       deductionsForCalc,
//       settings,
//       daysToPay,
//       settings.workDaysPerMonth,
//       employee,
//       company,
//       companyTaxes,
//     );

//     const totalLoanDeduction = loans.reduce(
//       (s, l) => s + Number(l.monthlyRepayment),
//       0,
//     );
//     const totalAdvanceDeduction = advances.reduce(
//       (s, a) => s + Number(a.amount),
//       0,
//     );

//     return {
//       employee: {
//         id: employee.id,
//         firstName: employee.firstName,
//         lastName: employee.lastName,
//         baseSalary: Number(employee.baseSalary),
//         effectiveBaseSalary,
//         isSubjectToCnss: employee.isSubjectToCnss,
//         isSubjectToIrpp: employee.isSubjectToIrpp,
//         isSubjectToTus: employee.isSubjectToTus,
//         taxExemptionReason: employee.taxExemptionReason,
//       },
//       month: dto.month,
//       year: dto.year,
//       daysToPay,
//       workDays: settings.workDaysPerMonth,
//       overtime: {
//         hours10: eff10,
//         amount10: calc.overtimeAmount10,
//         hours25: eff25,
//         amount25: calc.overtimeAmount25,
//         hours50: eff50,
//         amount50: calc.overtimeAmount50,
//         hours100: eff100,
//         amount100: calc.overtimeAmount100,
//         total: calc.totalOvertimeAmount,
//       },
//       bonuses: calculatedBonuses,
//       totalBonuses: calc.totalBonuses,
//       adjustedBaseSalary: calc.adjustedBaseSalary,
//       absenceDeduction: calc.absenceDeduction,
//       grossSalary: calc.grossSalary,
//       cnssSalarial: calc.cnssSalarial,
//       cnssEmployer: calc.cnssEmployer,
//       cnssEmployerPension: calc.cnssEmployerPension,
//       cnssEmployerFamily: calc.cnssEmployerFamily,
//       cnssEmployerAccident: calc.cnssEmployerAccident,
//       tusDgiAmount: calc.tusDgiAmount,
//       tusCnssAmount: calc.tusCnssAmount,
//       tusTotal: calc.tusTotal,
//       its: calc.its,
//       irppDetails: calc.irppDetails,
//       customTaxes: calc.customTaxDetails,
//       employeeCustomTaxTotal: calc.employeeCustomTaxTotal,
//       employerCustomTaxTotal: calc.employerCustomTaxTotal,
//       loans: loans.map((l) => ({
//         id: l.id,
//         monthlyRepayment: Number(l.monthlyRepayment),
//         remainingBalance: Number(l.remainingBalance),
//       })),
//       advances: advances.map((a) => ({
//         id: a.id,
//         amount: Number(a.amount),
//         createdAt: a.createdAt,
//       })),
//       totalLoanDeduction,
//       totalAdvanceDeduction,
//       manualDeductionTotal,
//       totalDeductions: calc.totalDeductions + manualDeductionTotal,
//       netSalary: calc.netSalary - manualDeductionTotal,
//       totalEmployerCost: calc.totalEmployerCost,
//       settings: {
//         cnssSalarialRate: settings.cnssSalarialRate,
//         cnssEmployerRate: settings.cnssEmployerRate,
//         cnssCeiling: settings.cnssCeiling,
//         overtimeRate10: settings.overtimeRate10 ?? 10,
//         overtimeRate25: settings.overtimeRate25 ?? 25,
//         overtimeRate50: settings.overtimeRate50 ?? 50,
//         overtimeRate100: settings.overtimeRate100 ?? 100,
//       },
//       simulationMode: 'MANUAL',
//     };
//   }

//   // ══════════════════════════════════════════════════════════════════════════
//   // SAVE
//   // ══════════════════════════════════════════════════════════════════════════

//   async save(dto: CreateManualPayrollDto, userId: string) {
//     const companyId = await this.resolveCompanyId(userId, dto.companyId);
//     const { employee, company } = await this.loadEntities(
//       dto.employeeId,
//       companyId,
//     );

//     const existing = await this.prisma.payroll.findFirst({
//       where: {
//         employeeId: dto.employeeId,
//         month: dto.month,
//         year: dto.year,
//         companyId,
//       },
//     });
//     if (existing) {
//       throw new PayrollAlreadyExistsException(
//         `${employee.firstName} ${employee.lastName}`,
//         dto.month,
//         dto.year,
//       );
//     }

//     const [settings, companyTaxes, loans, advances, companyDeductions] = await Promise.all([
//       this.payrollSettings.getSettingsByCompanyId(companyId),
//       this.companyTaxService.findActive(companyId),
//       this.deductionsService.getActiveLoans(
//         dto.employeeId,
//         dto.month,
//         dto.year,
//       ),
//       this.deductionsService.getApprovedAdvances(
//         dto.employeeId,
//         dto.month,
//         dto.year,
//       ),
//       this.deductionsService.getPendingCompanyDeductionsForEmployee(dto.employeeId),
//     ]);

//     const effectiveBaseSalary =
//       dto.baseSalary != null && dto.baseSalary > 0
//         ? dto.baseSalary
//         : Number(employee.baseSalary);

//     const daysToPay = Math.min(
//       dto.workedDays ?? settings.workDaysPerMonth,
//       settings.workDaysPerMonth,
//     );
//     const eff10 = Number(dto.overtimeHours10 ?? 0);
//     const eff25 = Number(dto.overtimeHours25 ?? 0);
//     const eff50 = Number(dto.overtimeHours50 ?? 0);
//     const eff100 = Number(dto.overtimeHours100 ?? 0);
//     const absenceDays = Math.max(0, settings.workDaysPerMonth - daysToPay);

//     const calculatedBonuses = this.buildCalculatedBonuses(dto.manualBonuses);
//     const manualDeductionTotal = (dto.manualDeductions ?? []).reduce(
//       (s, d) => s + (Number(d.amount) || 0),
//       0,
//     );

//     const protectionMode = this.smicProtection.determineMode(
//       effectiveBaseSalary,
//       loans.length > 0 || advances.length > 0 || manualDeductionTotal > 0,
//     );
//     const prelimCalc = this.calculator.calculate(
//       effectiveBaseSalary,
//       eff10,
//       eff25,
//       eff50,
//       eff100,
//       calculatedBonuses,
//       [],
//       settings,
//       daysToPay,
//       settings.workDaysPerMonth,
//       employee,
//       company,
//       companyTaxes,
//     );
//     const { adjustedDeductions, loansToUpdate, advancesToDeduct, warnings } =
//       this.smicProtection.handleDeductions(
//         employee,
//         prelimCalc,
//         loans,
//         advances,
//         protectionMode,
//       );

//     const { calcEntries: companyDeductionEntries, toApply: companyDeductionsToApply } =
//       this.deductionsService.prepareCompanyDeductionsForCalc(companyDeductions);
//     const deductionsForCalc = [...adjustedDeductions, ...companyDeductionEntries];

//     const calc = this.calculator.calculate(
//       effectiveBaseSalary,
//       eff10,
//       eff25,
//       eff50,
//       eff100,
//       calculatedBonuses,
//       deductionsForCalc,
//       settings,
//       daysToPay,
//       settings.workDaysPerMonth,
//       employee,
//       company,
//       companyTaxes,
//     );

//     warnings.forEach((w) => this.logger.warn(w));

//     const fakeSummary = {
//       daysToPay,
//       overtime10Hours: eff10,
//       overtime25Hours: eff25,
//       overtime50Hours: eff50,
//       overtime100Hours: eff100,
//       daysOnLeave: 0,
//       daysRemote: 0,
//       daysHoliday: 0,
//     };

//     return this.prisma.$transaction(
//       async (tx) => {
//         const payroll = await tx.payroll.create({
//           data: {
//             employeeId: dto.employeeId,
//             companyId,
//             month: dto.month,
//             year: dto.year,
//             periodStart: new Date(dto.year, dto.month - 1, 1),
//             periodEnd: new Date(dto.year, dto.month, 0),
//             workDays: settings.workDaysPerMonth,
//             workedDays: daysToPay,
//             absenceDays,
//             daysOnLeave: 0,
//             daysRemote: 0,
//             daysHoliday: 0,
//             overtimeHours10: eff10,
//             overtimeHours25: eff25,
//             overtimeHours50: eff50,
//             overtimeHours100: eff100,
//             baseSalary: effectiveBaseSalary,
//             adjustedBaseSalary: calc.adjustedBaseSalary,
//             absenceDeduction: calc.absenceDeduction,
//             overtimeAmount10: calc.overtimeAmount10,
//             overtimeAmount25: calc.overtimeAmount25,
//             overtimeAmount50: calc.overtimeAmount50,
//             overtimeAmount100: calc.overtimeAmount100,
//             totalOvertimeAmount: calc.totalOvertimeAmount,
//             totalBonuses: calc.totalBonuses,
//             grossSalary: calc.grossSalary,
//             netSalary: calc.netSalary,
//             cnssSalarial: calc.cnssSalarial,
//             cnssEmployer: calc.cnssEmployer,
//             its: calc.its,
//             totalDeductions: calc.totalDeductions,
//             totalEmployerCost: calc.totalEmployerCost,
//             irppAbattement: calc.irppDetails?.abattement ?? 0,
//             irppFiscalParts: calc.irppDetails?.fiscalParts ?? 1,
//             irppEffectiveRate: calc.irppDetails?.effectiveRate ?? 0,
//             cnssEmployerPension: calc.cnssEmployerPension,
//             cnssEmployerFamily: calc.cnssEmployerFamily,
//             cnssEmployerAccident: calc.cnssEmployerAccident,
//             tusDgiAmount: calc.tusDgiAmount,
//             tusCnssAmount: calc.tusCnssAmount,
//             tusTotal: calc.tusTotal,
//             employeeCustomTaxTotal: calc.employeeCustomTaxTotal,
//             employerCustomTaxTotal: calc.employerCustomTaxTotal,
//             status: 'DRAFT',
//             createdById: userId,
//           } as any,
//         });

//         const employeeForItems = {
//           ...employee,
//           baseSalary: effectiveBaseSalary,
//         };

//         // ✅ CORRECTIF (bug trouvé) : solde TOTAL réel (tous cycles non
//         // soldés), pas seulement le dernier — même correctif que Provision.
//         // Avant : `tx.leaveBalance.findFirst(...)` sans passer par
//         // getOrCreateLeaveBalance — si aucune ligne n'existait encore pour
//         // l'employé (1er bulletin jamais généré), lbSnap valait null et
//         // droits/pris/solde retombaient tous à 0.
//         const lbSnap = await this.leavesService
//           .getTotalLeaveBalanceSummary(employee.id)
//           .catch(() => null);
//         const leaveSnapshot = {
//           droits: dto.congesDroits ?? Number(lbSnap?.annualEntitled ?? 0),
//           pris: dto.congesPris ?? Number(lbSnap?.annualTaken ?? 0),
//           solde: dto.congesSolde ?? Number(lbSnap?.annualRemaining ?? 0),
//         };

//         await this.itemsService.create(
//           tx,
//           payroll.id,
//           employeeForItems,
//           calc,
//           fakeSummary,
//           loans,
//           advances,
//           settings,
//           calculatedBonuses,
//           undefined,
//           leaveSnapshot,
//           companyDeductionsToApply,
//         );

//         for (const loanUpdate of loansToUpdate) {
//           const loan = loans.find((l) => l.id === loanUpdate.id);
//           if (loan) {
//             const isPartial =
//               loanUpdate.deduction < Number(loan.monthlyRepayment);
//             await this.deductionsService.updateLoan(
//               tx,
//               loanUpdate.id,
//               loanUpdate.deduction,
//               Number(loan.remainingBalance),
//               dto.month,
//               dto.year,
//               isPartial,
//             );
//           }
//         }

//         await this.deductionsService.markAdvancesAsDeducted(
//           tx,
//           advancesToDeduct,
//           dto.month,
//           dto.year,
//         );

//         // Retenues diverses (pharmacie, cantine, casse matériel...) — même
//         // principe que prêts/avances : décrémente remainingBalance et
//         // journalise dans CompanyDeductionRepaymentLog (méthode PAYROLL).
//         for (const entry of companyDeductionsToApply) {
//           const deduction = companyDeductions.find((d: any) => d.id === entry.id);
//           if (deduction) {
//             await this.deductionsService.applyCompanyDeduction(
//               tx,
//               entry.id,
//               Number(deduction.remainingBalance),
//               deduction.monthlyDeduction != null ? Number(deduction.monthlyDeduction) : null,
//               dto.month,
//               dto.year,
//             );
//           }
//         }

//         // ── Détecter congés payés ─────────────────────────────────────────────
//         const hasCongesPaies = calculatedBonuses.some((b: any) =>
//           /cong[eé]/i.test(b.bonusType ?? ''),
//         );

//         // ✅ Réconcilie TOUJOURS le YtdCheckpoint — pose-le si congé payé
//         // présent, le retire s'il existait mais que le bulletin n'a plus de
//         // congé (évite les checkpoints orphelins après une édition qui
//         // retire la prime congé).
//         await this.ytdCheckpointService.reconcile(
//           tx,
//           employee.id,
//           dto.month,
//           dto.year,
//           hasCongesPaies,
//         );

//         if (hasCongesPaies) {
//           // Déduire les jours du LeaveBalance
//           const joursPris = dto.joursCongesPris ?? dto.congesPris ?? 0;
//           if (joursPris > 0) {
//             const balance = await tx.leaveBalance.findFirst({
//               where: { employeeId: employee.id },
//               orderBy: { cycleStartDate: 'desc' },
//             });
//             if (balance) {
//               const newTaken = Number(balance.annualTaken) + joursPris;
//               const newRemaining = Number(balance.annualRemaining) - joursPris;
//               await tx.leaveBalance.update({
//                 where: { id: balance.id },
//                 data: {
//                   annualTaken: newTaken,
//                   annualRemaining: Math.max(0, newRemaining),
//                   lastCalculated: new Date(),
//                 },
//               });
//               this.logger.log(
//                 `✅ LeaveBalance — pris +${joursPris}j, remaining: ${Math.max(0, newRemaining)}j`,
//               );
//             }
//           }
//         } else {
//           // Mois normal — accumulation mensuelle 2,16j (idempotent par
//           // mois/année du bulletin — voir accrueMonthlyLeaveForEmployee)
//           try {
//             await this.leavesService.accrueMonthlyLeaveForEmployee(
//               employee.id,
//               dto.month,
//               dto.year,
//             );
//             this.logger.log(
//               `✅ Accumulation congés +2,16j — ${employee.firstName} ${employee.lastName}`,
//             );
//           } catch (e: any) {
//             this.logger.warn(
//               `⚠️ Accumulation congés échouée : ${e?.message ?? String(e)}`,
//             );
//           }
//         }

//         // ── Override manuel LeaveBalance si saisi ─────────────────────────────
//         if (dto.congesDroits != null || dto.congesPris != null) {
//           const droits = dto.congesDroits ?? 0;
//           const pris = dto.congesPris ?? 0;
//           const solde = dto.congesSolde ?? droits - pris;

//           // ✅ Résoudre le cycle en cours de l'employé (dans la même transaction)
//           // plutôt que l'année calendaire du bulletin — c'est le cycle qui fait foi.
//           const empForCycle = await tx.employee.findUnique({
//             where: { id: employee.id },
//             select: { hireDate: true, leaveCycleStartDate: true },
//           });
//           const cycleStartDate = this.resolveLeaveCycleStart(
//             new Date(empForCycle!.hireDate),
//             empForCycle!.leaveCycleStartDate
//               ? new Date(empForCycle!.leaveCycleStartDate)
//               : null,
//           );
//           const cycleEndDate = new Date(cycleStartDate);
//           cycleEndDate.setMonth(cycleEndDate.getMonth() + 12);
//           const cyclesCount = await tx.leaveBalance.count({
//             where: { employeeId: employee.id },
//           });

//           await tx.leaveBalance.upsert({
//             where: {
//               employeeId_cycleStartDate: {
//                 employeeId: employee.id,
//                 cycleStartDate,
//               },
//             },
//             create: {
//               employeeId: employee.id,
//               year: cycleStartDate.getFullYear(),
//               cycleNumber: cyclesCount + 1,
//               cycleStartDate,
//               cycleEndDate,
//               annualEntitled: droits,
//               annualTaken: pris,
//               annualRemaining: solde,
//             },
//             update: {
//               annualEntitled: droits,
//               annualTaken: pris,
//               annualRemaining: solde,
//               lastCalculated: new Date(),
//             },
//           });
//           this.logger.log(
//             `✅ LeaveBalance mis à jour — droits=${droits}j pris=${pris}j solde=${solde}j`,
//           );
//         }

//         // ── Retenues libres → items DEDUCTION ────────────────────────────────
//         if (dto.manualDeductions && dto.manualDeductions.length > 0) {
//           for (const ded of dto.manualDeductions.filter(
//             (d) => Number(d.amount) > 0,
//           )) {
//             await tx.payrollItem.create({
//               data: {
//                 payrollId: payroll.id,
//                 code: 'MANUAL_DEDUCTION',
//                 label: ded.label || 'Retenue',
//                 type: 'DEDUCTION',
//                 amount: Number(ded.amount),
//                 base: null,
//                 rate: null,
//                 isTaxable: false,
//                 isCnss: false,
//                 order: 900,
//               } as any,
//             });
//           }
//           await tx.payroll.update({
//             where: { id: payroll.id },
//             data: {
//               netSalary: calc.netSalary - manualDeductionTotal,
//               totalDeductions: calc.totalDeductions + manualDeductionTotal,
//             },
//           });
//         }

//         return payroll;
//       },
//       {
//         maxWait: 10_000,
//         timeout: 30_000,
//         isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
//       },
//     );
//   }
// }


// ============================================================================
// src/payrolls/services/manual-payroll.service.ts
//
// Service dédié à la saisie manuelle de paie.
// ✅ Reset YTD post-congé pour tous les clients (paie manuelle uniquement).
// ============================================================================

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollCalculatorService } from './payroll-calculator.service';
import { PayrollItemsService } from './payroll-items.service';
import { PayrollDeductionsService } from './payroll-deductions.service';
import { PayrollSmicProtectionService } from './payroll-smic-protection.service';
import { PayrollSettingsService } from '../../payroll/settings/settings.service';
import { CompanyTaxService } from '../../company-taxes/company-tax.service';
import { LeavesService } from '../../leaves/leaves.service';
import { resolveCycleWindow } from '../../leaves/leaves-common.util';
import { YtdCheckpointService } from './ytd-checkpoint.service';
import {
  CompanyNotFoundException,
  EmployeeNotFoundException,
  PayrollAlreadyExistsException,
} from '../../exceptions/business.exceptions';

export interface ManualBonus {
  bonusType: string;
  amount: number;
  base?: number;
  rate?: number;
  isTaxable?: boolean;
  isCnss?: boolean;
  fiscalType?: 'TAXABLE_CNSS' | 'TAXABLE_NO_CNSS' | 'NON_TAXABLE';
}

export interface ManualDeduction {
  label: string;
  amount: number;
}

export interface CreateManualPayrollDto {
  employeeId: string;
  companyId?: string;
  month: number;
  year: number;
  workedDays: number;
  baseSalary?: number;
  overtimeHours10?: number;
  overtimeHours25?: number;
  overtimeHours50?: number;
  overtimeHours100?: number;
  manualBonuses?: ManualBonus[];
  manualDeductions?: ManualDeduction[];
  congesDroits?: number;
  congesPris?: number;
  congesSolde?: number;
  joursCongesPris?: number;
  // 🆕 CORRECTIF (bug cumuls confirmé) : signal EXPLICITE du RH, plus
  // fiable qu'une détection par mot-clé sur le libellé d'une prime (qui se
  // déclenchait sur n'importe quelle ligne contenant juste "congé", ex.
  // "Rappel congé 2025", causant des resets de cumul erronés). Coché
  // uniquement quand ce bulletin paie vraiment l'indemnité d'un départ.
  isLeaveDeparture?: boolean;
}

@Injectable()
export class ManualPayrollService {
  private readonly logger = new Logger(ManualPayrollService.name);

  // ✅ Cycle d'acquisition congé — délègue à resolveCycleWindow (source
  // unique de vérité, voir leaves-common.util.ts) au lieu de dupliquer la
  // logique ROLLING ici. 🆕 CORRECTIF : l'ancienne version locale ignorait
  // totalement le mode ANNIVERSARY (toujours ROLLING codé en dur) — un
  // override manuel de solde pour une entreprise en mode ANNIVERSARY
  // écrivait alors le solde sur le MAUVAIS cycle (celui du retour réel au
  // lieu de celui ancré sur hireDate).
  private resolveLeaveCycleStart(
    hireDate: Date,
    leaveCycleStartDate: Date | null,
    cycleMode: 'ROLLING' | 'ANNIVERSARY' = 'ROLLING',
  ): Date {
    return resolveCycleWindow(
      hireDate,
      leaveCycleStartDate,
      undefined,
      cycleMode,
    ).cycleStartDate;
  }

  constructor(
    private prisma: PrismaService,
    private calculator: PayrollCalculatorService,
    private itemsService: PayrollItemsService,
    private deductionsService: PayrollDeductionsService,
    private smicProtection: PayrollSmicProtectionService,
    private payrollSettings: PayrollSettingsService,
    private companyTaxService: CompanyTaxService,
    private leavesService: LeavesService,
    private ytdCheckpointService: YtdCheckpointService,
  ) {}

  private async resolveCompanyId(
    userId: string,
    overrideCompanyId?: string,
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true },
    });
    const isCabinet =
      user?.role === 'CABINET_ADMIN' || user?.role === 'CABINET_GESTIONNAIRE';
    const companyId = isCabinet ? overrideCompanyId : user?.companyId;
    if (!companyId) throw new CompanyNotFoundException();
    return companyId;
  }

  private async loadEntities(employeeId: string, companyId: string) {
    const [employee, company] = await Promise.all([
      this.prisma.employee.findUnique({
        where: { id: employeeId },
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
          contractType: true,
          isResident: true,
          hireDate: true,
        },
      }),
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: {
          appliesCnssEmployer: true,
          cnssEmployerRate: true,
          isSubjectToTus: true,
          seniorityMode: true,
        },
      }),
    ]);

    if (!employee) throw new EmployeeNotFoundException(employeeId);
    if (!company) throw new CompanyNotFoundException();

    if ((employee as any).contractType === 'INTERIM') {
      throw new BadRequestException(
        'Les intérimaires sont gérés par leur agence. Aucun bulletin ne peut être généré côté entreprise.',
      );
    }

    return { employee, company };
  }

  private buildCalculatedBonuses(manualBonuses: ManualBonus[] = []): any[] {
    return manualBonuses
      .filter((b) => b.amount > 0)
      .map((b, i) => {
        let isTaxable = b.isTaxable ?? true;
        let isCnss = b.isCnss ?? true;
        if (b.fiscalType) {
          isTaxable = b.fiscalType !== 'NON_TAXABLE';
          isCnss = b.fiscalType === 'TAXABLE_CNSS';
        }
        return {
          id: `manual-${i}-${Date.now()}`,
          bonusType: b.bonusType || 'Prime',
          amount: Number(b.amount),
          base:
            b.base != null && Number(b.base) > 0 ? Number(b.base) : undefined,
          rate:
            b.rate != null && Number(b.rate) > 0 ? Number(b.rate) : undefined,
          isTaxable,
          isCnss,
          source: 'MANUAL',
          isRecurring: true,
        };
      });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SIMULATE
  // ══════════════════════════════════════════════════════════════════════════

  async simulate(dto: CreateManualPayrollDto, userId: string) {
    const companyId = await this.resolveCompanyId(userId, dto.companyId);
    const { employee, company } = await this.loadEntities(
      dto.employeeId,
      companyId,
    );

    const [settings, companyTaxes, loans, advances, companyDeductions] = await Promise.all([
      this.payrollSettings.getSettingsByCompanyId(companyId),
      this.companyTaxService.findActive(companyId),
      this.deductionsService.getActiveLoans(
        dto.employeeId,
        dto.month,
        dto.year,
      ),
      this.deductionsService.getApprovedAdvances(
        dto.employeeId,
        dto.month,
        dto.year,
      ),
      this.deductionsService.getPendingCompanyDeductionsForEmployee(dto.employeeId),
    ]);

    const effectiveBaseSalary =
      dto.baseSalary != null && dto.baseSalary > 0
        ? dto.baseSalary
        : Number(employee.baseSalary);

    const daysToPay = Math.min(
      dto.workedDays ?? settings.workDaysPerMonth,
      settings.workDaysPerMonth,
    );
    const eff10 = Number(dto.overtimeHours10 ?? 0);
    const eff25 = Number(dto.overtimeHours25 ?? 0);
    const eff50 = Number(dto.overtimeHours50 ?? 0);
    const eff100 = Number(dto.overtimeHours100 ?? 0);

    const calculatedBonuses = this.buildCalculatedBonuses(dto.manualBonuses);
    const manualDeductionTotal = (dto.manualDeductions ?? []).reduce(
      (s, d) => s + (Number(d.amount) || 0),
      0,
    );

    const protectionMode = this.smicProtection.determineMode(
      effectiveBaseSalary,
      loans.length > 0 || advances.length > 0 || manualDeductionTotal > 0,
    );
    const prelimCalc = this.calculator.calculate(
      effectiveBaseSalary,
      eff10,
      eff25,
      eff50,
      eff100,
      calculatedBonuses,
      [],
      settings,
      daysToPay,
      settings.workDaysPerMonth,
      employee,
      company,
      companyTaxes,
    );
    const { adjustedDeductions } = this.smicProtection.handleDeductions(
      employee,
      prelimCalc,
      loans,
      advances,
      protectionMode,
    );
    const { calcEntries: companyDeductionEntries } =
      this.deductionsService.prepareCompanyDeductionsForCalc(companyDeductions);
    const deductionsForCalc = [...adjustedDeductions, ...companyDeductionEntries];
    const calc = this.calculator.calculate(
      effectiveBaseSalary,
      eff10,
      eff25,
      eff50,
      eff100,
      calculatedBonuses,
      deductionsForCalc,
      settings,
      daysToPay,
      settings.workDaysPerMonth,
      employee,
      company,
      companyTaxes,
    );

    const totalLoanDeduction = loans.reduce(
      (s, l) => s + Number(l.monthlyRepayment),
      0,
    );
    const totalAdvanceDeduction = advances.reduce(
      (s, a) => s + Number(a.amount),
      0,
    );

    return {
      employee: {
        id: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        baseSalary: Number(employee.baseSalary),
        effectiveBaseSalary,
        isSubjectToCnss: employee.isSubjectToCnss,
        isSubjectToIrpp: employee.isSubjectToIrpp,
        isSubjectToTus: employee.isSubjectToTus,
        taxExemptionReason: employee.taxExemptionReason,
      },
      month: dto.month,
      year: dto.year,
      daysToPay,
      workDays: settings.workDaysPerMonth,
      overtime: {
        hours10: eff10,
        amount10: calc.overtimeAmount10,
        hours25: eff25,
        amount25: calc.overtimeAmount25,
        hours50: eff50,
        amount50: calc.overtimeAmount50,
        hours100: eff100,
        amount100: calc.overtimeAmount100,
        total: calc.totalOvertimeAmount,
      },
      bonuses: calculatedBonuses,
      totalBonuses: calc.totalBonuses,
      adjustedBaseSalary: calc.adjustedBaseSalary,
      absenceDeduction: calc.absenceDeduction,
      grossSalary: calc.grossSalary,
      cnssSalarial: calc.cnssSalarial,
      cnssEmployer: calc.cnssEmployer,
      cnssEmployerPension: calc.cnssEmployerPension,
      cnssEmployerFamily: calc.cnssEmployerFamily,
      cnssEmployerAccident: calc.cnssEmployerAccident,
      tusDgiAmount: calc.tusDgiAmount,
      tusCnssAmount: calc.tusCnssAmount,
      tusTotal: calc.tusTotal,
      its: calc.its,
      irppDetails: calc.irppDetails,
      customTaxes: calc.customTaxDetails,
      employeeCustomTaxTotal: calc.employeeCustomTaxTotal,
      employerCustomTaxTotal: calc.employerCustomTaxTotal,
      loans: loans.map((l) => ({
        id: l.id,
        monthlyRepayment: Number(l.monthlyRepayment),
        remainingBalance: Number(l.remainingBalance),
      })),
      advances: advances.map((a) => ({
        id: a.id,
        amount: Number(a.amount),
        createdAt: a.createdAt,
      })),
      totalLoanDeduction,
      totalAdvanceDeduction,
      manualDeductionTotal,
      totalDeductions: calc.totalDeductions + manualDeductionTotal,
      netSalary: calc.netSalary - manualDeductionTotal,
      totalEmployerCost: calc.totalEmployerCost,
      settings: {
        cnssSalarialRate: settings.cnssSalarialRate,
        cnssEmployerRate: settings.cnssEmployerRate,
        cnssCeiling: settings.cnssCeiling,
        overtimeRate10: settings.overtimeRate10 ?? 10,
        overtimeRate25: settings.overtimeRate25 ?? 25,
        overtimeRate50: settings.overtimeRate50 ?? 50,
        overtimeRate100: settings.overtimeRate100 ?? 100,
      },
      simulationMode: 'MANUAL',
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SAVE
  // ══════════════════════════════════════════════════════════════════════════

  async save(dto: CreateManualPayrollDto, userId: string) {
    const companyId = await this.resolveCompanyId(userId, dto.companyId);
    const { employee, company } = await this.loadEntities(
      dto.employeeId,
      companyId,
    );

    const existing = await this.prisma.payroll.findFirst({
      where: {
        employeeId: dto.employeeId,
        month: dto.month,
        year: dto.year,
        companyId,
      },
    });
    if (existing) {
      throw new PayrollAlreadyExistsException(
        `${employee.firstName} ${employee.lastName}`,
        dto.month,
        dto.year,
      );
    }

    const [settings, companyTaxes, loans, advances, companyDeductions] = await Promise.all([
      this.payrollSettings.getSettingsByCompanyId(companyId),
      this.companyTaxService.findActive(companyId),
      this.deductionsService.getActiveLoans(
        dto.employeeId,
        dto.month,
        dto.year,
      ),
      this.deductionsService.getApprovedAdvances(
        dto.employeeId,
        dto.month,
        dto.year,
      ),
      this.deductionsService.getPendingCompanyDeductionsForEmployee(dto.employeeId),
    ]);

    const effectiveBaseSalary =
      dto.baseSalary != null && dto.baseSalary > 0
        ? dto.baseSalary
        : Number(employee.baseSalary);

    const daysToPay = Math.min(
      dto.workedDays ?? settings.workDaysPerMonth,
      settings.workDaysPerMonth,
    );
    const eff10 = Number(dto.overtimeHours10 ?? 0);
    const eff25 = Number(dto.overtimeHours25 ?? 0);
    const eff50 = Number(dto.overtimeHours50 ?? 0);
    const eff100 = Number(dto.overtimeHours100 ?? 0);
    const absenceDays = Math.max(0, settings.workDaysPerMonth - daysToPay);

    const calculatedBonuses = this.buildCalculatedBonuses(dto.manualBonuses);
    const manualDeductionTotal = (dto.manualDeductions ?? []).reduce(
      (s, d) => s + (Number(d.amount) || 0),
      0,
    );

    const protectionMode = this.smicProtection.determineMode(
      effectiveBaseSalary,
      loans.length > 0 || advances.length > 0 || manualDeductionTotal > 0,
    );
    const prelimCalc = this.calculator.calculate(
      effectiveBaseSalary,
      eff10,
      eff25,
      eff50,
      eff100,
      calculatedBonuses,
      [],
      settings,
      daysToPay,
      settings.workDaysPerMonth,
      employee,
      company,
      companyTaxes,
    );
    const { adjustedDeductions, loansToUpdate, advancesToDeduct, warnings } =
      this.smicProtection.handleDeductions(
        employee,
        prelimCalc,
        loans,
        advances,
        protectionMode,
      );

    const { calcEntries: companyDeductionEntries, toApply: companyDeductionsToApply } =
      this.deductionsService.prepareCompanyDeductionsForCalc(companyDeductions);
    const deductionsForCalc = [...adjustedDeductions, ...companyDeductionEntries];

    const calc = this.calculator.calculate(
      effectiveBaseSalary,
      eff10,
      eff25,
      eff50,
      eff100,
      calculatedBonuses,
      deductionsForCalc,
      settings,
      daysToPay,
      settings.workDaysPerMonth,
      employee,
      company,
      companyTaxes,
    );

    warnings.forEach((w) => this.logger.warn(w));

    const fakeSummary = {
      daysToPay,
      overtime10Hours: eff10,
      overtime25Hours: eff25,
      overtime50Hours: eff50,
      overtime100Hours: eff100,
      daysOnLeave: 0,
      daysRemote: 0,
      daysHoliday: 0,
    };

    return this.prisma.$transaction(
      async (tx) => {
        const payroll = await tx.payroll.create({
          data: {
            employeeId: dto.employeeId,
            companyId,
            month: dto.month,
            year: dto.year,
            periodStart: new Date(dto.year, dto.month - 1, 1),
            periodEnd: new Date(dto.year, dto.month, 0),
            workDays: settings.workDaysPerMonth,
            workedDays: daysToPay,
            absenceDays,
            daysOnLeave: 0,
            daysRemote: 0,
            daysHoliday: 0,
            overtimeHours10: eff10,
            overtimeHours25: eff25,
            overtimeHours50: eff50,
            overtimeHours100: eff100,
            baseSalary: effectiveBaseSalary,
            adjustedBaseSalary: calc.adjustedBaseSalary,
            absenceDeduction: calc.absenceDeduction,
            overtimeAmount10: calc.overtimeAmount10,
            overtimeAmount25: calc.overtimeAmount25,
            overtimeAmount50: calc.overtimeAmount50,
            overtimeAmount100: calc.overtimeAmount100,
            totalOvertimeAmount: calc.totalOvertimeAmount,
            totalBonuses: calc.totalBonuses,
            grossSalary: calc.grossSalary,
            netSalary: calc.netSalary,
            cnssSalarial: calc.cnssSalarial,
            cnssEmployer: calc.cnssEmployer,
            its: calc.its,
            totalDeductions: calc.totalDeductions,
            totalEmployerCost: calc.totalEmployerCost,
            irppAbattement: calc.irppDetails?.abattement ?? 0,
            irppFiscalParts: calc.irppDetails?.fiscalParts ?? 1,
            irppEffectiveRate: calc.irppDetails?.effectiveRate ?? 0,
            cnssEmployerPension: calc.cnssEmployerPension,
            cnssEmployerFamily: calc.cnssEmployerFamily,
            cnssEmployerAccident: calc.cnssEmployerAccident,
            tusDgiAmount: calc.tusDgiAmount,
            tusCnssAmount: calc.tusCnssAmount,
            tusTotal: calc.tusTotal,
            employeeCustomTaxTotal: calc.employeeCustomTaxTotal,
            employerCustomTaxTotal: calc.employerCustomTaxTotal,
            status: 'DRAFT',
            createdById: userId,
          } as any,
        });

        const employeeForItems = {
          ...employee,
          baseSalary: effectiveBaseSalary,
        };

        // ✅ CORRECTIF (bug trouvé) : solde TOTAL réel (tous cycles non
        // soldés), pas seulement le dernier — même correctif que Provision.
        // Avant : `tx.leaveBalance.findFirst(...)` sans passer par
        // getOrCreateLeaveBalance — si aucune ligne n'existait encore pour
        // l'employé (1er bulletin jamais généré), lbSnap valait null et
        // droits/pris/solde retombaient tous à 0.
        const lbSnap = await this.leavesService
          .getTotalLeaveBalanceSummary(employee.id)
          .catch(() => null);
        const leaveSnapshot = {
          droits: dto.congesDroits ?? Number(lbSnap?.annualEntitled ?? 0),
          pris: dto.congesPris ?? Number(lbSnap?.annualTaken ?? 0),
          solde: dto.congesSolde ?? Number(lbSnap?.annualRemaining ?? 0),
        };

        await this.itemsService.create(
          tx,
          payroll.id,
          employeeForItems,
          calc,
          fakeSummary,
          loans,
          advances,
          settings,
          calculatedBonuses,
          undefined,
          leaveSnapshot,
          companyDeductionsToApply,
        );

        for (const loanUpdate of loansToUpdate) {
          const loan = loans.find((l) => l.id === loanUpdate.id);
          if (loan) {
            const isPartial =
              loanUpdate.deduction < Number(loan.monthlyRepayment);
            await this.deductionsService.updateLoan(
              tx,
              loanUpdate.id,
              loanUpdate.deduction,
              Number(loan.remainingBalance),
              dto.month,
              dto.year,
              isPartial,
            );
          }
        }

        await this.deductionsService.markAdvancesAsDeducted(
          tx,
          advancesToDeduct,
          dto.month,
          dto.year,
        );

        // Retenues diverses (pharmacie, cantine, casse matériel...) — même
        // principe que prêts/avances : décrémente remainingBalance et
        // journalise dans CompanyDeductionRepaymentLog (méthode PAYROLL).
        for (const entry of companyDeductionsToApply) {
          const deduction = companyDeductions.find((d: any) => d.id === entry.id);
          if (deduction) {
            await this.deductionsService.applyCompanyDeduction(
              tx,
              entry.id,
              Number(deduction.remainingBalance),
              deduction.monthlyDeduction != null ? Number(deduction.monthlyDeduction) : null,
              dto.month,
              dto.year,
            );
          }
        }

        // ── Détecter congés payés ─────────────────────────────────────────────
        // ✅ CORRECTIF (bug cumuls confirmé, "le cumul baisse d'un mois à
        // l'autre sans raison") : on utilise désormais le flag EXPLICITE
        // `dto.isLeaveDeparture` coché par le RH, plutôt que de deviner
        // depuis le texte d'une prime — l'ancienne regex `/cong[eé]/i` se
        // déclenchait sur n'importe quel libellé contenant juste "congé"
        // (ex: "Rappel congé 2025", une prime sans rapport avec un vrai
        // départ), posant un YtdCheckpoint à tort et faisant "sauter" le
        // cumul du mois suivant. Repli sur l'ancienne détection UNIQUEMENT
        // si le frontend n'envoie pas encore ce champ (rétrocompatibilité
        // le temps de la mise à jour du formulaire).
        const hasCongesPaies =
          dto.isLeaveDeparture ??
          calculatedBonuses.some((b: any) =>
            /cong[eé]/i.test(b.bonusType ?? ''),
          );

        // ✅ Réconcilie TOUJOURS le YtdCheckpoint — pose-le si congé payé
        // présent, le retire s'il existait mais que le bulletin n'a plus de
        // congé (évite les checkpoints orphelins après une édition qui
        // retire la prime congé).
        await this.ytdCheckpointService.reconcile(
          tx,
          employee.id,
          dto.month,
          dto.year,
          hasCongesPaies,
        );

        if (hasCongesPaies) {
          // Déduire les jours du LeaveBalance
          const joursPris = dto.joursCongesPris ?? dto.congesPris ?? 0;
          if (joursPris > 0) {
            const balance = await tx.leaveBalance.findFirst({
              where: { employeeId: employee.id },
              orderBy: { cycleStartDate: 'desc' },
            });
            if (balance) {
              const newTaken = Number(balance.annualTaken) + joursPris;
              const newRemaining = Number(balance.annualRemaining) - joursPris;
              await tx.leaveBalance.update({
                where: { id: balance.id },
                data: {
                  annualTaken: newTaken,
                  annualRemaining: Math.max(0, newRemaining),
                  lastCalculated: new Date(),
                },
              });
              this.logger.log(
                `✅ LeaveBalance — pris +${joursPris}j, remaining: ${Math.max(0, newRemaining)}j`,
              );
            }
          }
        } else {
          // Mois normal — accumulation mensuelle 2,16j (idempotent par
          // mois/année du bulletin — voir accrueMonthlyLeaveForEmployee)
          try {
            await this.leavesService.accrueMonthlyLeaveForEmployee(
              employee.id,
              dto.month,
              dto.year,
            );
            this.logger.log(
              `✅ Accumulation congés +2,16j — ${employee.firstName} ${employee.lastName}`,
            );
          } catch (e: any) {
            this.logger.warn(
              `⚠️ Accumulation congés échouée : ${e?.message ?? String(e)}`,
            );
          }
        }

        // ── Override manuel LeaveBalance si saisi ─────────────────────────────
        if (dto.congesDroits != null || dto.congesPris != null) {
          const droits = dto.congesDroits ?? 0;
          const pris = dto.congesPris ?? 0;
          const solde = dto.congesSolde ?? droits - pris;

          // ✅ Résoudre le cycle en cours de l'employé (dans la même transaction)
          // plutôt que l'année calendaire du bulletin — c'est le cycle qui fait foi.
          const empForCycle = await tx.employee.findUnique({
            where: { id: employee.id },
            select: {
              hireDate: true,
              leaveCycleStartDate: true,
              company: { select: { leaveCycleMode: true } },
            },
          });
          const cycleStartDate = this.resolveLeaveCycleStart(
            new Date(empForCycle!.hireDate),
            empForCycle!.leaveCycleStartDate
              ? new Date(empForCycle!.leaveCycleStartDate)
              : null,
            ((empForCycle as any)?.company?.leaveCycleMode as
              | 'ROLLING'
              | 'ANNIVERSARY') ?? 'ROLLING',
          );
          const cycleEndDate = new Date(cycleStartDate);
          cycleEndDate.setMonth(cycleEndDate.getMonth() + 12);
          const cyclesCount = await tx.leaveBalance.count({
            where: { employeeId: employee.id },
          });

          await tx.leaveBalance.upsert({
            where: {
              employeeId_cycleStartDate: {
                employeeId: employee.id,
                cycleStartDate,
              },
            },
            create: {
              employeeId: employee.id,
              year: cycleStartDate.getFullYear(),
              cycleNumber: cyclesCount + 1,
              cycleStartDate,
              cycleEndDate,
              annualEntitled: droits,
              annualTaken: pris,
              annualRemaining: solde,
            },
            update: {
              annualEntitled: droits,
              annualTaken: pris,
              annualRemaining: solde,
              lastCalculated: new Date(),
            },
          });
          this.logger.log(
            `✅ LeaveBalance mis à jour — droits=${droits}j pris=${pris}j solde=${solde}j`,
          );
        }

        // ── Retenues libres → items DEDUCTION ────────────────────────────────
        if (dto.manualDeductions && dto.manualDeductions.length > 0) {
          for (const ded of dto.manualDeductions.filter(
            (d) => Number(d.amount) > 0,
          )) {
            await tx.payrollItem.create({
              data: {
                payrollId: payroll.id,
                code: 'MANUAL_DEDUCTION',
                label: ded.label || 'Retenue',
                type: 'DEDUCTION',
                amount: Number(ded.amount),
                base: null,
                rate: null,
                isTaxable: false,
                isCnss: false,
                order: 900,
              } as any,
            });
          }
          await tx.payroll.update({
            where: { id: payroll.id },
            data: {
              netSalary: calc.netSalary - manualDeductionTotal,
              totalDeductions: calc.totalDeductions + manualDeductionTotal,
            },
          });
        }

        return payroll;
      },
      {
        maxWait: 10_000,
        timeout: 30_000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }
}