// import { Injectable, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
// import { PrismaService } from '../prisma/prisma.service';
// import { Prisma } from '@prisma/client';

// import { PayrollCalculatorService } from './services/payroll-calculator.service';
// import { PayrollItemsService } from './services/payroll-items.service';
// import { PayrollSmicProtectionService } from './services/payroll-smic-protection.service';
// import { PayrollDeductionsService } from './services/payroll-deductions.service';
// import { PayrollGeneratorService } from './services/payroll-generator.service';
// import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
// import { PayrollBonusesService } from './services/payroll-bonuses.service';
// import { CompanyTaxService } from '../company-taxes/company-tax.service'; // ✅

// import { LoansService } from '../loans/loans.service';
// import { AttendanceSummaryService } from '../attendance/attendance-summary.service';
// import { PayrollSettingsService } from '../payroll/settings/settings.service';

// import { CreatePayrollDto } from './dto/create-payroll.dto';
// import { UpdatePayrollDto } from './dto/update-payroll.dto';
// import {
//   CompanyNotFoundException, EmployeeNotFoundException,
//   PayrollAlreadyExistsException, PayrollNotFoundException, PayrollAlreadyPaidException
// } from '../exceptions/business.exceptions';

// export interface SimulatePayrollOverrides {
//   baseSalary?:       number;
//   workedDays?:       number;
//   overtimeHours10?:  number;
//   overtimeHours25?:  number;
//   overtimeHours50?:  number;
//   overtimeHours100?: number;
//   manualBonuses?: Array<{ id?: string; bonusType: string; amount: number; isTaxable?: boolean; isCnss?: boolean }>;
// }

// @Injectable()
// export class PayrollsService {
//   private readonly logger = new Logger(PayrollsService.name);

//   constructor(
//     private prisma: PrismaService,
//     private calculator: PayrollCalculatorService,
//     private itemsService: PayrollItemsService,
//     private smicProtection: PayrollSmicProtectionService,
//     private deductionsService: PayrollDeductionsService,
//     private generator: PayrollGeneratorService,
//     private loansService: LoansService,
//     private attendanceSummary: AttendanceSummaryService,
//     private payrollSettingsService: PayrollSettingsService,
//     private subscriptionGuard: SubscriptionGuard,
//     private bonusesService: PayrollBonusesService,
//     private companyTaxService: CompanyTaxService, // ✅
//   ) {}

//   private getMonthNumber(month: string): number {
//     const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
//     const index = months.indexOf(month.toLowerCase());
//     if (index !== -1) return index + 1;
//     const parsed = parseInt(month, 10);
//     return isNaN(parsed) ? new Date().getMonth() + 1 : parsed;
//   }

//   private async shouldEmployeeBePaid(employeeId: string, companyId: string, month: number, year: number) {
//     await this.attendanceSummary.generateAndStoreAllMonthlySummaries(companyId, month, year);
//     const summaries = await this.attendanceSummary.getStoredSummaries(companyId, month, year, [employeeId]);
//     if (summaries.length === 0) return { shouldPay: false, daysToPay: 0, summary: null, reason: 'Aucun pointage enregistré pour ce mois' };
//     const summary = summaries[0];
//     if (summary.daysToPay <= 0) return { shouldPay: false, daysToPay: 0, summary, reason: `Aucun jour travaillé` };
//     return { shouldPay: true, daysToPay: summary.daysToPay, summary };
//   }

//   // ============================================================================
//   // CREATE
//   // ============================================================================
//   async create(createPayrollDto: CreatePayrollDto, userId: string) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true, role: true },
//     });

//     // ✅ FIX BUG 6: CABINET_ADMIN n'a pas de companyId sur son User
//     // Il fournit le companyId directement dans le DTO (front l'envoie déjà)
//     const isCabinet = user?.role === 'CABINET_ADMIN' || user?.role === 'CABINET_GESTIONNAIRE';
//     const effectiveCompanyId = isCabinet
//       ? (createPayrollDto as any).companyId
//       : user?.companyId;

//     if (!effectiveCompanyId) throw new CompanyNotFoundException();

//     // Vérification abonnement : uniquement pour les entreprises directes (pas cabinet)
//     if (!isCabinet) {
//       await this.subscriptionGuard.checkFeatureAccess(effectiveCompanyId, 'hasPayrollIndividual');
//     }

//     const { employeeId, month, year, overtime10, overtime25, overtime50, overtime100, workedDays } = createPayrollDto as any;
//     const monthNum = this.getMonthNumber(month);

//     const [employee, company] = await Promise.all([
//       this.prisma.employee.findUnique({
//         where: { id: employeeId },
//         select: {
//           id: true, firstName: true, lastName: true, baseSalary: true,
//           maritalStatus: true, numberOfChildren: true,
//           isSubjectToIrpp: true, isSubjectToCnss: true, isSubjectToTus: true,
//           taxExemptionReason: true, tolZone: true,
//           contractType: true, // ← détermine CNSS/ITS/TUS/BNC
//           isResident: true,   // ← taux BNC 10% ou 20%
//         }
//       }),
//       this.prisma.company.findUnique({ where: { id: effectiveCompanyId }, select: { appliesCnssEmployer: true, cnssEmployerRate: true, isSubjectToTus: true } })
//     ]);

//     if (!employee) throw new EmployeeNotFoundException(employeeId);

//     // Bloquer la génération de bulletin pour INTERIM (géré par l'agence)
//     if ((employee as any).contractType === 'INTERIM') {
//       throw new BadRequestException(
//         'Les intérimaires sont gérés par leur agence. Aucun bulletin ne peut être généré côté entreprise.'
//       );
//     }

//     const existing = await this.prisma.payroll.findFirst({ where: { employeeId, month: monthNum, year, companyId: effectiveCompanyId } });
//     if (existing) throw new PayrollAlreadyExistsException(`${employee.firstName} ${employee.lastName}`, monthNum, year);

//     const { shouldPay, daysToPay, summary, reason } = await this.shouldEmployeeBePaid(employeeId, effectiveCompanyId, monthNum, year);
//     if (!shouldPay) throw new Error(`❌ Impossible de créer le bulletin : ${reason}`);

//     const [settings, companyTaxes] = await Promise.all([
//       this.payrollSettingsService.getSettingsByCompanyId(effectiveCompanyId),
//       this.companyTaxService.findActive(effectiveCompanyId), // ✅ Charger les taxes actives
//     ]);

//     const eff10  = (overtime10  != null) ? Number(overtime10)  : Number((summary as any).overtime10Hours  ?? 0);
//     const eff25  = (overtime25  != null) ? Number(overtime25)  : Number((summary as any).overtime25Hours  ?? 0);
//     const eff50  = (overtime50  != null) ? Number(overtime50)  : Number((summary as any)?.overtime50Hours  ?? 0);
//     const eff100 = (overtime100 != null) ? Number(overtime100) : Number((summary as any).overtime100Hours ?? 0);

//     const calculatedBonuses = await this.bonusesService.calculateEmployeeBonuses(employeeId, Number(employee.baseSalary), monthNum, year);
//     const [loans, advances] = await Promise.all([
//       this.deductionsService.getActiveLoans(employeeId),
//       this.deductionsService.getApprovedAdvances(employeeId, monthNum, year)
//     ]);

//     const hasVoluntaryDeductions = loans.length > 0 || advances.length > 0;
//     const protectionMode = this.smicProtection.determineMode(Number(employee.baseSalary), hasVoluntaryDeductions);

//     // ✅ Passer companyTaxes au calculateur
//     const prelimCalc = this.calculator.calculate(
//       Number(employee.baseSalary), eff10, eff25, eff50, eff100,
//       calculatedBonuses, [], settings, daysToPay, settings.workDaysPerMonth, employee, company, companyTaxes
//     );

//     const { adjustedDeductions, loansToUpdate, advancesToDeduct, warnings } =
//       this.smicProtection.handleDeductions(employee, prelimCalc, loans, advances, protectionMode);

//     const calc = this.calculator.calculate(
//       Number(employee.baseSalary), eff10, eff25, eff50, eff100,
//       calculatedBonuses, adjustedDeductions, settings, daysToPay, settings.workDaysPerMonth, employee, company, companyTaxes
//     );

//     warnings.forEach(w => this.logger.warn(w));
//     const absenceDays = Math.max(0, settings.workDaysPerMonth - daysToPay);

//     return this.prisma.$transaction(async (tx) => {
//       const payroll = await tx.payroll.create({
//         data: {
//           employeeId, companyId: effectiveCompanyId,
//           month: monthNum, year,
//           periodStart: new Date(year, monthNum - 1, 1),
//           periodEnd:   new Date(year, monthNum, 0),
//           workDays: settings.workDaysPerMonth,
//           workedDays: daysToPay, absenceDays,
//           daysOnLeave: (summary as any)?.daysOnLeave ?? 0, daysRemote: (summary as any)?.daysRemote ?? 0, daysHoliday: (summary as any)?.daysHoliday ?? 0,
//           overtimeHours10: eff10, overtimeHours25: eff25, overtimeHours50: eff50, overtimeHours100: eff100,
//           baseSalary: Number(employee.baseSalary),
//           adjustedBaseSalary: calc.adjustedBaseSalary,
//           absenceDeduction:   calc.absenceDeduction,
//           overtimeAmount10:   calc.overtimeAmount10,
//           overtimeAmount25:   calc.overtimeAmount25,
//           overtimeAmount50:   calc.overtimeAmount50,
//           overtimeAmount100:  calc.overtimeAmount100,
//           totalOvertimeAmount: calc.totalOvertimeAmount,
//           totalBonuses:       calc.totalBonuses,
//           grossSalary:        calc.grossSalary,
//           netSalary:          calc.netSalary,
//           cnssSalarial:       calc.cnssSalarial,
//           cnssEmployer:       calc.cnssEmployer,
//           its:                calc.its,
//           totalDeductions:    calc.totalDeductions,
//           totalEmployerCost:  calc.totalEmployerCost,
//           irppAbattement:    calc.irppDetails?.abattement    || 0,
//           irppFiscalParts:   calc.irppDetails?.fiscalParts   || 1,
//           irppEffectiveRate: calc.irppDetails?.effectiveRate || 0,
//           cnssEmployerPension:  calc.cnssEmployerPension,
//           cnssEmployerFamily:   calc.cnssEmployerFamily,
//           cnssEmployerAccident: calc.cnssEmployerAccident,
//           tusDgiAmount:  calc.tusDgiAmount,
//           tusCnssAmount: calc.tusCnssAmount,
//           tusTotal:      calc.tusTotal,
//           // ✅ Stocker les totaux taxes custom
//           employeeCustomTaxTotal: calc.employeeCustomTaxTotal,
//           employerCustomTaxTotal: calc.employerCustomTaxTotal,
//           status: 'DRAFT', createdById: userId,
//         } as any
//       });

//       await this.itemsService.create(
//         tx, payroll.id, employee, calc,
//         { ...summary, overtime10Hours: eff10, overtime25Hours: eff25, overtime50Hours: eff50, overtime100Hours: eff100 },
//         loans, advances, settings, calculatedBonuses
//       );

//       for (const loanUpdate of loansToUpdate) {
//         const loan = loans.find(l => l.id === loanUpdate.id);
//         if (loan) {
//           const isPartial = loanUpdate.deduction < Number(loan.monthlyRepayment);
//           await this.deductionsService.updateLoan(tx, loanUpdate.id, loanUpdate.deduction, Number(loan.remainingBalance), monthNum, year, isPartial);
//         }
//       }

//       await this.deductionsService.markAdvancesAsDeducted(tx, advancesToDeduct);
//       return payroll;
//     }, { maxWait: 10000, timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
//   }

//   async generateMonthlyPayrolls(userId: string, month: number, year: number, employeeIds?: string[], customWorkDays?: number) {
//     return this.generator.generate(userId, month, year, employeeIds, customWorkDays);
//   }

//   // ============================================================================
//   // FIND ALL — avec filtres companyId / month / year / limit
//   // ✅ Remplace l'ancienne méthode findAll
//   // ============================================================================
//   async findAll(
//     userId: string,
//     employeeId?: string,
//     filters?: { companyId?: string; month?: number; year?: number; limit?: number },
//   ) {
//     const user = await this.prisma.user.findUnique({
//       where:  { id: userId },
//       select: { companyId: true, role: true, employeeId: true, email: true },
//     });

//     // Pour les rôles cabinet, on utilise le companyId passé en filtre
//     const isCabinet = user?.role === 'CABINET_ADMIN' || user?.role === 'CABINET_GESTIONNAIRE';
//     const effectiveCompanyId = (isCabinet && filters?.companyId)
//       ? filters.companyId
//       : user?.companyId;

//     if (!effectiveCompanyId) return [];

//     const whereClause: any = { companyId: effectiveCompanyId };

//     if (user?.role === 'EMPLOYEE') {
//       whereClause.employeeId = user.employeeId
//         ?? (await this.prisma.employee.findFirst({ where: { email: user.email, companyId: effectiveCompanyId } }))?.id;
//       if (!whereClause.employeeId) return [];
//       whereClause.status = 'PAID';
//     } else if (employeeId) {
//       whereClause.employeeId = employeeId;
//     }

//     if (filters?.month) whereClause.month = filters.month;
//     if (filters?.year)  whereClause.year  = filters.year;

//     return this.prisma.payroll.findMany({
//       where:   whereClause,
//       include: { employee: { select: { firstName: true, lastName: true, employeeNumber: true, position: true } } },
//       orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
//       take:    filters?.limit ?? 200,
//     });
//   }

//   async findOne(id: string, userId: string) {
//     const payroll = await this.prisma.payroll.findUnique({ where: { id }, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, position: true, baseSalary: true, maritalStatus: true, numberOfChildren: true, cnssNumber: true, paymentMethod: true, department: { select: { id: true, name: true, code: true } } } }, items: { orderBy: { order: 'asc' } }, company: true } });
//     if (!payroll) throw new PayrollNotFoundException(id);
//     const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, employeeId: true, companyId: true, email: true } });
//     if (!user) throw new ForbiddenException('Utilisateur non trouvé');
//     if (user.companyId !== payroll.companyId) throw new ForbiddenException('Accès refusé');
//     if (user.role === 'EMPLOYEE') {
//       const isOwner = user.employeeId === payroll.employeeId;
//       if (!isOwner) {
//         const emp = await this.prisma.employee.findFirst({ where: { email: user.email, companyId: user.companyId } });
//         if (!emp || emp.id !== payroll.employeeId) throw new ForbiddenException('Accès à vos bulletins uniquement');
//       }
//       if (payroll.status !== 'PAID') throw new ForbiddenException('Bulletin non encore disponible');
//     }
//     return payroll;
//   }

//   async update(id: string, updatePayrollDto: UpdatePayrollDto, userId?: string) {
//     const payroll = await this.prisma.payroll.findUnique({ where: { id } });
//     if (!payroll) throw new PayrollNotFoundException(id);
//     if (payroll.status === 'PAID') throw new PayrollAlreadyPaidException();
//     if (userId) {
//       const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, companyId: true } });
//       if (user?.role === 'EMPLOYEE') throw new ForbiddenException('Modification réservée aux admins/RH');
//       if (user?.companyId !== payroll.companyId) throw new ForbiddenException('Accès refusé');
//     }
//     return this.prisma.payroll.update({ where: { id }, data: { ...updatePayrollDto, updatedAt: new Date() } });
//   }

//   async remove(id: string) {
//     const payroll = await this.prisma.payroll.findUnique({ where: { id } });
//     if (!payroll) throw new PayrollNotFoundException(id);
//     if (payroll.status === 'PAID') throw new PayrollAlreadyPaidException();
//     await this.prisma.payroll.delete({ where: { id } });
//     return { success: true, message: 'Bulletin supprimé avec succès' };
//   }

//   // ============================================================================
//   // RECALCULATE
//   // ============================================================================
//   async recalculatePayroll(id: string, userId: string, overrides?: any) {
//     const payroll = await this.prisma.payroll.findUnique({ where: { id }, include: { employee: true } });
//     if (!payroll) throw new PayrollNotFoundException(id);
//     if (payroll.status === 'PAID') throw new PayrollAlreadyPaidException();
//     const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, companyId: true } });
//     if (user?.role === 'EMPLOYEE') throw new ForbiddenException('Recalcul réservé aux admins/RH');
//     if (user?.companyId !== payroll.companyId) throw new ForbiddenException('Accès refusé');

//     const [employee, company, settings, companyTaxes] = await Promise.all([
//       this.prisma.employee.findUnique({ where: { id: payroll.employeeId }, select: { id: true, firstName: true, lastName: true, baseSalary: true, maritalStatus: true, numberOfChildren: true, isSubjectToIrpp: true, isSubjectToCnss: true, isSubjectToTus: true, taxExemptionReason: true, tolZone: true, contractType: true, isResident: true } }),
//       this.prisma.company.findUnique({ where: { id: payroll.companyId }, select: { appliesCnssEmployer: true, cnssEmployerRate: true, isSubjectToTus: true } }),
//       this.payrollSettingsService.getSettingsByCompanyId(payroll.companyId),
//       this.companyTaxService.findActive(payroll.companyId), // ✅
//     ]);

//     if (!employee) throw new EmployeeNotFoundException(payroll.employeeId);

//     const effectiveBaseSalary = overrides?.baseSalary ?? Number(payroll.baseSalary);
//     const effectiveDays       = overrides?.workedDays ?? Number(payroll.workedDays);
//     const eff10  = overrides?.overtimeHours10  ?? Number((payroll as any).overtimeHours10  || 0);
//     const eff25  = overrides?.overtimeHours25  ?? Number((payroll as any).overtimeHours25  || 0);
//     const eff50  = overrides?.overtimeHours50  ?? Number((payroll as any).overtimeHours50  || 0);
//     const eff100 = overrides?.overtimeHours100 ?? Number((payroll as any).overtimeHours100 || 0);

//     let calculatedBonuses: any[];
//     if (overrides?.manualBonuses && overrides.manualBonuses.length > 0) {
//       calculatedBonuses = overrides.manualBonuses.map((b: any, i: number) => ({ id: `manual-recalc-${i}`, bonusType: b.bonusType, amount: Number(b.amount), isTaxable: b.isTaxable ?? true, isCnss: b.isCnss ?? true, source: 'MANUAL', isRecurring: true }));
//     } else {
//       calculatedBonuses = await this.bonusesService.calculateEmployeeBonuses(payroll.employeeId, effectiveBaseSalary, payroll.month, payroll.year);
//     }

//     const [loans, advances] = await Promise.all([
//       this.deductionsService.getActiveLoans(payroll.employeeId),
//       this.deductionsService.getApprovedAdvances(payroll.employeeId, payroll.month, payroll.year)
//     ]);

//     const protectionMode = this.smicProtection.determineMode(effectiveBaseSalary, loans.length > 0 || advances.length > 0);
//     const prelimCalc = this.calculator.calculate(effectiveBaseSalary, eff10, eff25, eff50, eff100, calculatedBonuses, [], settings, effectiveDays, settings.workDaysPerMonth, employee, company, companyTaxes);
//     const { adjustedDeductions } = this.smicProtection.handleDeductions(employee, prelimCalc, loans, advances, protectionMode);
//     const calc = this.calculator.calculate(effectiveBaseSalary, eff10, eff25, eff50, eff100, calculatedBonuses, adjustedDeductions, settings, effectiveDays, settings.workDaysPerMonth, employee, company, companyTaxes);

//     const updated = await this.prisma.payroll.update({
//       where: { id },
//       data: {
//         baseSalary: effectiveBaseSalary, workedDays: effectiveDays,
//         absenceDays: Math.max(0, settings.workDaysPerMonth - effectiveDays),
//         overtimeHours10: eff10, overtimeHours25: eff25, overtimeHours50: eff50, overtimeHours100: eff100,
//         adjustedBaseSalary: calc.adjustedBaseSalary, absenceDeduction: calc.absenceDeduction,
//         overtimeAmount10: calc.overtimeAmount10, overtimeAmount25: calc.overtimeAmount25,
//         overtimeAmount50: calc.overtimeAmount50, overtimeAmount100: calc.overtimeAmount100,
//         totalOvertimeAmount: calc.totalOvertimeAmount, totalBonuses: calc.totalBonuses,
//         grossSalary: calc.grossSalary, netSalary: calc.netSalary,
//         cnssSalarial: calc.cnssSalarial, cnssEmployer: calc.cnssEmployer, its: calc.its,
//         totalDeductions: calc.totalDeductions, totalEmployerCost: calc.totalEmployerCost,
//         irppAbattement: calc.irppDetails?.abattement || 0, irppFiscalParts: calc.irppDetails?.fiscalParts || 1, irppEffectiveRate: calc.irppDetails?.effectiveRate || 0,
//         cnssEmployerPension: calc.cnssEmployerPension, cnssEmployerFamily: calc.cnssEmployerFamily, cnssEmployerAccident: calc.cnssEmployerAccident,
//         tusDgiAmount: calc.tusDgiAmount, tusCnssAmount: calc.tusCnssAmount, tusTotal: calc.tusTotal,
//         employeeCustomTaxTotal: calc.employeeCustomTaxTotal, // ✅
//         employerCustomTaxTotal: calc.employerCustomTaxTotal, // ✅
//         updatedAt: new Date(),
//       } as any
//     });

//     return { ...updated, recalculated: true, calc };
//   }

//   // ============================================================================
//   // SIMULATE
//   // ============================================================================
//   async simulatePayroll(employeeId: string, month: string | number, year: number, userId: string, overrides?: SimulatePayrollOverrides) {
//     const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
//     if (!user?.companyId) throw new CompanyNotFoundException();

//     const monthNum = typeof month === 'string' ? this.getMonthNumber(month) : month;

//     const [employee, company] = await Promise.all([
//       this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, firstName: true, lastName: true, baseSalary: true, maritalStatus: true, numberOfChildren: true, isSubjectToIrpp: true, isSubjectToCnss: true, isSubjectToTus: true, taxExemptionReason: true, tolZone: true, contractType: true, isResident: true } }),
//       this.prisma.company.findUnique({ where: { id: user.companyId }, select: { appliesCnssEmployer: true, cnssEmployerRate: true, isSubjectToTus: true } })
//     ]);
//     if (!employee) throw new EmployeeNotFoundException(employeeId);

//     const [settings, companyTaxes] = await Promise.all([
//       this.payrollSettingsService.getSettingsByCompanyId(user.companyId),
//       this.companyTaxService.findActive(user.companyId), // ✅
//     ]);

//     let daysToPay = settings.workDaysPerMonth;
//     let att10 = 0, att25 = 0, att50 = 0, att100 = 0;

//     const hasWorkedDaysOverride = overrides?.workedDays != null;
//     const hasOvertimeOverride   = overrides?.overtimeHours10 != null || overrides?.overtimeHours25 != null || overrides?.overtimeHours50 != null || overrides?.overtimeHours100 != null;

//     if (!hasWorkedDaysOverride || !hasOvertimeOverride) {
//       try {
//         await this.attendanceSummary.generateAndStoreAllMonthlySummaries(user.companyId, monthNum, year);
//         const summaries = await this.attendanceSummary.getStoredSummaries(user.companyId, monthNum, year, [employeeId]);
//         if (summaries.length > 0) {
//           const s = summaries[0];
//           if (!hasWorkedDaysOverride && s.daysToPay > 0) daysToPay = s.daysToPay;
//           if (!hasOvertimeOverride) {
//             att10  = Number((s as any).overtime10Hours  ?? 0);
//             att25  = Number((s as any).overtime25Hours  ?? 0);
//             att50  = Number(s.overtime50Hours  ?? 0);
//             att100 = Number((s as any).overtime100Hours ?? 0);
//           }
//         }
//       } catch { this.logger.warn(`⚠️ Pointage indisponible pour ${employeeId}`); }
//     }

//     if (hasWorkedDaysOverride) daysToPay = overrides!.workedDays!;
//     const eff10  = overrides?.overtimeHours10  != null ? overrides.overtimeHours10  : att10;
//     const eff25  = overrides?.overtimeHours25  != null ? overrides.overtimeHours25  : att25;
//     const eff50  = overrides?.overtimeHours50  != null ? overrides.overtimeHours50  : att50;
//     const eff100 = overrides?.overtimeHours100 != null ? overrides.overtimeHours100 : att100;
//     const effectiveBaseSalary = (overrides?.baseSalary != null && overrides.baseSalary > 0) ? overrides.baseSalary : Number(employee.baseSalary);

//     let calculatedBonuses: any[], simulationMode: string;
//     if (overrides?.manualBonuses && overrides.manualBonuses.length > 0) {
//       calculatedBonuses = (overrides!.manualBonuses as any[]).map(b => ({ id: b.id ?? `manual-${Date.now()}`, bonusType: b.bonusType, amount: Number(b.amount), isTaxable: b.isTaxable ?? true, isCnss: b.isCnss ?? true, source: 'MANUAL', isRecurring: true }));
//       simulationMode = 'MANUAL_OVERRIDE';
//     } else {
//       calculatedBonuses = await this.bonusesService.calculateEmployeeBonuses(employeeId, effectiveBaseSalary, monthNum, year);
//       simulationMode = (overrides && Object.keys(overrides).length > 0) ? 'MANUAL_OVERRIDE' : 'FROM_ATTENDANCE';
//     }

//     const [loans, advances] = await Promise.all([
//       this.deductionsService.getActiveLoans(employeeId),
//       this.deductionsService.getApprovedAdvances(employeeId, monthNum, year)
//     ]);

//     const protectionMode = this.smicProtection.determineMode(effectiveBaseSalary, loans.length > 0 || advances.length > 0);
//     const prelimCalc = this.calculator.calculate(effectiveBaseSalary, eff10, eff25, eff50, eff100, calculatedBonuses, [], settings, daysToPay, settings.workDaysPerMonth, employee, company, companyTaxes);
//     const { adjustedDeductions } = this.smicProtection.handleDeductions(employee, prelimCalc, loans, advances, protectionMode);
//     const calc = this.calculator.calculate(effectiveBaseSalary, eff10, eff25, eff50, eff100, calculatedBonuses, adjustedDeductions, settings, daysToPay, settings.workDaysPerMonth, employee, company, companyTaxes);

//     const totalLoanDeduction    = loans.reduce((s, l) => s + Number(l.monthlyRepayment), 0);
//     const totalAdvanceDeduction = advances.reduce((s, a) => s + Number(a.amount), 0);

//     return {
//       employee: { id: employee.id, firstName: employee.firstName, lastName: employee.lastName, baseSalary: Number(employee.baseSalary), effectiveBaseSalary, isSubjectToCnss: employee.isSubjectToCnss, isSubjectToIrpp: employee.isSubjectToIrpp, isSubjectToTus: employee.isSubjectToTus, taxExemptionReason: employee.taxExemptionReason },
//       month: monthNum, year, daysToPay, workDays: settings.workDaysPerMonth,
//       overtime: { hours10: eff10, amount10: calc.overtimeAmount10, hours25: eff25, amount25: calc.overtimeAmount25, hours50: eff50, amount50: calc.overtimeAmount50, hours100: eff100, amount100: calc.overtimeAmount100, total: calc.totalOvertimeAmount },
//       bonuses: calculatedBonuses, totalBonuses: calc.totalBonuses,
//       adjustedBaseSalary: calc.adjustedBaseSalary, absenceDeduction: calc.absenceDeduction,
//       grossSalary: calc.grossSalary, cnssSalarial: calc.cnssSalarial,
//       cnssEmployer: calc.cnssEmployer, cnssEmployerPension: calc.cnssEmployerPension, cnssEmployerFamily: calc.cnssEmployerFamily, cnssEmployerAccident: calc.cnssEmployerAccident,
//       tusDgiAmount: calc.tusDgiAmount, tusCnssAmount: calc.tusCnssAmount, tusTotal: calc.tusTotal,
//       its: calc.its, irppDetails: calc.irppDetails,
//       // ✅ Taxes custom dans la réponse simulation
//       customTaxes:            calc.customTaxDetails,
//       employeeCustomTaxTotal: calc.employeeCustomTaxTotal,
//       employerCustomTaxTotal: calc.employerCustomTaxTotal,
//       loans:    loans.map(l => ({ id: l.id, monthlyRepayment: Number(l.monthlyRepayment), remainingBalance: Number(l.remainingBalance) })),
//       advances: advances.map(a => ({ id: a.id, amount: Number(a.amount), createdAt: a.createdAt })),
//       totalLoanDeduction, totalAdvanceDeduction,
//       totalDeductions: calc.totalDeductions, netSalary: calc.netSalary, totalEmployerCost: calc.totalEmployerCost,
//       settings: { cnssSalarialRate: settings.cnssSalarialRate, cnssEmployerRate: settings.cnssEmployerRate, cnssCeiling: settings.cnssCeiling, overtimeRate10: settings.overtimeRate10 ?? 10, overtimeRate25: settings.overtimeRate25 ?? 25, overtimeRate50: settings.overtimeRate50 ?? 50, overtimeRate100: settings.overtimeRate100 ?? 100 },
//       simulationMode,
//     };
//   }

//   // ============================================================================
//   // SIMULATE BATCH
//   // ============================================================================
//   async simulateBatchPayroll(employeeIds: string[], month: number, year: number, userId: string) {
//     const simulations = await Promise.allSettled(employeeIds.map(id => this.simulatePayroll(id, month, year, userId)));
//     const results = simulations.map((result, index) => {
//       if (result.status === 'fulfilled') return { employeeId: employeeIds[index], success: true, data: result.value };
//       return { employeeId: employeeIds[index], success: false, error: (result.reason as Error).message };
//     });
//     const successful = results.filter(r => r.success).map(r => r.data!);
//     return {
//       results,
//       summary: {
//         count:             successful.length,
//         totalGross:        successful.reduce((s, d: any) => s + d.grossSalary, 0),
//         totalNet:          successful.reduce((s, d: any) => s + d.netSalary, 0),
//         totalEmployerCost: successful.reduce((s, d: any) => s + d.totalEmployerCost, 0),
//         totalCnss:         successful.reduce((s, d: any) => s + d.cnssSalarial, 0),
//         totalIts:          successful.reduce((s, d: any) => s + d.its, 0),
//       }
//     };
//   }

//   // ============================================================================
//   // SIMULATE FREE — pas de company réelle → taxes custom vides
//   // ============================================================================
//   async simulateFree(body: any) {
//     const { firstName = 'Simulation', lastName = 'Libre', baseSalary, maritalStatus = 'SINGLE', numberOfChildren = 0, isSubjectToCnss = true, isSubjectToIrpp = true, fiscalMode = 'ITS_2026', forfaitItsRate = 0.08, month, year, workedDays, overtimeHours10 = 0, overtimeHours25 = 0, overtimeHours50 = 0, overtimeHours100 = 0, manualBonuses = [] } = body;
//     if (!baseSalary || baseSalary < 70400) throw new Error('Salaire de base invalide (minimum SMIG : 70 400 FCFA)');

//     const fakeEmployee = { id: `free-sim-${Date.now()}`, firstName, lastName, baseSalary, maritalStatus, numberOfChildren, isSubjectToCnss, isSubjectToIrpp, isSubjectToTus: true, taxExemptionReason: null };
//     const fakeCompany  = { appliesCnssEmployer: true, cnssEmployerRate: 20.25, isSubjectToTus: true };
//     const settings     = this.defaultFreeSettings(fiscalMode, forfaitItsRate);
//     const daysToPay    = workedDays ?? settings.workDaysPerMonth;

//     const calculatedBonuses = manualBonuses.filter((b: any) => b.bonusType && b.amount > 0).map((b: any, i: number) => ({ id: `free-bonus-${i}`, bonusType: b.bonusType, amount: Number(b.amount), isTaxable: b.isTaxable ?? true, isCnss: b.isCnss ?? true, source: 'MANUAL', isRecurring: true }));

//     // ✅ Simulation libre = pas de company réelle → companyTaxes vide
//     const calc = this.calculator.calculate(baseSalary, overtimeHours10, overtimeHours25, overtimeHours50, overtimeHours100, calculatedBonuses, [], settings, daysToPay, settings.workDaysPerMonth, fakeEmployee, fakeCompany, []);

//     return {
//       employee: { id: fakeEmployee.id, firstName, lastName, baseSalary, effectiveBaseSalary: baseSalary, isSubjectToCnss, isSubjectToIrpp, isSubjectToTus: true, taxExemptionReason: null },
//       month, year, daysToPay, workDays: settings.workDaysPerMonth,
//       overtime: { hours10: overtimeHours10, amount10: calc.overtimeAmount10, hours25: overtimeHours25, amount25: calc.overtimeAmount25, hours50: overtimeHours50, amount50: calc.overtimeAmount50, hours100: overtimeHours100, amount100: calc.overtimeAmount100, total: calc.totalOvertimeAmount },
//       bonuses: calculatedBonuses, totalBonuses: calc.totalBonuses,
//       adjustedBaseSalary: calc.adjustedBaseSalary, absenceDeduction: calc.absenceDeduction,
//       grossSalary: calc.grossSalary, cnssSalarial: calc.cnssSalarial,
//       cnssEmployer: calc.cnssEmployer, cnssEmployerPension: calc.cnssEmployerPension, cnssEmployerFamily: calc.cnssEmployerFamily, cnssEmployerAccident: calc.cnssEmployerAccident,
//       tusDgiAmount: calc.tusDgiAmount, tusCnssAmount: calc.tusCnssAmount, tusTotal: calc.tusTotal,
//       its: calc.its, irppDetails: calc.irppDetails,
//       customTaxes: [], employeeCustomTaxTotal: 0, employerCustomTaxTotal: 0,
//       loans: [], advances: [], totalLoanDeduction: 0, totalAdvanceDeduction: 0,
//       totalDeductions: calc.totalDeductions, netSalary: calc.netSalary, totalEmployerCost: calc.totalEmployerCost,
//       settings: { cnssSalarialRate: settings.cnssSalarialRate, cnssEmployerRate: settings.cnssEmployerRate, fiscalMode, forfaitItsRate },
//       simulationMode: 'FREE_SIMULATION',
//     };
//   }

//   async getAccountingJournal(userId: string, month: number, year: number) {
//     const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
//     if (!user?.companyId) throw new CompanyNotFoundException();
//     await this.subscriptionGuard.checkFeatureAccess(user.companyId, 'hasPayrollAccountingExport');
//     const payrolls = await this.prisma.payroll.findMany({ where: { companyId: user.companyId, month, year }, include: { employee: { select: { employeeNumber: true, firstName: true, lastName: true } } } });
//     const entries: any[] = [];
//     for (const p of payrolls) {
//       const name = `${p.employee.firstName} ${p.employee.lastName}`;
//       const piece = `PAY-${p.employee.employeeNumber}-${month}-${year}`;
//       entries.push(
//         { date: p.periodEnd, journal: 'PAIE', piece, account: '661100', label: `Salaire brut - ${name}`, debit: Number(p.grossSalary), credit: 0 },
//         { date: p.periodEnd, journal: 'PAIE', piece, account: '431300', label: `CNSS Salarié - ${name}`, debit: 0, credit: Number(p.cnssSalarial) },
//         { date: p.periodEnd, journal: 'PAIE', piece, account: '447200', label: `ITS/IRPP - ${name}`, debit: 0, credit: Number(p.its) },
//         { date: p.periodEnd, journal: 'PAIE', piece, account: '422000', label: `Rémunération due - ${name}`, debit: 0, credit: Number(p.netSalary) }
//       );
//     }
//     return { month, year, totalEntries: entries.length, entries };
//   }

//   // ============================================================================
//   // DECLARATIONS SUMMARY — Récapitulatif CNSS + TUS + ITS pour un mois
//   // ============================================================================
//   async getDeclarationsSummary(companyId: string, month: number, year: number) {
//     const payrolls = await this.prisma.payroll.findMany({
//       where: { companyId, month, year, status: { not: 'CANCELLED' } },
//     });

//     if (payrolls.length === 0) return null;

//     const sum = (field: string) =>
//       payrolls.reduce((acc, p) => acc + Number((p as any)[field] ?? 0), 0);

//     const totalGrossSalary     = sum('grossSalary');
//     const totalCnssSalarial    = sum('cnssSalarial');
//     const cnssEmployerPension  = sum('cnssEmployerPension');
//     const cnssEmployerFamily   = sum('cnssEmployerFamily');
//     const cnssEmployerAccident = sum('cnssEmployerAccident');
//     const totalCnssEmployer    = sum('cnssEmployer');
//     const tusDgiAmount         = sum('tusDgiAmount');
//     const tusCnssAmount        = sum('tusCnssAmount');
//     const tusTotal             = sum('tusTotal');
//     const totalIts             = sum('its');

//     // Agréger les taxes custom (stockées en JSON dans customTaxDetails)
//     const customMap: Record<string, { name: string; code: string; employeeTotal: number; employerTotal: number }> = {};
//     for (const p of payrolls) {
//       const details: any[] = (p as any).customTaxDetails ?? [];
//       for (const t of details) {
//         if (!customMap[t.code]) {
//           customMap[t.code] = { name: t.name, code: t.code, employeeTotal: 0, employerTotal: 0 };
//         }
//         customMap[t.code].employeeTotal += Number(t.employeeAmount ?? 0);
//         customMap[t.code].employerTotal += Number(t.employerAmount ?? 0);
//       }
//     }

//     const totalSalarialDeductions = totalCnssSalarial + totalIts +
//       Object.values(customMap).reduce((s, t) => s + t.employeeTotal, 0);
//     const totalEmployerCharges = totalCnssEmployer + tusTotal +
//       Object.values(customMap).reduce((s, t) => s + t.employerTotal, 0);

//     return {
//       month,
//       year,
//       employeeCount:          payrolls.length,
//       totalGrossSalary,
//       totalCnssSalarial,
//       cnssEmployerPension,
//       cnssEmployerFamily,
//       cnssEmployerAccident,
//       totalCnssEmployer,
//       tusDgiAmount,
//       tusCnssAmount,
//       tusTotal,
//       totalIts,
//       customTaxDetails:       Object.values(customMap),
//       totalSalarialDeductions,
//       totalEmployerCharges,
//       grandTotal:             totalSalarialDeductions + totalEmployerCharges,
//     };
//   }

//   private defaultFreeSettings(fiscalMode: string, forfaitItsRate: number) {
//     return { cnssSalarialRate: 4, cnssEmployerRate: 20.25, cnssCeiling: 1_200_000, workDaysPerMonth: 26, overtimeRate10: 10, overtimeRate25: 25, overtimeRate50: 50, overtimeRate100: 100, fiscalMode, forfaitItsRate };
//   }
// }

// ============================================================================
// 📁 payrolls.service.ts
// ✅ Taxes custom chargées via CompanyTaxService.findActive() dans :
//    - create()
//    - simulatePayroll()
//    - recalculatePayroll()
//    - simulateFree() (taxes vides — pas de company réelle)
// ============================================================================

// import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
// import { PrismaService } from '../prisma/prisma.service';
// import { Prisma } from '@prisma/client';

// import { PayrollCalculatorService } from './services/payroll-calculator.service';
// import { PayrollItemsService } from './services/payroll-items.service';
// import { PayrollSmicProtectionService } from './services/payroll-smic-protection.service';
// import { PayrollDeductionsService } from './services/payroll-deductions.service';
// import { PayrollGeneratorService } from './services/payroll-generator.service';
// import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
// import { PayrollBonusesService } from './services/payroll-bonuses.service';
// import { CompanyTaxService } from '../company-taxes/company-tax.service'; // ✅

// import { LoansService } from '../loans/loans.service';
// import { AttendanceSummaryService } from '../attendance/attendance-summary.service';
// import { PayrollSettingsService } from '../payroll/settings/settings.service';

// import { CreatePayrollDto } from './dto/create-payroll.dto';
// import { UpdatePayrollDto } from './dto/update-payroll.dto';
// import {
//   CompanyNotFoundException, EmployeeNotFoundException,
//   PayrollAlreadyExistsException, PayrollNotFoundException, PayrollAlreadyPaidException
// } from '../exceptions/business.exceptions';

// export interface SimulatePayrollOverrides {
//   baseSalary?:       number;
//   workedDays?:       number;
//   overtimeHours10?:  number;
//   overtimeHours25?:  number;
//   overtimeHours50?:  number;
//   overtimeHours100?: number;
//   manualBonuses?: Array<{ id?: string; bonusType: string; amount: number; isTaxable?: boolean; isCnss?: boolean }>;
// }

// @Injectable()
// export class PayrollsService {
//   private readonly logger = new Logger(PayrollsService.name);

//   constructor(
//     private prisma: PrismaService,
//     private calculator: PayrollCalculatorService,
//     private itemsService: PayrollItemsService,
//     private smicProtection: PayrollSmicProtectionService,
//     private deductionsService: PayrollDeductionsService,
//     private generator: PayrollGeneratorService,
//     private loansService: LoansService,
//     private attendanceSummary: AttendanceSummaryService,
//     private payrollSettingsService: PayrollSettingsService,
//     private subscriptionGuard: SubscriptionGuard,
//     private bonusesService: PayrollBonusesService,
//     private companyTaxService: CompanyTaxService, // ✅
//   ) {}

//   private getMonthNumber(month: string): number {
//     const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
//     const index = months.indexOf(month.toLowerCase());
//     if (index !== -1) return index + 1;
//     const parsed = parseInt(month, 10);
//     return isNaN(parsed) ? new Date().getMonth() + 1 : parsed;
//   }

//   private async shouldEmployeeBePaid(employeeId: string, companyId: string, month: number, year: number) {
//     await this.attendanceSummary.generateAndStoreAllMonthlySummaries(companyId, month, year);
//     const summaries = await this.attendanceSummary.getStoredSummaries(companyId, month, year, [employeeId]);
//     if (summaries.length === 0) return { shouldPay: false, daysToPay: 0, summary: null, reason: 'Aucun pointage enregistré pour ce mois' };
//     const summary = summaries[0];
//     if (summary.daysToPay <= 0) return { shouldPay: false, daysToPay: 0, summary, reason: `Aucun jour travaillé` };
//     return { shouldPay: true, daysToPay: summary.daysToPay, summary };
//   }

//   // ============================================================================
//   // CREATE
//   // ============================================================================
//   async create(createPayrollDto: CreatePayrollDto, userId: string) {
//     const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
//     if (!user?.companyId) throw new CompanyNotFoundException();
//     await this.subscriptionGuard.checkFeatureAccess(user.companyId, 'hasPayrollIndividual');

//     const { employeeId, month, year, overtime10, overtime25, overtime50, overtime100, workedDays } = createPayrollDto as any;
//     const monthNum = this.getMonthNumber(month);

//     const [employee, company] = await Promise.all([
//       this.prisma.employee.findUnique({
//         where: { id: employeeId },
//         select: { id: true, firstName: true, lastName: true, baseSalary: true, maritalStatus: true, numberOfChildren: true, isSubjectToIrpp: true, isSubjectToCnss: true, isSubjectToTus: true, taxExemptionReason: true, tolZone: true, contractType: true, isResident: true }
//       }),
//       this.prisma.company.findUnique({ where: { id: user.companyId }, select: { appliesCnssEmployer: true, cnssEmployerRate: true, isSubjectToTus: true } })
//     ]);

//     if (!employee) throw new EmployeeNotFoundException(employeeId);

//     const existing = await this.prisma.payroll.findFirst({ where: { employeeId, month: monthNum, year, companyId: user.companyId } });
//     if (existing) throw new PayrollAlreadyExistsException(`${employee.firstName} ${employee.lastName}`, monthNum, year);

//     const { shouldPay, daysToPay, summary, reason } = await this.shouldEmployeeBePaid(employeeId, user.companyId, monthNum, year);
//     if (!shouldPay) throw new Error(`❌ Impossible de créer le bulletin : ${reason}`);

//     const [settings, companyTaxes] = await Promise.all([
//       this.payrollSettingsService.getSettingsByCompanyId(user.companyId),
//       this.companyTaxService.findActive(user.companyId), // ✅ Charger les taxes actives
//     ]);

//     const eff10  = (overtime10  != null) ? Number(overtime10)  : Number((summary as any).overtime10Hours  ?? 0);
//     const eff25  = (overtime25  != null) ? Number(overtime25)  : Number((summary as any).overtime25Hours  ?? 0);
//     const eff50  = (overtime50  != null) ? Number(overtime50)  : Number((summary as any)?.overtime50Hours  ?? 0);
//     const eff100 = (overtime100 != null) ? Number(overtime100) : Number((summary as any).overtime100Hours ?? 0);

//     const calculatedBonuses = await this.bonusesService.calculateEmployeeBonuses(employeeId, Number(employee.baseSalary), monthNum, year);
//     const [loans, advances] = await Promise.all([
//       this.deductionsService.getActiveLoans(employeeId),
//       this.deductionsService.getApprovedAdvances(employeeId, monthNum, year)
//     ]);

//     const hasVoluntaryDeductions = loans.length > 0 || advances.length > 0;
//     const protectionMode = this.smicProtection.determineMode(Number(employee.baseSalary), hasVoluntaryDeductions);

//     // ✅ Passer companyTaxes au calculateur
//     const prelimCalc = this.calculator.calculate(
//       Number(employee.baseSalary), eff10, eff25, eff50, eff100,
//       calculatedBonuses, [], settings, daysToPay, settings.workDaysPerMonth, employee, company, companyTaxes
//     );

//     const { adjustedDeductions, loansToUpdate, advancesToDeduct, warnings } =
//       this.smicProtection.handleDeductions(employee, prelimCalc, loans, advances, protectionMode);

//     const calc = this.calculator.calculate(
//       Number(employee.baseSalary), eff10, eff25, eff50, eff100,
//       calculatedBonuses, adjustedDeductions, settings, daysToPay, settings.workDaysPerMonth, employee, company, companyTaxes
//     );

//     warnings.forEach(w => this.logger.warn(w));
//     const absenceDays = Math.max(0, settings.workDaysPerMonth - daysToPay);

//     return this.prisma.$transaction(async (tx) => {
//       const payroll = await tx.payroll.create({
//         data: {
//           employeeId, companyId: user.companyId!,
//           month: monthNum, year,
//           periodStart: new Date(year, monthNum - 1, 1),
//           periodEnd:   new Date(year, monthNum, 0),
//           workDays: settings.workDaysPerMonth,
//           workedDays: daysToPay, absenceDays,
//           daysOnLeave: (summary as any)?.daysOnLeave ?? 0, daysRemote: (summary as any)?.daysRemote ?? 0, daysHoliday: (summary as any)?.daysHoliday ?? 0,
//           overtimeHours10: eff10, overtimeHours25: eff25, overtimeHours50: eff50, overtimeHours100: eff100,
//           baseSalary: Number(employee.baseSalary),
//           adjustedBaseSalary: calc.adjustedBaseSalary,
//           absenceDeduction:   calc.absenceDeduction,
//           overtimeAmount10:   calc.overtimeAmount10,
//           overtimeAmount25:   calc.overtimeAmount25,
//           overtimeAmount50:   calc.overtimeAmount50,
//           overtimeAmount100:  calc.overtimeAmount100,
//           totalOvertimeAmount: calc.totalOvertimeAmount,
//           totalBonuses:       calc.totalBonuses,
//           grossSalary:        calc.grossSalary,
//           netSalary:          calc.netSalary,
//           cnssSalarial:       calc.cnssSalarial,
//           cnssEmployer:       calc.cnssEmployer,
//           its:                calc.its,
//           totalDeductions:    calc.totalDeductions,
//           totalEmployerCost:  calc.totalEmployerCost,
//           irppAbattement:    calc.irppDetails?.abattement    || 0,
//           irppFiscalParts:   calc.irppDetails?.fiscalParts   || 1,
//           irppEffectiveRate: calc.irppDetails?.effectiveRate || 0,
//           cnssEmployerPension:  calc.cnssEmployerPension,
//           cnssEmployerFamily:   calc.cnssEmployerFamily,
//           cnssEmployerAccident: calc.cnssEmployerAccident,
//           tusDgiAmount:  calc.tusDgiAmount,
//           tusCnssAmount: calc.tusCnssAmount,
//           tusTotal:      calc.tusTotal,
//           // ✅ Stocker les totaux taxes custom
//           employeeCustomTaxTotal: calc.employeeCustomTaxTotal,
//           employerCustomTaxTotal: calc.employerCustomTaxTotal,
//           status: 'DRAFT', createdById: userId,
//         } as any
//       });

//       await this.itemsService.create(
//         tx, payroll.id, employee, calc,
//         { ...summary, overtime10Hours: eff10, overtime25Hours: eff25, overtime50Hours: eff50, overtime100Hours: eff100 },
//         loans, advances, settings, calculatedBonuses
//       );

//       for (const loanUpdate of loansToUpdate) {
//         const loan = loans.find(l => l.id === loanUpdate.id);
//         if (loan) {
//           const isPartial = loanUpdate.deduction < Number(loan.monthlyRepayment);
//           await this.deductionsService.updateLoan(tx, loanUpdate.id, loanUpdate.deduction, Number(loan.remainingBalance), monthNum, year, isPartial);
//         }
//       }

//       await this.deductionsService.markAdvancesAsDeducted(tx, advancesToDeduct);
//       return payroll;
//     }, { maxWait: 10000, timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
//   }

//   async generateMonthlyPayrolls(userId: string, month: number, year: number, employeeIds?: string[], customWorkDays?: number) {
//     return this.generator.generate(userId, month, year, employeeIds, customWorkDays);
//   }

//   // ============================================================================
//   // FIND ALL / FIND ONE / UPDATE / REMOVE — inchangés
//   // ============================================================================
//   async findAll(userId: string, employeeId?: string) {
//     const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { companyId: true, role: true, employeeId: true, email: true } });
//     if (!user?.companyId) return [];
//     const whereClause: any = { companyId: user.companyId };
//     if (user.role === 'EMPLOYEE') {
//       if (user.employeeId) { whereClause.employeeId = user.employeeId; }
//       else {
//         const employee = await this.prisma.employee.findFirst({ where: { email: user.email, companyId: user.companyId } });
//         if (!employee) return [];
//         whereClause.employeeId = employee.id;
//       }
//       whereClause.status = 'PAID';
//     } else if (employeeId) { whereClause.employeeId = employeeId; }
//     return this.prisma.payroll.findMany({ where: whereClause, include: { employee: { select: { firstName: true, lastName: true, employeeNumber: true, position: true } } }, orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }] });
//   }

//   async findOne(id: string, userId: string) {
//     const payroll = await this.prisma.payroll.findUnique({ where: { id }, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, position: true, baseSalary: true, maritalStatus: true, numberOfChildren: true, cnssNumber: true, paymentMethod: true, department: { select: { id: true, name: true, code: true } } } }, items: { orderBy: { order: 'asc' } }, company: true } });
//     if (!payroll) throw new PayrollNotFoundException(id);
//     const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, employeeId: true, companyId: true, email: true } });
//     if (!user) throw new ForbiddenException('Utilisateur non trouvé');
//     if (user.companyId !== payroll.companyId) throw new ForbiddenException('Accès refusé');
//     if (user.role === 'EMPLOYEE') {
//       const isOwner = user.employeeId === payroll.employeeId;
//       if (!isOwner) {
//         const emp = await this.prisma.employee.findFirst({ where: { email: user.email, companyId: user.companyId } });
//         if (!emp || emp.id !== payroll.employeeId) throw new ForbiddenException('Accès à vos bulletins uniquement');
//       }
//       if (payroll.status !== 'PAID') throw new ForbiddenException('Bulletin non encore disponible');
//     }
//     return payroll;
//   }

//   async update(id: string, updatePayrollDto: UpdatePayrollDto, userId?: string) {
//     const payroll = await this.prisma.payroll.findUnique({ where: { id } });
//     if (!payroll) throw new PayrollNotFoundException(id);
//     if (payroll.status === 'PAID') throw new PayrollAlreadyPaidException();
//     if (userId) {
//       const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, companyId: true } });
//       if (user?.role === 'EMPLOYEE') throw new ForbiddenException('Modification réservée aux admins/RH');
//       if (user?.companyId !== payroll.companyId) throw new ForbiddenException('Accès refusé');
//     }
//     return this.prisma.payroll.update({ where: { id }, data: { ...updatePayrollDto, updatedAt: new Date() } });
//   }

//   async remove(id: string) {
//     const payroll = await this.prisma.payroll.findUnique({ where: { id } });
//     if (!payroll) throw new PayrollNotFoundException(id);
//     if (payroll.status === 'PAID') throw new PayrollAlreadyPaidException();
//     await this.prisma.payroll.delete({ where: { id } });
//     return { success: true, message: 'Bulletin supprimé avec succès' };
//   }

//   // ============================================================================
//   // RECALCULATE
//   // ============================================================================
//   async recalculatePayroll(id: string, userId: string, overrides?: any) {
//     const payroll = await this.prisma.payroll.findUnique({ where: { id }, include: { employee: true } });
//     if (!payroll) throw new PayrollNotFoundException(id);
//     if (payroll.status === 'PAID') throw new PayrollAlreadyPaidException();
//     const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, companyId: true } });
//     if (user?.role === 'EMPLOYEE') throw new ForbiddenException('Recalcul réservé aux admins/RH');
//     if (user?.companyId !== payroll.companyId) throw new ForbiddenException('Accès refusé');

//     const [employee, company, settings, companyTaxes] = await Promise.all([
//       this.prisma.employee.findUnique({ where: { id: payroll.employeeId }, select: { id: true, firstName: true, lastName: true, baseSalary: true, maritalStatus: true, numberOfChildren: true, isSubjectToIrpp: true, isSubjectToCnss: true, isSubjectToTus: true, taxExemptionReason: true, tolZone: true, contractType: true, isResident: true } }),
//       this.prisma.company.findUnique({ where: { id: payroll.companyId }, select: { appliesCnssEmployer: true, cnssEmployerRate: true, isSubjectToTus: true } }),
//       this.payrollSettingsService.getSettingsByCompanyId(payroll.companyId),
//       this.companyTaxService.findActive(payroll.companyId), // ✅
//     ]);

//     if (!employee) throw new EmployeeNotFoundException(payroll.employeeId);

//     const effectiveBaseSalary = overrides?.baseSalary ?? Number(payroll.baseSalary);
//     const effectiveDays       = overrides?.workedDays ?? Number(payroll.workedDays);
//     const eff10  = overrides?.overtimeHours10  ?? Number((payroll as any).overtimeHours10  || 0);
//     const eff25  = overrides?.overtimeHours25  ?? Number((payroll as any).overtimeHours25  || 0);
//     const eff50  = overrides?.overtimeHours50  ?? Number((payroll as any).overtimeHours50  || 0);
//     const eff100 = overrides?.overtimeHours100 ?? Number((payroll as any).overtimeHours100 || 0);

//     let calculatedBonuses: any[];
//     if (overrides?.manualBonuses && overrides.manualBonuses.length > 0) {
//       calculatedBonuses = overrides.manualBonuses.map((b: any, i: number) => ({ id: `manual-recalc-${i}`, bonusType: b.bonusType, amount: Number(b.amount), isTaxable: b.isTaxable ?? true, isCnss: b.isCnss ?? true, source: 'MANUAL', isRecurring: true }));
//     } else {
//       calculatedBonuses = await this.bonusesService.calculateEmployeeBonuses(payroll.employeeId, effectiveBaseSalary, payroll.month, payroll.year);
//     }

//     const [loans, advances] = await Promise.all([
//       this.deductionsService.getActiveLoans(payroll.employeeId),
//       this.deductionsService.getApprovedAdvances(payroll.employeeId, payroll.month, payroll.year)
//     ]);

//     const protectionMode = this.smicProtection.determineMode(effectiveBaseSalary, loans.length > 0 || advances.length > 0);
//     const prelimCalc = this.calculator.calculate(effectiveBaseSalary, eff10, eff25, eff50, eff100, calculatedBonuses, [], settings, effectiveDays, settings.workDaysPerMonth, employee, company, companyTaxes);
//     const { adjustedDeductions } = this.smicProtection.handleDeductions(employee, prelimCalc, loans, advances, protectionMode);
//     const calc = this.calculator.calculate(effectiveBaseSalary, eff10, eff25, eff50, eff100, calculatedBonuses, adjustedDeductions, settings, effectiveDays, settings.workDaysPerMonth, employee, company, companyTaxes);

//     const updated = await this.prisma.payroll.update({
//       where: { id },
//       data: {
//         baseSalary: effectiveBaseSalary, workedDays: effectiveDays,
//         absenceDays: Math.max(0, settings.workDaysPerMonth - effectiveDays),
//         overtimeHours10: eff10, overtimeHours25: eff25, overtimeHours50: eff50, overtimeHours100: eff100,
//         adjustedBaseSalary: calc.adjustedBaseSalary, absenceDeduction: calc.absenceDeduction,
//         overtimeAmount10: calc.overtimeAmount10, overtimeAmount25: calc.overtimeAmount25,
//         overtimeAmount50: calc.overtimeAmount50, overtimeAmount100: calc.overtimeAmount100,
//         totalOvertimeAmount: calc.totalOvertimeAmount, totalBonuses: calc.totalBonuses,
//         grossSalary: calc.grossSalary, netSalary: calc.netSalary,
//         cnssSalarial: calc.cnssSalarial, cnssEmployer: calc.cnssEmployer, its: calc.its,
//         totalDeductions: calc.totalDeductions, totalEmployerCost: calc.totalEmployerCost,
//         irppAbattement: calc.irppDetails?.abattement || 0, irppFiscalParts: calc.irppDetails?.fiscalParts || 1, irppEffectiveRate: calc.irppDetails?.effectiveRate || 0,
//         cnssEmployerPension: calc.cnssEmployerPension, cnssEmployerFamily: calc.cnssEmployerFamily, cnssEmployerAccident: calc.cnssEmployerAccident,
//         tusDgiAmount: calc.tusDgiAmount, tusCnssAmount: calc.tusCnssAmount, tusTotal: calc.tusTotal,
//         employeeCustomTaxTotal: calc.employeeCustomTaxTotal, // ✅
//         employerCustomTaxTotal: calc.employerCustomTaxTotal, // ✅
//         updatedAt: new Date(),
//       } as any
//     });

//     return { ...updated, recalculated: true, calc };
//   }

//   // ============================================================================
//   // SIMULATE
//   // ============================================================================
//   async simulatePayroll(employeeId: string, month: string | number, year: number, userId: string, overrides?: SimulatePayrollOverrides) {
//     const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
//     if (!user?.companyId) throw new CompanyNotFoundException();

//     const monthNum = typeof month === 'string' ? this.getMonthNumber(month) : month;

//     const [employee, company] = await Promise.all([
//       this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, firstName: true, lastName: true, baseSalary: true, maritalStatus: true, numberOfChildren: true, isSubjectToIrpp: true, isSubjectToCnss: true, isSubjectToTus: true, taxExemptionReason: true, tolZone: true, contractType: true, isResident: true } }),
//       this.prisma.company.findUnique({ where: { id: user.companyId }, select: { appliesCnssEmployer: true, cnssEmployerRate: true, isSubjectToTus: true } })
//     ]);
//     if (!employee) throw new EmployeeNotFoundException(employeeId);

//     const [settings, companyTaxes] = await Promise.all([
//       this.payrollSettingsService.getSettingsByCompanyId(user.companyId),
//       this.companyTaxService.findActive(user.companyId), // ✅
//     ]);

//     let daysToPay = settings.workDaysPerMonth;
//     let att10 = 0, att25 = 0, att50 = 0, att100 = 0;

//     const hasWorkedDaysOverride = overrides?.workedDays != null;
//     const hasOvertimeOverride   = overrides?.overtimeHours10 != null || overrides?.overtimeHours25 != null || overrides?.overtimeHours50 != null || overrides?.overtimeHours100 != null;

//     if (!hasWorkedDaysOverride || !hasOvertimeOverride) {
//       try {
//         await this.attendanceSummary.generateAndStoreAllMonthlySummaries(user.companyId, monthNum, year);
//         const summaries = await this.attendanceSummary.getStoredSummaries(user.companyId, monthNum, year, [employeeId]);
//         if (summaries.length > 0) {
//           const s = summaries[0];
//           if (!hasWorkedDaysOverride && s.daysToPay > 0) daysToPay = s.daysToPay;
//           if (!hasOvertimeOverride) {
//             att10  = Number((s as any).overtime10Hours  ?? 0);
//             att25  = Number((s as any).overtime25Hours  ?? 0);
//             att50  = Number(s.overtime50Hours  ?? 0);
//             att100 = Number((s as any).overtime100Hours ?? 0);
//           }
//         }
//       } catch { this.logger.warn(`⚠️ Pointage indisponible pour ${employeeId}`); }
//     }

//     if (hasWorkedDaysOverride) daysToPay = overrides!.workedDays!;
//     const eff10  = overrides?.overtimeHours10  != null ? overrides.overtimeHours10  : att10;
//     const eff25  = overrides?.overtimeHours25  != null ? overrides.overtimeHours25  : att25;
//     const eff50  = overrides?.overtimeHours50  != null ? overrides.overtimeHours50  : att50;
//     const eff100 = overrides?.overtimeHours100 != null ? overrides.overtimeHours100 : att100;
//     const effectiveBaseSalary = (overrides?.baseSalary != null && overrides.baseSalary > 0) ? overrides.baseSalary : Number(employee.baseSalary);

//     let calculatedBonuses: any[], simulationMode: string;
//     if (overrides?.manualBonuses && overrides.manualBonuses.length > 0) {
//       calculatedBonuses = (overrides!.manualBonuses as any[]).map(b => ({ id: b.id ?? `manual-${Date.now()}`, bonusType: b.bonusType, amount: Number(b.amount), isTaxable: b.isTaxable ?? true, isCnss: b.isCnss ?? true, source: 'MANUAL', isRecurring: true }));
//       simulationMode = 'MANUAL_OVERRIDE';
//     } else {
//       calculatedBonuses = await this.bonusesService.calculateEmployeeBonuses(employeeId, effectiveBaseSalary, monthNum, year);
//       simulationMode = (overrides && Object.keys(overrides).length > 0) ? 'MANUAL_OVERRIDE' : 'FROM_ATTENDANCE';
//     }

//     const [loans, advances] = await Promise.all([
//       this.deductionsService.getActiveLoans(employeeId),
//       this.deductionsService.getApprovedAdvances(employeeId, monthNum, year)
//     ]);

//     const protectionMode = this.smicProtection.determineMode(effectiveBaseSalary, loans.length > 0 || advances.length > 0);
//     const prelimCalc = this.calculator.calculate(effectiveBaseSalary, eff10, eff25, eff50, eff100, calculatedBonuses, [], settings, daysToPay, settings.workDaysPerMonth, employee, company, companyTaxes);
//     const { adjustedDeductions } = this.smicProtection.handleDeductions(employee, prelimCalc, loans, advances, protectionMode);
//     const calc = this.calculator.calculate(effectiveBaseSalary, eff10, eff25, eff50, eff100, calculatedBonuses, adjustedDeductions, settings, daysToPay, settings.workDaysPerMonth, employee, company, companyTaxes);

//     const totalLoanDeduction    = loans.reduce((s, l) => s + Number(l.monthlyRepayment), 0);
//     const totalAdvanceDeduction = advances.reduce((s, a) => s + Number(a.amount), 0);

//     return {
//       employee: { id: employee.id, firstName: employee.firstName, lastName: employee.lastName, baseSalary: Number(employee.baseSalary), effectiveBaseSalary, isSubjectToCnss: employee.isSubjectToCnss, isSubjectToIrpp: employee.isSubjectToIrpp, isSubjectToTus: employee.isSubjectToTus, taxExemptionReason: employee.taxExemptionReason },
//       month: monthNum, year, daysToPay, workDays: settings.workDaysPerMonth,
//       overtime: { hours10: eff10, amount10: calc.overtimeAmount10, hours25: eff25, amount25: calc.overtimeAmount25, hours50: eff50, amount50: calc.overtimeAmount50, hours100: eff100, amount100: calc.overtimeAmount100, total: calc.totalOvertimeAmount },
//       bonuses: calculatedBonuses, totalBonuses: calc.totalBonuses,
//       adjustedBaseSalary: calc.adjustedBaseSalary, absenceDeduction: calc.absenceDeduction,
//       grossSalary: calc.grossSalary, cnssSalarial: calc.cnssSalarial,
//       cnssEmployer: calc.cnssEmployer, cnssEmployerPension: calc.cnssEmployerPension, cnssEmployerFamily: calc.cnssEmployerFamily, cnssEmployerAccident: calc.cnssEmployerAccident,
//       tusDgiAmount: calc.tusDgiAmount, tusCnssAmount: calc.tusCnssAmount, tusTotal: calc.tusTotal,
//       its: calc.its, irppDetails: calc.irppDetails,
//       // ✅ Taxes custom dans la réponse simulation
//       customTaxes:            calc.customTaxDetails,
//       employeeCustomTaxTotal: calc.employeeCustomTaxTotal,
//       employerCustomTaxTotal: calc.employerCustomTaxTotal,
//       loans:    loans.map(l => ({ id: l.id, monthlyRepayment: Number(l.monthlyRepayment), remainingBalance: Number(l.remainingBalance) })),
//       advances: advances.map(a => ({ id: a.id, amount: Number(a.amount), createdAt: a.createdAt })),
//       totalLoanDeduction, totalAdvanceDeduction,
//       totalDeductions: calc.totalDeductions, netSalary: calc.netSalary, totalEmployerCost: calc.totalEmployerCost,
//       settings: { cnssSalarialRate: settings.cnssSalarialRate, cnssEmployerRate: settings.cnssEmployerRate, cnssCeiling: settings.cnssCeiling, overtimeRate10: settings.overtimeRate10 ?? 10, overtimeRate25: settings.overtimeRate25 ?? 25, overtimeRate50: settings.overtimeRate50 ?? 50, overtimeRate100: settings.overtimeRate100 ?? 100 },
//       simulationMode,
//     };
//   }

//   // ============================================================================
//   // SIMULATE BATCH
//   // ============================================================================
//   async simulateBatchPayroll(employeeIds: string[], month: number, year: number, userId: string) {
//     const simulations = await Promise.allSettled(employeeIds.map(id => this.simulatePayroll(id, month, year, userId)));
//     const results = simulations.map((result, index) => {
//       if (result.status === 'fulfilled') return { employeeId: employeeIds[index], success: true, data: result.value };
//       return { employeeId: employeeIds[index], success: false, error: (result.reason as Error).message };
//     });
//     const successful = results.filter(r => r.success).map(r => r.data!);
//     return {
//       results,
//       summary: {
//         count:             successful.length,
//         totalGross:        successful.reduce((s, d: any) => s + d.grossSalary, 0),
//         totalNet:          successful.reduce((s, d: any) => s + d.netSalary, 0),
//         totalEmployerCost: successful.reduce((s, d: any) => s + d.totalEmployerCost, 0),
//         totalCnss:         successful.reduce((s, d: any) => s + d.cnssSalarial, 0),
//         totalIts:          successful.reduce((s, d: any) => s + d.its, 0),
//       }
//     };
//   }

//   // ============================================================================
//   // SIMULATE FREE — pas de company réelle → taxes custom vides
//   // ============================================================================
//   async simulateFree(body: any) {
//     const { firstName = 'Simulation', lastName = 'Libre', baseSalary, maritalStatus = 'SINGLE', numberOfChildren = 0, isSubjectToCnss = true, isSubjectToIrpp = true, fiscalMode = 'ITS_2026', forfaitItsRate = 0.08, month, year, workedDays, overtimeHours10 = 0, overtimeHours25 = 0, overtimeHours50 = 0, overtimeHours100 = 0, manualBonuses = [] } = body;
//     if (!baseSalary || baseSalary < 70400) throw new Error('Salaire de base invalide (minimum SMIG : 70 400 FCFA)');

//     const fakeEmployee = { id: `free-sim-${Date.now()}`, firstName, lastName, baseSalary, maritalStatus, numberOfChildren, isSubjectToCnss, isSubjectToIrpp, isSubjectToTus: true, taxExemptionReason: null };
//     const fakeCompany  = { appliesCnssEmployer: true, cnssEmployerRate: 20.25, isSubjectToTus: true };
//     const settings     = this.defaultFreeSettings(fiscalMode, forfaitItsRate);
//     const daysToPay    = workedDays ?? settings.workDaysPerMonth;

//     const calculatedBonuses = manualBonuses.filter((b: any) => b.bonusType && b.amount > 0).map((b: any, i: number) => ({ id: `free-bonus-${i}`, bonusType: b.bonusType, amount: Number(b.amount), isTaxable: b.isTaxable ?? true, isCnss: b.isCnss ?? true, source: 'MANUAL', isRecurring: true }));

//     // ✅ Simulation libre = pas de company réelle → companyTaxes vide
//     const calc = this.calculator.calculate(baseSalary, overtimeHours10, overtimeHours25, overtimeHours50, overtimeHours100, calculatedBonuses, [], settings, daysToPay, settings.workDaysPerMonth, fakeEmployee, fakeCompany, []);

//     return {
//       employee: { id: fakeEmployee.id, firstName, lastName, baseSalary, effectiveBaseSalary: baseSalary, isSubjectToCnss, isSubjectToIrpp, isSubjectToTus: true, taxExemptionReason: null },
//       month, year, daysToPay, workDays: settings.workDaysPerMonth,
//       overtime: { hours10: overtimeHours10, amount10: calc.overtimeAmount10, hours25: overtimeHours25, amount25: calc.overtimeAmount25, hours50: overtimeHours50, amount50: calc.overtimeAmount50, hours100: overtimeHours100, amount100: calc.overtimeAmount100, total: calc.totalOvertimeAmount },
//       bonuses: calculatedBonuses, totalBonuses: calc.totalBonuses,
//       adjustedBaseSalary: calc.adjustedBaseSalary, absenceDeduction: calc.absenceDeduction,
//       grossSalary: calc.grossSalary, cnssSalarial: calc.cnssSalarial,
//       cnssEmployer: calc.cnssEmployer, cnssEmployerPension: calc.cnssEmployerPension, cnssEmployerFamily: calc.cnssEmployerFamily, cnssEmployerAccident: calc.cnssEmployerAccident,
//       tusDgiAmount: calc.tusDgiAmount, tusCnssAmount: calc.tusCnssAmount, tusTotal: calc.tusTotal,
//       its: calc.its, irppDetails: calc.irppDetails,
//       customTaxes: [], employeeCustomTaxTotal: 0, employerCustomTaxTotal: 0,
//       loans: [], advances: [], totalLoanDeduction: 0, totalAdvanceDeduction: 0,
//       totalDeductions: calc.totalDeductions, netSalary: calc.netSalary, totalEmployerCost: calc.totalEmployerCost,
//       settings: { cnssSalarialRate: settings.cnssSalarialRate, cnssEmployerRate: settings.cnssEmployerRate, fiscalMode, forfaitItsRate },
//       simulationMode: 'FREE_SIMULATION',
//     };
//   }

//   async getAccountingJournal(userId: string, month: number, year: number) {
//     const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
//     if (!user?.companyId) throw new CompanyNotFoundException();
//     await this.subscriptionGuard.checkFeatureAccess(user.companyId, 'hasPayrollAccountingExport');
//     const payrolls = await this.prisma.payroll.findMany({ where: { companyId: user.companyId, month, year }, include: { employee: { select: { employeeNumber: true, firstName: true, lastName: true } } } });
//     const entries: any[] = [];
//     for (const p of payrolls) {
//       const name = `${p.employee.firstName} ${p.employee.lastName}`;
//       const piece = `PAY-${p.employee.employeeNumber}-${month}-${year}`;
//       entries.push(
//         { date: p.periodEnd, journal: 'PAIE', piece, account: '661100', label: `Salaire brut - ${name}`, debit: Number(p.grossSalary), credit: 0 },
//         { date: p.periodEnd, journal: 'PAIE', piece, account: '431100', label: `CNSS salarié - ${name}`, debit: 0, credit: Number(p.cnssSalarial) },
//         { date: p.periodEnd, journal: 'PAIE', piece, account: '447200', label: `ITS/IRPP - ${name}`, debit: 0, credit: Number(p.its) },
//         { date: p.periodEnd, journal: 'PAIE', piece, account: '422100', label: `Rémunération due - ${name}`, debit: 0, credit: Number(p.netSalary) }
//       );
//     }
//     return { month, year, totalEntries: entries.length, entries };
//   }

//   private defaultFreeSettings(fiscalMode: string, forfaitItsRate: number) {
//     return { cnssSalarialRate: 4, cnssEmployerRate: 20.25, cnssCeiling: 1_200_000, workDaysPerMonth: 26, overtimeRate10: 10, overtimeRate25: 25, overtimeRate50: 50, overtimeRate100: 100, fiscalMode, forfaitItsRate };
//   }
// }

import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

import { PayrollCalculatorService } from './services/payroll-calculator.service';
import { PayrollItemsService } from './services/payroll-items.service';
import { PayrollSmicProtectionService } from './services/payroll-smic-protection.service';
import { PayrollDeductionsService } from './services/payroll-deductions.service';
import { PayrollGeneratorService } from './services/payroll-generator.service';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
import { PayrollBonusesService } from './services/payroll-bonuses.service';
import { CompanyTaxService } from '../company-taxes/company-tax.service'; // ✅
import { LeavesService } from '../leaves/leaves.service';
import { LoansService } from '../loans/loans.service';
import { AttendanceSummaryService } from '../attendance/attendance-summary.service';
import { PayrollSettingsService } from '../payroll/settings/settings.service';
import { YtdCheckpointService } from './services/ytd-checkpoint.service';

import { CreatePayrollDto } from './dto/create-payroll.dto';
import { UpdatePayrollDto } from './dto/update-payroll.dto';
import {
  CompanyNotFoundException,
  EmployeeNotFoundException,
  PayrollAlreadyExistsException,
  PayrollNotFoundException,
  PayrollAlreadyPaidException,
} from '../exceptions/business.exceptions';

export interface SimulatePayrollOverrides {
  baseSalary?: number;
  workedDays?: number;
  overtimeHours10?: number;
  overtimeHours25?: number;
  overtimeHours50?: number;
  overtimeHours100?: number;
  manualBonuses?: Array<{
    id?: string;
    bonusType: string;
    amount: number;
    isTaxable?: boolean;
    isCnss?: boolean;
  }>;
}

@Injectable()
export class PayrollsService {
  private readonly logger = new Logger(PayrollsService.name);

  constructor(
    private prisma: PrismaService,
    private calculator: PayrollCalculatorService,
    private itemsService: PayrollItemsService,
    private smicProtection: PayrollSmicProtectionService,
    private deductionsService: PayrollDeductionsService,
    private generator: PayrollGeneratorService,
    private loansService: LoansService,
    private leavesService: LeavesService, // ← ajouter cette ligne
    private attendanceSummary: AttendanceSummaryService,
    private payrollSettingsService: PayrollSettingsService,
    private subscriptionGuard: SubscriptionGuard,
    private bonusesService: PayrollBonusesService,
    private companyTaxService: CompanyTaxService, // ✅
    private ytdCheckpointService: YtdCheckpointService,
  ) {}

  private getMonthNumber(month: string): number {
    const months = [
      'janvier',
      'février',
      'mars',
      'avril',
      'mai',
      'juin',
      'juillet',
      'août',
      'septembre',
      'octobre',
      'novembre',
      'décembre',
    ];
    const index = months.indexOf(month.toLowerCase());
    if (index !== -1) return index + 1;
    const parsed = parseInt(month, 10);
    return isNaN(parsed) ? new Date().getMonth() + 1 : parsed;
  }

  private async shouldEmployeeBePaid(
    employeeId: string,
    companyId: string,
    month: number,
    year: number,
  ) {
    await this.attendanceSummary.generateAndStoreAllMonthlySummaries(
      companyId,
      month,
      year,
    );
    const summaries = await this.attendanceSummary.getStoredSummaries(
      companyId,
      month,
      year,
      [employeeId],
    );
    if (summaries.length === 0)
      return {
        shouldPay: false,
        daysToPay: 0,
        summary: null,
        reason: 'Aucun pointage enregistré pour ce mois',
      };
    const summary = summaries[0];
    if (summary.daysToPay <= 0)
      return {
        shouldPay: false,
        daysToPay: 0,
        summary,
        reason: `Aucun jour travaillé`,
      };
    return { shouldPay: true, daysToPay: summary.daysToPay, summary };
  }

  // ============================================================================
  // ✅ YTD CARRYOVER — point de départ du cumul annuel pour une période donnée
  // ============================================================================
  // Cherche le checkpoint YtdCheckpoint le plus récent dont effectiveDate <= la
  // date du bulletin demandé. S'il en existe un, il prime — c'est lui qui porte
  // le reset post-congé (valeurs à 0, effectif à partir du mois de retour).
  // S'il n'en existe AUCUN (employé jamais parti en congé, ou pas encore migré),
  // on retombe exactement sur l'ancien comportement : ytdCarryOverBrut/Date sur
  // l'Employee, appliqué si son année <= l'année du bulletin, fenêtre = année en cours.
  // ➜ Ne change RIEN pour les bulletins/employés qui marchaient déjà bien.
  private async getYtdWindow(employeeId: string, year: number, month: number) {
    const targetDate = new Date(`${year}-${String(month).padStart(2, '0')}-01`);

    const checkpoint = await this.prisma.ytdCheckpoint.findFirst({
      where: { employeeId, effectiveDate: { lte: targetDate } },
      orderBy: { effectiveDate: 'desc' },
    });

    if (checkpoint) {
      const d = checkpoint.effectiveDate;
      return {
        startYear: d.getFullYear(),
        startMonth: d.getMonth() + 1,
        carryOver: {
          brut: Number(checkpoint.brut),
          netImp: Number(checkpoint.netImp),
          netSalary: Number(checkpoint.netSalary),
          chargesSal: Number(checkpoint.chargesSal),
          chargesPat: Number(checkpoint.chargesPat),
        },
      };
    }

    // ── Fallback legacy — comportement IDENTIQUE à l'ancien code ──────────
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        ytdCarryOverBrut: true,
        ytdCarryOverNetImp: true,
        ytdCarryOverNetSalary: true,
        ytdCarryOverChargesSal: true,
        ytdCarryOverChargesPat: true,
        ytdCarryOverDate: true,
      },
    });
    const coDate = emp?.ytdCarryOverDate;
    const applies = coDate ? new Date(coDate).getFullYear() <= year : false;

    return {
      startYear: year,
      startMonth: 1,
      carryOver: applies
        ? {
            brut: Number(emp?.ytdCarryOverBrut ?? 0),
            netImp: Number(emp?.ytdCarryOverNetImp ?? 0),
            netSalary: Number(emp?.ytdCarryOverNetSalary ?? 0),
            chargesSal: Number(emp?.ytdCarryOverChargesSal ?? 0),
            chargesPat: Number(emp?.ytdCarryOverChargesPat ?? 0),
          }
        : { brut: 0, netImp: 0, netSalary: 0, chargesSal: 0, chargesPat: 0 },
    };
  }

  // Somme les bulletins entre [startYear/startMonth] et [endYear/endMonth] inclus.
  // Gère le passage d'année (utile si un checkpoint de juillet 2026 doit encore
  // s'appliquer à un bulletin de janvier 2027, par ex.).
  private async sumPayrollsInWindow(
    employeeId: string,
    startYear: number,
    startMonth: number,
    endYear: number,
    endMonth: number,
  ) {
    const where: any =
      startYear === endYear
        ? {
            employeeId,
            status: { notIn: ['CANCELLED'] },
            year: startYear,
            month: { gte: startMonth, lte: endMonth },
          }
        : {
            employeeId,
            status: { notIn: ['CANCELLED'] },
            OR: [
              { year: startYear, month: { gte: startMonth } },
              { year: { gt: startYear, lt: endYear } },
              { year: endYear, month: { lte: endMonth } },
            ],
          };

    return this.prisma.payroll.aggregate({
      where,
      _sum: {
        grossSalary: true,
        cnssSalarial: true,
        cnssEmployer: true,
        its: true,
        tusCnssAmount: true,
        workedDays: true,
        totalOvertimeAmount: true,
        baseSalary: true,
        netSalary: true,
      },
    });
  }

  // ============================================================================
  // CREATE
  // ============================================================================
  async create(createPayrollDto: CreatePayrollDto, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true },
    });

    // ✅ FIX BUG 6: CABINET_ADMIN n'a pas de companyId sur son User
    // Il fournit le companyId directement dans le DTO (front l'envoie déjà)
    const isCabinet =
      user?.role === 'CABINET_ADMIN' || user?.role === 'CABINET_GESTIONNAIRE';
    const effectiveCompanyId = isCabinet
      ? (createPayrollDto as any).companyId
      : user?.companyId;

    if (!effectiveCompanyId) throw new CompanyNotFoundException();

    // Vérification abonnement : uniquement pour les entreprises directes (pas cabinet)
    if (!isCabinet) {
      await this.subscriptionGuard.checkFeatureAccess(
        effectiveCompanyId,
        'hasPayrollIndividual',
      );
    }

    const {
      employeeId,
      month,
      year,
      overtime10,
      overtime25,
      overtime50,
      overtime100,
      workedDays,
    } = createPayrollDto as any;
    const monthNum = this.getMonthNumber(month);

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
          contractType: true, // ← détermine CNSS/ITS/TUS/BNC
          isResident: true, // ← taux BNC 10% ou 20%
          hireDate: true, // 🆕 ancienneté auto
        },
      }),
      this.prisma.company.findUnique({
        where: { id: effectiveCompanyId },
        select: {
          appliesCnssEmployer: true,
          cnssEmployerRate: true,
          isSubjectToTus: true,
          seniorityMode: true,
        },
      }),
    ]);

    if (!employee) throw new EmployeeNotFoundException(employeeId);

    // Bloquer la génération de bulletin pour INTERIM (géré par l'agence)
    if ((employee as any).contractType === 'INTERIM') {
      throw new BadRequestException(
        'Les intérimaires sont gérés par leur agence. Aucun bulletin ne peut être généré côté entreprise.',
      );
    }

    const existing = await this.prisma.payroll.findFirst({
      where: {
        employeeId,
        month: monthNum,
        year,
        companyId: effectiveCompanyId,
      },
    });
    if (existing)
      throw new PayrollAlreadyExistsException(
        `${employee.firstName} ${employee.lastName}`,
        monthNum,
        year,
      );

    const { shouldPay, daysToPay, summary, reason } =
      await this.shouldEmployeeBePaid(
        employeeId,
        effectiveCompanyId,
        monthNum,
        year,
      );
    if (!shouldPay)
      throw new Error(`❌ Impossible de créer le bulletin : ${reason}`);

    const [settings, companyTaxes] = await Promise.all([
      this.payrollSettingsService.getSettingsByCompanyId(effectiveCompanyId),
      this.companyTaxService.findActive(effectiveCompanyId), // ✅ Charger les taxes actives
    ]);

    const eff10 =
      overtime10 != null
        ? Number(overtime10)
        : Number((summary as any).overtime10Hours ?? 0);
    const eff25 =
      overtime25 != null
        ? Number(overtime25)
        : Number((summary as any).overtime25Hours ?? 0);
    const eff50 =
      overtime50 != null
        ? Number(overtime50)
        : Number((summary as any)?.overtime50Hours ?? 0);
    const eff100 =
      overtime100 != null
        ? Number(overtime100)
        : Number((summary as any).overtime100Hours ?? 0);

    const seniorityMode = (company as any).seniorityMode ?? 'AUTO';
    const calculatedBonuses =
      await this.bonusesService.calculateEmployeeBonuses(
        employeeId,
        Number(employee.baseSalary),
        monthNum,
        year,
        effectiveCompanyId,
        daysToPay,
        settings.workDaysPerMonth,
        (employee as any).hireDate ?? null,
        seniorityMode,
      );

    // ✅ CORRECTIF ("le trou") : brut de TRAVAIL de ce mois (sans indemnité
    // congé, calculé AVANT de charger leaveImpact) — sert à compléter la
    // moyenne 12 mois quand ce mois est justement celui où l'indemnité doit
    // être payée (son propre bulletin n'existe pas encore en base).
    const prelimCalc = this.calculator.calculate(
      Number(employee.baseSalary),
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

    const [loans, advances, companyDeductions, leaveImpact, leaveBalanceSnap] = await Promise.all([
      this.deductionsService.getActiveLoans(employeeId),
      this.deductionsService.getApprovedAdvances(employeeId, monthNum, year),
      this.deductionsService.getPendingCompanyDeductionsForEmployee(employeeId),
      // ✅ Charger l'impact congé — cohérence avec la génération batch
      this.leavesService
        .getLeaveImpactForPayroll(employeeId, monthNum, year, prelimCalc.grossSalary)
        .catch(() => null),
      // ✅ Snapshot solde congés AU MOMENT de la génération (figé sur le bulletin)
      // — cycle en cours de l'employé, pas l'année calendaire du bulletin
      this.prisma.leaveBalance
        .findFirst({
          where: { employeeId },
          orderBy: { cycleStartDate: 'desc' },
        })
        .catch(() => null),
    ]);

    const leaveIndemnity = leaveImpact?.leaveIndemnity ?? 0;
    const leaveIndemnityBase = leaveImpact?.leaveIndemnityBase ?? leaveIndemnity;
    const leaveIndemnitySeniority = leaveImpact?.leaveIndemnitySeniority ?? 0;
    const leaveAbsenceDeduction = leaveImpact?.absenceDeduction ?? 0;
    const isPaidLeave = leaveImpact?.isPaid ?? false;
    const leaveDays = leaveImpact?.leaveDays ?? 0;
    const leaveLabel = isPaidLeave ? 'Indemnité de congé' : 'Congé sans solde';

    const hasVoluntaryDeductions = loans.length > 0 || advances.length > 0;
    const protectionMode = this.smicProtection.determineMode(
      Number(employee.baseSalary),
      hasVoluntaryDeductions,
    );

    // ℹ️ prelimCalc déjà calculé plus haut (avant l'appel à getLeaveImpactForPayroll)

    const { adjustedDeductions, loansToUpdate, advancesToDeduct, warnings } =
      this.smicProtection.handleDeductions(
        employee,
        prelimCalc,
        loans,
        advances,
        protectionMode,
      );

    // ✅ Retenues diverses (pharmacie, cantine, casse matériel...) — ne passe
    // pas par smicProtection (qui ne connaît que prêts/avances) : le montant
    // mensuel est fixé par le RH/Admin à la création (monthlyDeduction), qui
    // reste seul responsable de la décision finale.
    const { calcEntries: companyDeductionEntries, toApply: companyDeductionsToApply } =
      this.deductionsService.prepareCompanyDeductionsForCalc(companyDeductions);
    const deductionsForCalc = [...adjustedDeductions, ...companyDeductionEntries];

    // ✅ CORRECTIF (câblage) : le calcul final ignorait toujours l'indemnité
    // de congé — elle n'existait qu'en ligne d'affichage sur le bulletin,
    // jamais dans grossSalary/netSalary/its/cnssSalarial réellement stockés.
    // On la transmet maintenant au moteur, qui sait déjà l'intégrer (voir
    // payroll-calculator.service.ts, leaveOptions).
    const calc = this.calculator.calculate(
      Number(employee.baseSalary),
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
      { leaveIndemnity, isPaidLeave },
    );

    warnings.forEach((w) => this.logger.warn(w));
    const absenceDays = Math.max(0, settings.workDaysPerMonth - daysToPay);

    const createdPayroll = await this.prisma.$transaction(
      async (tx) => {
        const payroll = await tx.payroll.create({
          data: {
            employeeId,
            companyId: effectiveCompanyId,
            month: monthNum,
            year,
            periodStart: new Date(year, monthNum - 1, 1),
            periodEnd: new Date(year, monthNum, 0),
            workDays: settings.workDaysPerMonth,
            workedDays: daysToPay,
            absenceDays,
            daysOnLeave: (summary as any)?.daysOnLeave ?? 0,
            daysRemote: (summary as any)?.daysRemote ?? 0,
            daysHoliday: (summary as any)?.daysHoliday ?? 0,
            overtimeHours10: eff10,
            overtimeHours25: eff25,
            overtimeHours50: eff50,
            overtimeHours100: eff100,
            baseSalary: Number(employee.baseSalary),
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
            irppAbattement: calc.irppDetails?.abattement || 0,
            irppFiscalParts: calc.irppDetails?.fiscalParts || 1,
            irppEffectiveRate: calc.irppDetails?.effectiveRate || 0,
            cnssEmployerPension: calc.cnssEmployerPension,
            cnssEmployerFamily: calc.cnssEmployerFamily,
            cnssEmployerAccident: calc.cnssEmployerAccident,
            tusDgiAmount: calc.tusDgiAmount,
            tusCnssAmount: calc.tusCnssAmount,
            tusTotal: calc.tusTotal,
            // ✅ Stocker les totaux taxes custom
            employeeCustomTaxTotal: calc.employeeCustomTaxTotal,
            employerCustomTaxTotal: calc.employerCustomTaxTotal,
            status: 'DRAFT',
            createdById: userId,
          } as any,
        });

        await this.itemsService.create(
          tx,
          payroll.id,
          employee,
          calc,
          {
            ...summary,
            overtime10Hours: eff10,
            overtime25Hours: eff25,
            overtime50Hours: eff50,
            overtime100Hours: eff100,
          },
          loans,
          advances,
          settings,
          calculatedBonuses,
          // ✅ Cohérence avec le batch — congés pris en compte en paie unique aussi.
          // Ne JAMAIS gater sur leaveDays>0 seul : le mois où l'indemnité
          // ANNUAL est payée (mois précédent le départ) n'a souvent aucune
          // absence physique (leaveDays=0) — sinon l'indemnité disparaît
          // du bulletin précisément quand elle est due.
          leaveDays > 0 || leaveIndemnity > 0
            ? {
                leaveIndemnity,
                leaveIndemnityBase,
                leaveIndemnitySeniority,
                absenceDeduction: leaveAbsenceDeduction,
                isPaidLeave,
                leaveDays,
                leaveLabel,
                indemnifiedDays: leaveImpact?.indemnifiedDays,
                indemnifiedSeniorityDays: leaveImpact?.indemnifiedSeniorityDays,
              }
            : undefined,
          // ✅ Snapshot solde congés — figé sur ce bulletin, indépendant des mois suivants
          leaveBalanceSnap
            ? {
                droits: Number(leaveBalanceSnap.annualEntitled),
                pris: Number(leaveBalanceSnap.annualTaken),
                solde: Number(leaveBalanceSnap.annualRemaining),
              }
            : undefined,
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
              monthNum,
              year,
              isPartial,
            );
          }
        }

        await this.deductionsService.markAdvancesAsDeducted(
          tx,
          advancesToDeduct,
          monthNum,
          year,
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
              monthNum,
              year,
            );
          }
        }
        return payroll;
      },
      {
        maxWait: 10000,
        timeout: 30000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );

    // ✅ Même règle que la génération batch (payroll-generator.service.ts) :
    // on ne vide le cumul d'onboarding qu'APRÈS la création réussie du
    // bulletin qui l'a réellement consommé — jamais avant.
    if ((leaveImpact as any)?.shouldClearOpeningCumulative) {
      await this.leavesService.clearOpeningCumulativeAfterUse(employeeId);
    }

    return createdPayroll;
  }

  async generateMonthlyPayrolls(
    userId: string,
    month: number,
    year: number,
    employeeIds?: string[],
    customWorkDays?: number,
    onProgress?: (detail: any) => void,
  ) {
    return this.generator.generate(
      userId,
      month,
      year,
      employeeIds,
      customWorkDays,
      onProgress,
    );
  }

  // ============================================================================
  // FIND ALL — avec filtres companyId / month / year / limit
  // ✅ Remplace l'ancienne méthode findAll
  // ============================================================================
  async findAll(
    userId: string,
    employeeId?: string,
    filters?: {
      companyId?: string;
      month?: number;
      year?: number;
      limit?: number;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true, employeeId: true, email: true },
    });

    // Pour les rôles cabinet, on utilise le companyId passé en filtre
    const isCabinet =
      user?.role === 'CABINET_ADMIN' || user?.role === 'CABINET_GESTIONNAIRE';
    const effectiveCompanyId =
      isCabinet && filters?.companyId ? filters.companyId : user?.companyId;

    if (!effectiveCompanyId) return [];

    const whereClause: any = { companyId: effectiveCompanyId };

    if (user?.role === 'EMPLOYEE') {
      whereClause.employeeId =
        user.employeeId ??
        (
          await this.prisma.employee.findFirst({
            where: { email: user.email, companyId: effectiveCompanyId },
          })
        )?.id;
      if (!whereClause.employeeId) return [];
      whereClause.status = 'PAID';
    } else if (employeeId) {
      whereClause.employeeId = employeeId;
    }

    if (filters?.month) whereClause.month = filters.month;
    if (filters?.year) whereClause.year = filters.year;

    return this.prisma.payroll.findMany({
      where: whereClause,
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeNumber: true,
            position: true,
          },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
      take: filters?.limit ?? 200,
    });
  }

  async findOne(id: string, userId: string) {
    const payroll = await this.prisma.payroll.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            employeeNumber: true,
            position: true,
            baseSalary: true,
            maritalStatus: true,
            numberOfChildren: true,
            cnssNumber: true,
            nationalIdNumber: true,
            paymentMethod: true,
            contractType: true,
            hireDate: true,
            professionalCategory: true,
            echelon: true,
            isSubjectToCnss: true,
            isSubjectToIrpp: true,
            bankName: true,
            bankAccountNumber: true,
            ytdCarryOverBrut: true,
            ytdCarryOverChargesSal: true,
            ytdCarryOverChargesPat: true,
            ytdCarryOverDate: true,
            department: { select: { id: true, name: true, code: true } },
          },
        },
        items: { orderBy: { order: 'asc' } },
        company: true,
      },
    });
    if (!payroll) throw new PayrollNotFoundException(id);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, employeeId: true, companyId: true, email: true },
    });
    if (!user) throw new ForbiddenException('Utilisateur non trouvé');
    if (user.companyId !== payroll.companyId)
      throw new ForbiddenException('Accès refusé');
    if (user.role === 'EMPLOYEE') {
      const isOwner = user.employeeId === payroll.employeeId;
      if (!isOwner) {
        const emp = await this.prisma.employee.findFirst({
          where: { email: user.email, companyId: user.companyId },
        });
        if (!emp || emp.id !== payroll.employeeId)
          throw new ForbiddenException('Accès à vos bulletins uniquement');
      }
      if (payroll.status !== 'PAID')
        throw new ForbiddenException('Bulletin non encore disponible');
    }
    // ── YTD : cumul annuel réel depuis le dernier checkpoint (ou Jan si aucun) ──
    // ✅ Inclut TOUS les statuts (DRAFT inclus) — pas besoin de valider pour afficher
    // ✅ getYtdWindow gère le carryOver historique ET le reset post-congé (YtdCheckpoint)
    const { startYear, startMonth, carryOver } = await this.getYtdWindow(
      payroll.employeeId,
      payroll.year,
      payroll.month,
    );
    const ytdAgg = await this.sumPayrollsInWindow(
      payroll.employeeId,
      startYear,
      startMonth,
      payroll.year,
      payroll.month,
    );

    const carryOverBrut = carryOver.brut;
    const carryOverNetImp = carryOver.netImp;
    const carryOverNetSalary = carryOver.netSalary;
    const carryOverChargesSal = carryOver.chargesSal;
    const carryOverChargesPat = carryOver.chargesPat;
    const applyCarryOver =
      carryOverBrut !== 0 ||
      carryOverNetImp !== 0 ||
      carryOverNetSalary !== 0 ||
      carryOverChargesSal !== 0 ||
      carryOverChargesPat !== 0;

    const ytdGross = Number(ytdAgg._sum.grossSalary ?? 0) + carryOverBrut;
    // ✅ Net imposable = (brut bulletins - CNSS bulletins) + (carryOverNetImp)
    // carryOverNetImp est saisi directement par l'admin — on ne le recalcule pas
    const ytdNetImpos =
      Number(ytdAgg._sum.grossSalary ?? 0) -
      Number(ytdAgg._sum.cnssSalarial ?? 0) +
      carryOverNetImp;

    // ✅ Net à payer = somme nets bulletins + carryOverNetSalary
    const ytdNetSalary =
      Number(ytdAgg._sum.netSalary ?? 0) + carryOverNetSalary;
    const ytdCnssSal =
      Number(ytdAgg._sum.cnssSalarial ?? 0) + carryOverChargesSal;
    const ytdTusCnss = Number(ytdAgg._sum.tusCnssAmount ?? 0);
    const ytdCnssEmp =
      Number(ytdAgg._sum.cnssEmployer ?? 0) + ytdTusCnss + carryOverChargesPat;
    const ytdIts = Number(ytdAgg._sum.its ?? 0);

    // ── Base congé = ytd brut / 12 (méthode 1/12e Congo) ───────────────────
    const baseConge = ytdGross > 0 ? Math.round(ytdGross / 12) : 0;

    // ── Droits congés — SNAPSHOT depuis les PayrollItems (immuable) ──────────
    // ✅ On lit d'abord les items INFO LEAVE_* créés à la génération du bulletin.
    // Ces items sont un snapshot figé au moment de la paie — ils ne changent jamais.
    // Fallback : LeaveBalance live (bulletins générés avant ce fix, sans snapshot).
    const leaveInfoItems = (payroll.items ?? []).filter((i: any) =>
      ['LEAVE_DROITS', 'LEAVE_PRIS', 'LEAVE_SOLDE'].includes(i.code),
    );
    let droitsConge: number;
    let priseConge: number;
    let soldeConge: number;

    if (leaveInfoItems.length > 0) {
      // ✅ Snapshot présent → données figées au moment de la génération
      droitsConge = Number(
        leaveInfoItems.find((i: any) => i.code === 'LEAVE_DROITS')?.amount ?? 0,
      );
      priseConge = Number(
        leaveInfoItems.find((i: any) => i.code === 'LEAVE_PRIS')?.amount ?? 0,
      );
      soldeConge = Number(
        leaveInfoItems.find((i: any) => i.code === 'LEAVE_SOLDE')?.amount ?? 0,
      );
    } else {
      // Fallback : bulletins anciens sans snapshot — on lit le live (peut être inexact)
      const leaveBalance = await this.prisma.leaveBalance.findFirst({
        where: { employeeId: payroll.employeeId },
        orderBy: { cycleStartDate: 'desc' },
      });
      droitsConge = Number(leaveBalance?.annualEntitled ?? 0);
      priseConge = Number(leaveBalance?.annualTaken ?? 0);
      soldeConge = Number(leaveBalance?.annualRemaining ?? 0);
    }

    return {
      ...payroll,
      ytd: {
        grossSalary: ytdGross,
        netImposable: ytdNetImpos,
        netSalaryAnnual: ytdNetSalary,
        cnssSalarial: ytdCnssSal,
        cnssEmployer: ytdCnssEmp,
        its: ytdIts,
        workedDays: Number(ytdAgg._sum.workedDays ?? 0),
        totalOvertimeAmount: Number(ytdAgg._sum.totalOvertimeAmount ?? 0),
        baseSalary: Number(ytdAgg._sum.baseSalary ?? 0),
        netSalary: Number(ytdAgg._sum.netSalary ?? 0),
        // ✅ Base congé calculée automatiquement
        baseConge,
        // ✅ Droits congés — snapshot figé au moment de la génération
        droitsConge,
        priseConge,
        soldeConge,
        // ✅ Info carryOver pour le front
        hasCarryOver: applyCarryOver,
        carryOverDate: new Date(
          `${startYear}-${String(startMonth).padStart(2, '0')}-01`,
        ).toISOString(),
      },
    };
  }

  async update(
    id: string,
    updatePayrollDto: UpdatePayrollDto,
    userId?: string,
  ) {
    const payroll = await this.prisma.payroll.findUnique({ where: { id } });
    if (!payroll) throw new PayrollNotFoundException(id);
    if (payroll.status === 'PAID') throw new PayrollAlreadyPaidException();
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, companyId: true },
      });
      if (user?.role === 'EMPLOYEE')
        throw new ForbiddenException('Modification réservée aux admins/RH');
      if (user?.companyId !== payroll.companyId)
        throw new ForbiddenException('Accès refusé');
    }

    // ✅ Si manualBonuses ou manualDeductions présents → recalcul complet via recalculatePayroll()
    // Ces champs ne vont pas en DB directement — ils servent à recalculer tout le bulletin.
    const hasRecalc =
      (updatePayrollDto as any).manualBonuses != null ||
      (updatePayrollDto as any).manualDeductions != null;

    if (hasRecalc) {
      const overrides = {
        baseSalary: (updatePayrollDto as any).baseSalary,
        workedDays: (updatePayrollDto as any).workedDays,
        overtimeHours10: (updatePayrollDto as any).overtimeHours10,
        overtimeHours25: (updatePayrollDto as any).overtimeHours25,
        overtimeHours50: (updatePayrollDto as any).overtimeHours50,
        overtimeHours100: (updatePayrollDto as any).overtimeHours100,
        manualBonuses: (updatePayrollDto as any).manualBonuses ?? [],
        manualDeductions: (updatePayrollDto as any).manualDeductions ?? [],
        congesDroits: (updatePayrollDto as any).congesDroits,
        congesPris: (updatePayrollDto as any).congesPris,
        congesSolde: (updatePayrollDto as any).congesSolde,
        joursCongesPris: (updatePayrollDto as any).joursCongesPris,
        cumulBrutOverride: (updatePayrollDto as any).cumulBrutOverride,
      };
      return this.recalculatePayroll(id, userId!, overrides);
    }

    // Sinon → mise à jour simple des champs workflow (status, notes, paymentReference…)
    const {
      manualBonuses,
      manualDeductions,
      month,
      year,
      congesDroits,
      congesPris,
      congesSolde,
      joursCongesPris,
      ...dbFields
    } = updatePayrollDto as any;
    return this.prisma.payroll.update({
      where: { id },
      data: { ...dbFields, updatedAt: new Date() },
    });
  }

  async remove(id: string) {
    const payroll = await this.prisma.payroll.findUnique({ where: { id } });
    if (!payroll) throw new PayrollNotFoundException(id);
    if (payroll.status === 'PAID') throw new PayrollAlreadyPaidException();
    await this.prisma.payroll.delete({ where: { id } });
    return { success: true, message: 'Bulletin supprimé avec succès' };
  }

  // ============================================================================
  // RECALCULATE
  // ============================================================================
  async recalculatePayroll(id: string, userId: string, overrides?: any) {
    const payroll = await this.prisma.payroll.findUnique({
      where: { id },
      include: { employee: true },
    });
    if (!payroll) throw new PayrollNotFoundException(id);
    if (payroll.status === 'PAID') throw new PayrollAlreadyPaidException();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, companyId: true },
    });
    if (user?.role === 'EMPLOYEE')
      throw new ForbiddenException('Recalcul réservé aux admins/RH');
    if (user?.companyId !== payroll.companyId)
      throw new ForbiddenException('Accès refusé');

    const [employee, company, settings, companyTaxes] = await Promise.all([
      this.prisma.employee.findUnique({
        where: { id: payroll.employeeId },
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
      }), // 🆕 hireDate
      this.prisma.company.findUnique({
        where: { id: payroll.companyId },
        select: {
          appliesCnssEmployer: true,
          cnssEmployerRate: true,
          isSubjectToTus: true,
          seniorityMode: true,
        },
      }), // 🆕 seniorityMode
      this.payrollSettingsService.getSettingsByCompanyId(payroll.companyId),
      this.companyTaxService.findActive(payroll.companyId), // ✅
    ]);

    if (!employee) throw new EmployeeNotFoundException(payroll.employeeId);

    const effectiveBaseSalary =
      overrides?.baseSalary ?? Number(payroll.baseSalary);
    const effectiveDays = overrides?.workedDays ?? Number(payroll.workedDays);
    const eff10 =
      overrides?.overtimeHours10 ??
      Number((payroll as any).overtimeHours10 || 0);
    const eff25 =
      overrides?.overtimeHours25 ??
      Number((payroll as any).overtimeHours25 || 0);
    const eff50 =
      overrides?.overtimeHours50 ??
      Number((payroll as any).overtimeHours50 || 0);
    const eff100 =
      overrides?.overtimeHours100 ??
      Number((payroll as any).overtimeHours100 || 0);

    let calculatedBonuses: any[];
    if (overrides?.manualBonuses && overrides.manualBonuses.length > 0) {
      // ✅ Primes depuis la page modifier — base et rate transmis pour affichage bulletin
      calculatedBonuses = overrides.manualBonuses.map((b: any, i: number) => ({
        id: `manual-recalc-${i}`,
        bonusType: b.bonusType,
        amount: Number(b.amount),
        base: b.base != null ? Number(b.base) : null,
        rate: b.rate != null ? Number(b.rate) : null,
        isTaxable: b.isTaxable ?? true,
        isCnss: b.isCnss ?? true,
        fiscalType:
          b.fiscalType ?? (b.isTaxable ? 'TAXABLE_CNSS' : 'NON_TAXABLE'),
        source: 'MANUAL',
        isRecurring: true,
      }));
    } else {
      const seniorityModeR = (company as any).seniorityMode ?? 'AUTO';
      calculatedBonuses = await this.bonusesService.calculateEmployeeBonuses(
        payroll.employeeId,
        effectiveBaseSalary,
        payroll.month,
        payroll.year,
        payroll.companyId,
        effectiveDays,
        settings.workDaysPerMonth,
        (employee as any).hireDate ?? null,
        seniorityModeR,
      );
    }

    // ✅ Retenues libres depuis la page modifier
    const manualDeductionTotal = (overrides?.manualDeductions ?? []).reduce(
      (s: number, d: any) => s + (Number(d.amount) || 0),
      0,
    );

    // ✅ FIX : "modifier ≠ rembourser" — même principe que pour les
    // retenues diverses (getAppliedCompanyDeductionsForEmployee). On ne
    // relit plus les prêts/avances "actifs/approuvés" (getActiveLoans /
    // getApprovedAdvances), qui reflètent l'état ACTUEL et non celui du
    // mois édité :
    //  - un prêt soldé entre-temps n'est plus ACTIVE → sa ligne
    //    disparaîtrait entièrement du bulletin réédité
    //  - une avance, dès sa première déduction, passe à DEDUCTED (jamais
    //    plus APPROVED) → sa ligne disparaîtrait à CHAQUE réédition
    //  - même quand l'entité existe encore, son solde a pu bouger
    //    (paies suivantes, remboursement cash), donc handleDeductions()
    //    recalculerait un nouveau montant au lieu de rejouer celui déjà
    //    prélevé ce mois-là
    // On relit donc directement LoanRepaymentLog / AdvanceRepaymentLog
    // (méthode PAYROLL) pour CE mois précis, sans jamais rappeler
    // smicProtection.handleDeductions() (logique de génération, pas
    // d'édition) ni ré-décrémenter quoi que ce soit.
    const [loanDeductionsApplied, advanceDeductionsApplied, companyDeductionsToApply] =
      await Promise.all([
        this.deductionsService.getAppliedLoanDeductionsForEmployee(
          payroll.employeeId,
          payroll.month,
          payroll.year,
        ),
        this.deductionsService.getAppliedAdvanceDeductionsForEmployee(
          payroll.employeeId,
          payroll.month,
          payroll.year,
        ),
        this.deductionsService.getAppliedCompanyDeductionsForEmployee(
          payroll.employeeId,
          payroll.month,
          payroll.year,
        ),
      ]);

    // Objets minimalistes pour itemsService.create — seul `_deduction`
    // compte pour l'affichage de la ligne (voir payroll-items.service.ts,
    // sections "Prêts"/"Avances" : `loan._deduction ?? loan.monthlyRepayment`
    // / `adv._deduction ?? adv.amount`).
    const loans = loanDeductionsApplied.map((e) => ({
      id: e.id,
      _deduction: e.amount,
      monthlyRepayment: e.amount,
    }));
    const advances = advanceDeductionsApplied.map((e) => ({
      id: e.id,
      _deduction: e.amount,
      amount: e.amount,
    }));

    const adjustedDeductions = [
      ...loanDeductionsApplied.map((e) => ({
        amount: e.amount,
        label: 'Remboursement prêt',
        type: 'LOAN',
      })),
      ...advanceDeductionsApplied.map((e) => ({
        amount: e.amount,
        label: 'Récupération avance',
        type: 'ADVANCE',
      })),
    ];
    const companyDeductionEntries = companyDeductionsToApply.map((e) => ({
      amount: e.amount,
      label: e.label,
      type: 'COMPANY_DEDUCTION',
    }));
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
      effectiveDays,
      settings.workDaysPerMonth,
      employee,
      company,
      companyTaxes,
    );

    return this.prisma.$transaction(
      async (tx) => {
        // ✅ Mettre à jour le bulletin avec les nouvelles valeurs calculées
        const updated = await tx.payroll.update({
          where: { id },
          data: {
            baseSalary: effectiveBaseSalary,
            workedDays: effectiveDays,
            absenceDays: Math.max(0, settings.workDaysPerMonth - effectiveDays),
            overtimeHours10: eff10,
            overtimeHours25: eff25,
            overtimeHours50: eff50,
            overtimeHours100: eff100,
            adjustedBaseSalary: calc.adjustedBaseSalary,
            absenceDeduction: calc.absenceDeduction,
            overtimeAmount10: calc.overtimeAmount10,
            overtimeAmount25: calc.overtimeAmount25,
            overtimeAmount50: calc.overtimeAmount50,
            overtimeAmount100: calc.overtimeAmount100,
            totalOvertimeAmount: calc.totalOvertimeAmount,
            totalBonuses: calc.totalBonuses,
            grossSalary: calc.grossSalary,
            netSalary: calc.netSalary - manualDeductionTotal,
            cnssSalarial: calc.cnssSalarial,
            cnssEmployer: calc.cnssEmployer,
            its: calc.its,
            totalDeductions: calc.totalDeductions + manualDeductionTotal,
            totalEmployerCost: calc.totalEmployerCost,
            irppAbattement: calc.irppDetails?.abattement || 0,
            irppFiscalParts: calc.irppDetails?.fiscalParts || 1,
            irppEffectiveRate: calc.irppDetails?.effectiveRate || 0,
            cnssEmployerPension: calc.cnssEmployerPension,
            cnssEmployerFamily: calc.cnssEmployerFamily,
            cnssEmployerAccident: calc.cnssEmployerAccident,
            tusDgiAmount: calc.tusDgiAmount,
            tusCnssAmount: calc.tusCnssAmount,
            tusTotal: calc.tusTotal,
            employeeCustomTaxTotal: calc.employeeCustomTaxTotal,
            employerCustomTaxTotal: calc.employerCustomTaxTotal,
            updatedAt: new Date(),
          } as any,
        });

        // ✅ Regénérer les items — supprimer les anciens et recréer
        await tx.payrollItem.deleteMany({ where: { payrollId: id } });

        const fakeSummary = {
          daysToPay: effectiveDays,
          overtime10Hours: eff10,
          overtime25Hours: eff25,
          overtime50Hours: eff50,
          overtime100Hours: eff100,
          daysOnLeave: 0,
          daysRemote: 0,
          daysHoliday: 0,
        };

        const lbSnap = await tx.leaveBalance
          .findFirst({
            where: { employeeId: payroll.employeeId },
            orderBy: { cycleStartDate: 'desc' },
          })
          .catch(() => null);
        const leaveSnapshot = {
          droits:
            overrides?.congesDroits ?? Number(lbSnap?.annualEntitled ?? 0),
          pris: overrides?.congesPris ?? Number(lbSnap?.annualTaken ?? 0),
          solde: overrides?.congesSolde ?? Number(lbSnap?.annualRemaining ?? 0),
        };

        const employeeForItems = {
          ...employee,
          baseSalary: effectiveBaseSalary,
        };
        await this.itemsService.create(
          tx,
          id,
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

        // ✅ Retenues libres → items DEDUCTION
        if (overrides?.manualDeductions?.length > 0) {
          for (const ded of overrides.manualDeductions.filter(
            (d: any) => Number(d.amount) > 0,
          )) {
            await tx.payrollItem.create({
              data: {
                payrollId: id,
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
        }

        // ✅ Congés — mettre à jour LeaveBalance si saisi
        if (overrides?.congesDroits != null || overrides?.congesPris != null) {
          const droits = overrides?.congesDroits ?? 0;
          const pris = overrides?.congesPris ?? 0;
          const solde = overrides?.congesSolde ?? droits - pris;

          // ✅ Résoudre le cycle en cours de l'employé (dans la même transaction)
          // plutôt que l'année calendaire du bulletin — c'est le cycle qui fait foi.
          const empForCycle = await tx.employee.findUnique({
            where: { id: payroll.employeeId },
            select: { hireDate: true, leaveCycleStartDate: true },
          });
          const cycleStartDate = new Date(
            empForCycle!.leaveCycleStartDate ?? empForCycle!.hireDate,
          );
          const cycleEndDate = new Date(cycleStartDate);
          cycleEndDate.setMonth(cycleEndDate.getMonth() + 12);
          const cyclesCount = await tx.leaveBalance.count({
            where: { employeeId: payroll.employeeId },
          });

          await tx.leaveBalance.upsert({
            where: {
              employeeId_cycleStartDate: {
                employeeId: payroll.employeeId,
                cycleStartDate,
              },
            },
            create: {
              employeeId: payroll.employeeId,
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
        }

        // ✅ Réconcilie le YtdCheckpoint — pose-le si le bulletin (après
        // édition) contient une prime congé, le retire s'il en existait un
        // orphelin d'une version précédente qui n'a plus de congé.
        const hasCongesPaies = calculatedBonuses.some((b: any) =>
          /cong[eé]/i.test(b.bonusType ?? ''),
        );
        await this.ytdCheckpointService.reconcile(
          tx,
          payroll.employeeId,
          payroll.month,
          payroll.year,
          hasCongesPaies,
        );

        // ✅ Correction manuelle du cumul brut (page "Modifier") — pose un
        // checkpoint daté du MOIS MÊME du bulletin (pas M+1, contrairement au
        // reset post-congé) : le cumul de CE bulletin devient exactement
        // cumulBrutOverride, sans toucher aux bulletins précédents. Net
        // imposable / charges sal / charges pat de la part "carry" sont
        // dérivés proportionnellement aux taux de CE bulletin recalculé —
        // seul le brut est saisi à la main.
        if (overrides?.cumulBrutOverride != null) {
          const ownGross = Number(calc.grossSalary);
          const brutCarry = Number(overrides.cumulBrutOverride) - ownGross;
          const ratioCnssSal =
            ownGross > 0 ? Number(calc.cnssSalarial) / ownGross : 0;
          const ratioChargesPat =
            ownGross > 0
              ? (Number(calc.cnssEmployer) +
                  Number(calc.tusCnssAmount ?? 0) +
                  Number(calc.tusDgiAmount ?? 0)) /
                ownGross
              : 0;
          const netImpCarry = brutCarry - brutCarry * ratioCnssSal;
          const chargesSalCarry = brutCarry * ratioCnssSal;
          const chargesPatCarry = brutCarry * ratioChargesPat;

          const ownEffectiveDate = new Date(
            payroll.year,
            payroll.month - 1,
            1,
          );
          await tx.ytdCheckpoint.deleteMany({
            where: {
              employeeId: payroll.employeeId,
              effectiveDate: ownEffectiveDate,
            },
          });
          await tx.ytdCheckpoint.create({
            data: {
              employeeId: payroll.employeeId,
              effectiveDate: ownEffectiveDate,
              brut: brutCarry,
              netImp: netImpCarry,
              // ⚠️ Approximation — netSalary carry non affiné, reprend netImpCarry.
              // Ajuste ici si tu veux un net à payer cumulé précis.
              netSalary: netImpCarry,
              chargesSal: chargesSalCarry,
              chargesPat: chargesPatCarry,
            },
          });
          this.logger.log(
            `✅ Cumul brut corrigé manuellement → ${overrides.cumulBrutOverride} F ` +
              `(carry: ${brutCarry} F) pour bulletin ${payroll.month}/${payroll.year} (${payroll.employeeId})`,
          );
        }

        // ✅ Cumul annuel frais — recalculé APRÈS la réconciliation ci-dessus,
        // pour que la page "Modifier" affiche immédiatement le bon cumul
        // plutôt qu'une valeur figée depuis le chargement initial.
        // ⚠️ On repasse par `tx` (pas this.prisma / getYtdWindow) pour voir
        // les valeurs du bulletin qu'on vient tout juste de mettre à jour
        // ci-dessus, encore non commitées hors de cette transaction.
        const checkpointTx = await tx.ytdCheckpoint.findFirst({
          where: {
            employeeId: payroll.employeeId,
            effectiveDate: {
              lte: new Date(payroll.year, payroll.month - 1, 1),
            },
          },
          orderBy: { effectiveDate: 'desc' },
        });
        const empCarry = checkpointTx
          ? null
          : await tx.employee.findUnique({
              where: { id: payroll.employeeId },
              select: {
                ytdCarryOverBrut: true,
                ytdCarryOverNetImp: true,
                ytdCarryOverChargesSal: true,
                ytdCarryOverChargesPat: true,
                ytdCarryOverDate: true,
              },
            });
        const startYear = checkpointTx
          ? checkpointTx.effectiveDate.getFullYear()
          : payroll.year;
        const startMonth = checkpointTx
          ? checkpointTx.effectiveDate.getMonth() + 1
          : 1;
        const carryOverApplies =
          !checkpointTx &&
          empCarry?.ytdCarryOverDate &&
          new Date(empCarry.ytdCarryOverDate).getFullYear() <= payroll.year;
        const carryOver = checkpointTx
          ? {
              brut: Number(checkpointTx.brut),
              netImp: Number(checkpointTx.netImp),
              chargesSal: Number(checkpointTx.chargesSal),
              chargesPat: Number(checkpointTx.chargesPat),
            }
          : carryOverApplies
            ? {
                brut: Number(empCarry?.ytdCarryOverBrut ?? 0),
                netImp: Number(empCarry?.ytdCarryOverNetImp ?? 0),
                chargesSal: Number(empCarry?.ytdCarryOverChargesSal ?? 0),
                chargesPat: Number(empCarry?.ytdCarryOverChargesPat ?? 0),
              }
            : { brut: 0, netImp: 0, chargesSal: 0, chargesPat: 0 };

        const ytdWhere: Prisma.PayrollWhereInput =
          startYear === payroll.year
            ? {
                employeeId: payroll.employeeId,
                status: { notIn: ['CANCELLED'] },
                year: payroll.year,
                month: { gte: startMonth, lte: payroll.month },
              }
            : {
                employeeId: payroll.employeeId,
                status: { notIn: ['CANCELLED'] },
                OR: [
                  { year: startYear, month: { gte: startMonth } },
                  { year: { gt: startYear, lt: payroll.year } },
                  { year: payroll.year, month: { lte: payroll.month } },
                ],
              };
        const ytdAgg = await tx.payroll.aggregate({
          where: ytdWhere,
          _sum: {
            grossSalary: true,
            cnssSalarial: true,
            cnssEmployer: true,
            tusCnssAmount: true,
          },
        });
        const ytdGross = Number(ytdAgg._sum?.grossSalary ?? 0) + carryOver.brut;
        const ytdNetImpos =
          Number(ytdAgg._sum?.grossSalary ?? 0) -
          Number(ytdAgg._sum?.cnssSalarial ?? 0) +
          carryOver.netImp;
        const ytdChargesSal =
          Number(ytdAgg._sum?.cnssSalarial ?? 0) + carryOver.chargesSal;
        const ytdChargesPat =
          Number(ytdAgg._sum?.cnssEmployer ?? 0) +
          Number(ytdAgg._sum?.tusCnssAmount ?? 0) +
          carryOver.chargesPat;

        return {
          ...updated,
          recalculated: true,
          calc,
          ytd: {
            grossSalary: ytdGross,
            netImposable: ytdNetImpos,
            chargesSal: ytdChargesSal,
            chargesPat: ytdChargesPat,
          },
        };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  // ============================================================================
  // SIMULATE
  // ============================================================================
  async simulatePayroll(
    employeeId: string,
    month: string | number,
    year: number,
    userId: string,
    overrides?: SimulatePayrollOverrides,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new CompanyNotFoundException();

    const monthNum =
      typeof month === 'string' ? this.getMonthNumber(month) : month;

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
        },
      }),
      this.prisma.company.findUnique({
        where: { id: user.companyId },
        select: {
          appliesCnssEmployer: true,
          cnssEmployerRate: true,
          isSubjectToTus: true,
        },
      }),
    ]);
    if (!employee) throw new EmployeeNotFoundException(employeeId);

    const [settings, companyTaxes] = await Promise.all([
      this.payrollSettingsService.getSettingsByCompanyId(user.companyId),
      this.companyTaxService.findActive(user.companyId), // ✅
    ]);

    let daysToPay = settings.workDaysPerMonth;
    let att10 = 0,
      att25 = 0,
      att50 = 0,
      att100 = 0;

    const hasWorkedDaysOverride = overrides?.workedDays != null;
    const hasOvertimeOverride =
      overrides?.overtimeHours10 != null ||
      overrides?.overtimeHours25 != null ||
      overrides?.overtimeHours50 != null ||
      overrides?.overtimeHours100 != null;

    if (!hasWorkedDaysOverride || !hasOvertimeOverride) {
      try {
        await this.attendanceSummary.generateAndStoreAllMonthlySummaries(
          user.companyId,
          monthNum,
          year,
        );
        const summaries = await this.attendanceSummary.getStoredSummaries(
          user.companyId,
          monthNum,
          year,
          [employeeId],
        );
        if (summaries.length > 0) {
          const s = summaries[0];
          if (!hasWorkedDaysOverride && s.daysToPay > 0)
            daysToPay = s.daysToPay;
          if (!hasOvertimeOverride) {
            att10 = Number((s as any).overtime10Hours ?? 0);
            att25 = Number((s as any).overtime25Hours ?? 0);
            att50 = Number(s.overtime50Hours ?? 0);
            att100 = Number((s as any).overtime100Hours ?? 0);
          }
        }
      } catch {
        this.logger.warn(`⚠️ Pointage indisponible pour ${employeeId}`);
      }
    }

    if (hasWorkedDaysOverride) daysToPay = overrides.workedDays!;
    const eff10 =
      overrides?.overtimeHours10 != null ? overrides.overtimeHours10 : att10;
    const eff25 =
      overrides?.overtimeHours25 != null ? overrides.overtimeHours25 : att25;
    const eff50 =
      overrides?.overtimeHours50 != null ? overrides.overtimeHours50 : att50;
    const eff100 =
      overrides?.overtimeHours100 != null ? overrides.overtimeHours100 : att100;
    const effectiveBaseSalary =
      overrides?.baseSalary != null && overrides.baseSalary > 0
        ? overrides.baseSalary
        : Number(employee.baseSalary);

    let calculatedBonuses: any[], simulationMode: string;
    if (overrides?.manualBonuses && overrides.manualBonuses.length > 0) {
      calculatedBonuses = (overrides.manualBonuses as any[]).map((b) => ({
        id: b.id ?? `manual-${Date.now()}`,
        bonusType: b.bonusType,
        amount: Number(b.amount),
        isTaxable: b.isTaxable ?? true,
        isCnss: b.isCnss ?? true,
        source: 'MANUAL',
        isRecurring: true,
      }));
      simulationMode = 'MANUAL_OVERRIDE';
    } else {
      const seniorityModeS = (company as any).seniorityMode ?? 'AUTO';
      calculatedBonuses = await this.bonusesService.calculateEmployeeBonuses(
        employeeId,
        effectiveBaseSalary,
        monthNum,
        year,
        user.companyId,
        daysToPay,
        settings.workDaysPerMonth,
        (employee as any).hireDate ?? null,
        seniorityModeS,
      );
      simulationMode =
        overrides && Object.keys(overrides).length > 0
          ? 'MANUAL_OVERRIDE'
          : 'FROM_ATTENDANCE';
    }

    // ✅ CORRECTIF ("le trou") : brut de travail (sans indemnité) calculé
    // AVANT le chargement de leaveImpact, pour compléter le 12e mois s'il
    // manque (même logique que la génération réelle).
    const prelimCalcForLeave = this.calculator.calculate(
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

    const [loans, advances, leaveImpact] = await Promise.all([
      this.deductionsService.getActiveLoans(employeeId),
      this.deductionsService.getApprovedAdvances(employeeId, monthNum, year),
      // ✅ Charger l'impact congé — cohérence avec la génération batch
      this.leavesService
        .getLeaveImpactForPayroll(employeeId, monthNum, year, prelimCalcForLeave.grossSalary)
        .catch(() => null),
    ]);

    const leaveIndemnity = leaveImpact?.leaveIndemnity ?? 0;
    const leaveAbsenceDeduction = leaveImpact?.absenceDeduction ?? 0;
    const isPaidLeave = leaveImpact?.isPaid ?? false;
    const leaveDays = leaveImpact?.leaveDays ?? 0;
    const leaveLabel = isPaidLeave ? 'Indemnité de congé' : 'Congé sans solde';

    // ✅ Base congé = brut annuel M-1 / 12 (méthode 1/12e Congo)
    // getYtdWindow gère le carryOver historique ET le reset post-congé (YtdCheckpoint)
    const prevMonth = monthNum === 1 ? 12 : monthNum - 1;
    const prevYear = monthNum === 1 ? year - 1 : year;
    const { startYear, startMonth, carryOver } = await this.getYtdWindow(
      employeeId,
      prevYear,
      prevMonth,
    );
    const ytdPrevAgg = await this.sumPayrollsInWindow(
      employeeId,
      startYear,
      startMonth,
      prevYear,
      prevMonth,
    );
    const ytdPrevGross =
      Number(ytdPrevAgg._sum.grossSalary ?? 0) + carryOver.brut;
    const baseConge = ytdPrevGross > 0 ? Math.round(ytdPrevGross / 12) : 0;

    const protectionMode = this.smicProtection.determineMode(
      effectiveBaseSalary,
      loans.length > 0 || advances.length > 0,
    );
    // ℹ️ Réutilise prelimCalcForLeave (identique — mêmes arguments) plutôt
    // que de refaire le même calcul une 2e fois.
    const prelimCalc = prelimCalcForLeave;
    const { adjustedDeductions } = this.smicProtection.handleDeductions(
      employee,
      prelimCalc,
      loans,
      advances,
      protectionMode,
    );
    // ✅ CORRECTIF (câblage) : transmet l'indemnité au moteur de calcul —
    // sinon jamais incluse dans grossSalary/netSalary/its/cnssSalarial.
    const calc = this.calculator.calculate(
      effectiveBaseSalary,
      eff10,
      eff25,
      eff50,
      eff100,
      calculatedBonuses,
      adjustedDeductions,
      settings,
      daysToPay,
      settings.workDaysPerMonth,
      employee,
      company,
      companyTaxes,
      { leaveIndemnity, isPaidLeave },
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
      month: monthNum,
      year,
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
      // ✅ Taxes custom dans la réponse simulation
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
      totalDeductions: calc.totalDeductions,
      netSalary: calc.netSalary,
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
      simulationMode,
      // ✅ Base congé = brut annuel M-1 / 12 (méthode 1/12e Congo)
      ytd: { baseConge, grossSalary: ytdPrevGross },
    };
  }

  // ============================================================================
  // SIMULATE BATCH
  // ============================================================================
  async simulateBatchPayroll(
    employeeIds: string[],
    month: number,
    year: number,
    userId: string,
  ) {
    const simulations = await Promise.allSettled(
      employeeIds.map((id) => this.simulatePayroll(id, month, year, userId)),
    );
    const results = simulations.map((result, index) => {
      if (result.status === 'fulfilled')
        return {
          employeeId: employeeIds[index],
          success: true,
          data: result.value,
        };
      return {
        employeeId: employeeIds[index],
        success: false,
        error: (result.reason as Error).message,
      };
    });
    const successful = results.filter((r) => r.success).map((r) => r.data!);
    return {
      results,
      summary: {
        count: successful.length,
        totalGross: successful.reduce((s, d: any) => s + d.grossSalary, 0),
        totalNet: successful.reduce((s, d: any) => s + d.netSalary, 0),
        totalEmployerCost: successful.reduce(
          (s, d: any) => s + d.totalEmployerCost,
          0,
        ),
        totalCnss: successful.reduce((s, d: any) => s + d.cnssSalarial, 0),
        totalIts: successful.reduce((s, d: any) => s + d.its, 0),
      },
    };
  }

  // ============================================================================
  // SIMULATE FREE — pas de company réelle → taxes custom vides
  // ============================================================================
  async simulateFree(body: any) {
    const {
      firstName = 'Simulation',
      lastName = 'Libre',
      baseSalary,
      maritalStatus = 'SINGLE',
      numberOfChildren = 0,
      isSubjectToCnss = true,
      isSubjectToIrpp = true,
      fiscalMode = 'ITS_2026',
      forfaitItsRate = 0.08,
      month,
      year,
      workedDays,
      overtimeHours10 = 0,
      overtimeHours25 = 0,
      overtimeHours50 = 0,
      overtimeHours100 = 0,
      manualBonuses = [],
    } = body;
    if (!baseSalary || baseSalary < 70400)
      throw new Error('Salaire de base invalide (minimum SMIG : 70 400 FCFA)');

    const fakeEmployee = {
      id: `free-sim-${Date.now()}`,
      firstName,
      lastName,
      baseSalary,
      maritalStatus,
      numberOfChildren,
      isSubjectToCnss,
      isSubjectToIrpp,
      isSubjectToTus: true,
      taxExemptionReason: null,
    };
    const fakeCompany = {
      appliesCnssEmployer: true,
      cnssEmployerRate: 20.25,
      isSubjectToTus: true,
    };
    const settings = this.defaultFreeSettings(fiscalMode, forfaitItsRate);
    const daysToPay = workedDays ?? settings.workDaysPerMonth;

    const calculatedBonuses = manualBonuses
      .filter((b: any) => b.bonusType && b.amount > 0)
      .map((b: any, i: number) => ({
        id: `free-bonus-${i}`,
        bonusType: b.bonusType,
        amount: Number(b.amount),
        isTaxable: b.isTaxable ?? true,
        isCnss: b.isCnss ?? true,
        source: 'MANUAL',
        isRecurring: true,
      }));

    // ✅ Simulation libre = pas de company réelle → companyTaxes vide
    const calc = this.calculator.calculate(
      baseSalary,
      overtimeHours10,
      overtimeHours25,
      overtimeHours50,
      overtimeHours100,
      calculatedBonuses,
      [],
      settings,
      daysToPay,
      settings.workDaysPerMonth,
      fakeEmployee,
      fakeCompany,
      [],
    );

    return {
      employee: {
        id: fakeEmployee.id,
        firstName,
        lastName,
        baseSalary,
        effectiveBaseSalary: baseSalary,
        isSubjectToCnss,
        isSubjectToIrpp,
        isSubjectToTus: true,
        taxExemptionReason: null,
      },
      month,
      year,
      daysToPay,
      workDays: settings.workDaysPerMonth,
      overtime: {
        hours10: overtimeHours10,
        amount10: calc.overtimeAmount10,
        hours25: overtimeHours25,
        amount25: calc.overtimeAmount25,
        hours50: overtimeHours50,
        amount50: calc.overtimeAmount50,
        hours100: overtimeHours100,
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
      customTaxes: [],
      employeeCustomTaxTotal: 0,
      employerCustomTaxTotal: 0,
      loans: [],
      advances: [],
      totalLoanDeduction: 0,
      totalAdvanceDeduction: 0,
      totalDeductions: calc.totalDeductions,
      netSalary: calc.netSalary,
      totalEmployerCost: calc.totalEmployerCost,
      settings: {
        cnssSalarialRate: settings.cnssSalarialRate,
        cnssEmployerRate: settings.cnssEmployerRate,
        fiscalMode,
        forfaitItsRate,
      },
      simulationMode: 'FREE_SIMULATION',
    };
  }

  async getAccountingJournal(userId: string, month: number, year: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) throw new CompanyNotFoundException();
    await this.subscriptionGuard.checkFeatureAccess(
      user.companyId,
      'hasPayrollAccountingExport',
    );
    const payrolls = await this.prisma.payroll.findMany({
      where: { companyId: user.companyId, month, year },
      include: {
        employee: {
          select: { employeeNumber: true, firstName: true, lastName: true },
        },
      },
    });
    const entries: any[] = [];
    for (const p of payrolls) {
      const name = `${p.employee.firstName} ${p.employee.lastName}`;
      const piece = `PAY-${p.employee.employeeNumber}-${month}-${year}`;
      entries.push(
        // ── Écriture 1 : Charge salariale (OHADA classe 6 & 4) ──────────────
        {
          date: p.periodEnd,
          journal: 'PAIE',
          piece,
          account: '661100',
          label: `Salaires bruts - ${name}`,
          debit: Number(p.grossSalary),
          credit: 0,
        },
        {
          date: p.periodEnd,
          journal: 'PAIE',
          piece,
          account: '431100',
          label: `CNSS salarié - ${name}`,
          debit: 0,
          credit: Number(p.cnssSalarial),
        },
        {
          date: p.periodEnd,
          journal: 'PAIE',
          piece,
          account: '447200',
          label: `ITS/IRPP retenu - ${name}`,
          debit: 0,
          credit: Number(p.its),
        },
        {
          date: p.periodEnd,
          journal: 'PAIE',
          piece,
          account: '422100',
          label: `Rémunération due - ${name}`,
          debit: 0,
          credit: Number(p.netSalary),
        },
      );
      // ── Écriture 2 : Charges patronales (OHADA 664 & 641 & 431) ────────
      if (Number(p.cnssEmployer) > 0) {
        entries.push(
          {
            date: p.periodEnd,
            journal: 'PAIE',
            piece,
            account: '664100',
            label: `Charges patronales CNSS - ${name}`,
            debit: Number(p.cnssEmployer),
            credit: 0,
          },
          {
            date: p.periodEnd,
            journal: 'PAIE',
            piece,
            account: '431300',
            label: `CNSS employeur à verser - ${name}`,
            debit: 0,
            credit: Number(p.cnssEmployer),
          },
        );
      }
      if (Number((p as any).tusTotal ?? 0) > 0) {
        const tusDgi = Number((p as any).tusDgiAmount ?? 0);
        const tusCnss = Number((p as any).tusCnssAmount ?? 0);
        const tusTotal = Number((p as any).tusTotal ?? 0);
        entries.push(
          {
            date: p.periodEnd,
            journal: 'PAIE',
            piece,
            account: '641300',
            label: `TUS (7,5%) - ${name}`,
            debit: tusTotal,
            credit: 0,
          },
          {
            date: p.periodEnd,
            journal: 'PAIE',
            piece,
            account: '447200',
            label: `TUS-DGI à reverser - ${name}`,
            debit: 0,
            credit: tusDgi,
          },
          {
            date: p.periodEnd,
            journal: 'PAIE',
            piece,
            account: '431300',
            label: `TUS-CNSS à reverser - ${name}`,
            debit: 0,
            credit: tusCnss,
          },
        );
      }
    }
    return { month, year, totalEntries: entries.length, entries };
  }

  // ============================================================================
  // DECLARATIONS SUMMARY — Récapitulatif CNSS + TUS + ITS pour un mois
  // ============================================================================
  async getDeclarationsSummary(companyId: string, month: number, year: number) {
    const payrolls = await this.prisma.payroll.findMany({
      where: { companyId, month, year, status: { not: 'CANCELLED' } },
    });

    if (payrolls.length === 0) return null;

    const sum = (field: string) =>
      payrolls.reduce((acc, p) => acc + Number((p as any)[field] ?? 0), 0);

    const totalGrossSalary = sum('grossSalary');
    const totalCnssSalarial = sum('cnssSalarial');
    const cnssEmployerPension = sum('cnssEmployerPension');
    const cnssEmployerFamily = sum('cnssEmployerFamily');
    const cnssEmployerAccident = sum('cnssEmployerAccident');
    const totalCnssEmployer = sum('cnssEmployer');
    const tusDgiAmount = sum('tusDgiAmount');
    const tusCnssAmount = sum('tusCnssAmount');
    const tusTotal = sum('tusTotal');
    const totalIts = sum('its');

    // Agréger les taxes custom (stockées en JSON dans customTaxDetails)
    const customMap: Record<
      string,
      {
        name: string;
        code: string;
        employeeTotal: number;
        employerTotal: number;
      }
    > = {};
    for (const p of payrolls) {
      const details: any[] = (p as any).customTaxDetails ?? [];
      for (const t of details) {
        if (!customMap[t.code]) {
          customMap[t.code] = {
            name: t.name,
            code: t.code,
            employeeTotal: 0,
            employerTotal: 0,
          };
        }
        customMap[t.code].employeeTotal += Number(t.employeeAmount ?? 0);
        customMap[t.code].employerTotal += Number(t.employerAmount ?? 0);
      }
    }

    const totalSalarialDeductions =
      totalCnssSalarial +
      totalIts +
      Object.values(customMap).reduce((s, t) => s + t.employeeTotal, 0);
    const totalEmployerCharges =
      totalCnssEmployer +
      tusTotal +
      Object.values(customMap).reduce((s, t) => s + t.employerTotal, 0);

    return {
      month,
      year,
      employeeCount: payrolls.length,
      totalGrossSalary,
      totalCnssSalarial,
      cnssEmployerPension,
      cnssEmployerFamily,
      cnssEmployerAccident,
      totalCnssEmployer,
      tusDgiAmount,
      tusCnssAmount,
      tusTotal,
      totalIts,
      customTaxDetails: Object.values(customMap),
      totalSalarialDeductions,
      totalEmployerCharges,
      grandTotal: totalSalarialDeductions + totalEmployerCharges,
    };
  }

  private defaultFreeSettings(fiscalMode: string, forfaitItsRate: number) {
    return {
      cnssSalarialRate: 4,
      cnssEmployerRate: 20.28,
      cnssCeiling: 1_200_000,
      workDaysPerMonth: 26,
      overtimeRate10: 10,
      overtimeRate25: 25,
      overtimeRate50: 50,
      overtimeRate100: 100,
      fiscalMode,
      forfaitItsRate,
    };
  }
}