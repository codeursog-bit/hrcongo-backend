// ============================================================================
// 📁 src/attendance/attendance.service.ts
// ✅ v5.1 — Orchestrateur principal — cohérent avec tous les services v5
//
// CHANGEMENTS v5.1 :
//   - createManual : utilise buildOvertimeContext + calculateOvertimeV3
//     (au lieu de calculateOvertime legacy) → même logique que checkOut
//   - createManual : workDays réels de l'entreprise (pas hardcode isWeekend)
//   - createManual : jour férié vérifié via DB
//   - Tous les délégués pointent vers les services v5.1
// ============================================================================

import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import {
  AttendanceUtilsService,
  DEFAULT_WORK_DAYS,
} from './services/attendance-utils.service';
import { AttendanceCalculationService } from './services/attendance-calculation.service';
import { AttendanceCheckService } from './services/attendance-check.service';
import { AttendanceReportService } from './services/attendance-report.service';

export { DayStatusEnum } from './services/attendance-utils.service';
export type {
  DayStatus,
  MonthlyReportItem,
  NotificationPayload,
  AuditChange,
} from './services/attendance-utils.service';

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private utils: AttendanceUtilsService,
    private calculation: AttendanceCalculationService,
    private check: AttendanceCheckService,
    private report: AttendanceReportService,
  ) {}

  // ============================================================================
  // 🔒 HELPER : user vérifié + companyId
  // ============================================================================
  private async getVerifiedUser(userId: string): Promise<{
    id: string;
    companyId: string;
    role: string;
    email: string | null;
    canRecordAttendanceForAll: boolean;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        companyId: true,
        role: true,
        email: true,
        canRecordAttendanceForAll: true, // 🆕 permission "secrétaire" pointage
      },
    });
    if (!user || !user.companyId) {
      throw new ForbiddenException(
        'Utilisateur non rattaché à une entreprise.',
      );
    }
    return { ...user, companyId: user.companyId };
  }

  // ============================================================================
  // 🔒 HELPER : département du manager
  // ============================================================================
  private async getManagerDeptId(
    userId: string,
    companyId: string,
  ): Promise<string | null> {
    const dept = await this.prisma.department.findFirst({
      where: { managerId: userId, companyId },
      select: { id: true },
    });
    if (dept) return dept.id;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user?.email) {
      const emp = await this.prisma.employee.findFirst({
        where: { email: user.email, companyId },
        select: { departmentId: true },
      });
      return emp?.departmentId ?? null;
    }
    return null;
  }

  // ============================================================================
  // 🔒 HELPER : vérifier accès employé (+ département si MANAGER)
  // ============================================================================
  private static readonly MANAGE_ALL_ROLES = [
    'ADMIN',
    'SUPER_ADMIN',
    'HR_MANAGER',
  ];

  async assertCanAccessEmployee(
    userId: string,
    companyId: string,
    role: string,
    employeeId: string,
    canRecordAttendanceForAll: boolean = false, // 🆕 permission "secrétaire" pointage
  ): Promise<void> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true, departmentId: true },
    });
    if (!employee || employee.companyId !== companyId) {
      throw new ForbiddenException(
        "Cet employé n'appartient pas à votre entreprise.",
      );
    }

    // ✅ ADMIN/SUPER_ADMIN/HR_MANAGER : accès complet à l'entreprise
    if (AttendanceService.MANAGE_ALL_ROLES.includes(role)) return;

    // 🆕 Permission "secrétaire" : accès total à l'entreprise, quel que soit
    //    le rôle de base (MANAGER sort de son département, EMPLOYEE sort de sa propre fiche)
    if (canRecordAttendanceForAll) return;

    // ✅ MANAGER : uniquement son département
    if (role === 'MANAGER') {
      const deptId = await this.getManagerDeptId(userId, companyId);
      if (!deptId || employee.departmentId !== deptId) {
        throw new ForbiddenException(
          "Vous n'avez accès qu'aux pointages de votre département.",
        );
      }
      return;
    }

    // 🔒 Employé standard : uniquement sa propre fiche — c'était le trou :
    //    avant ce correctif, n'importe quel employé pouvait consulter le
    //    résumé de n'importe quel collègue en changeant l'employeeId dans l'URL.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const ownEmployee = user?.email
      ? await this.prisma.employee.findFirst({
          where: { email: user.email, companyId },
          select: { id: true },
        })
      : null;
    if (!ownEmployee || ownEmployee.id !== employeeId) {
      throw new ForbiddenException(
        "Vous n'avez accès qu'à vos propres pointages.",
      );
    }
  }

  // ============================================================================
  // 🆕 Liste des employés pour le sélecteur du pointage manuel
  //    (scopée exclusivement au module attendance — n'affecte aucun autre
  //    module comme congés, prêts, paie, matériel, etc.)
  // ============================================================================
  async getEmployeesForManualAttendance(userId: string) {
    const user = await this.getVerifiedUser(userId);
    if (!user.companyId) return [];

    const canSeeAll =
      AttendanceService.MANAGE_ALL_ROLES.includes(user.role) ||
      user.canRecordAttendanceForAll;

    if (!canSeeAll && user.role !== 'MANAGER') {
      throw new ForbiddenException('Accès non autorisé.');
    }

    const whereClause: any = { companyId: user.companyId, status: 'ACTIVE' };

    if (!canSeeAll && user.role === 'MANAGER') {
      const deptId = await this.getManagerDeptId(user.id, user.companyId);
      if (!deptId) return [];
      whereClause.departmentId = deptId;
    }

    return this.prisma.employee.findMany({
      where: whereClause,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
        position: true,
        photoUrl: true,
        department: { select: { id: true, name: true } },
      },
      orderBy: { firstName: 'asc' },
    });
  }

  // ============================================================================
  // ✅ DÉLÉGATION CALCULS
  // ============================================================================
  async calculateDayStatuses(
    employeeId: string,
    startDate: Date,
    endDate: Date,
  ) {
    return this.calculation.calculateDayStatuses(
      employeeId,
      startDate,
      endDate,
    );
  }

  // ============================================================================
  // ✅ DÉLÉGATION CHECK-IN/OUT
  // ============================================================================
  async checkIn(dto: CreateAttendanceDto, userId: string) {
    return this.check.checkIn(dto, userId);
  }

  async checkOut(dto: CreateAttendanceDto, userId: string) {
    return this.check.checkOut(dto, userId);
  }

  async correctAttendance(
    attendanceId: string,
    userId: string,
    updates: any,
    req?: any,
  ) {
    return this.check.correctAttendance(attendanceId, userId, updates, req);
  }

  // ============================================================================
  // ✅ DÉLÉGATION RAPPORTS
  // ============================================================================
  async generateMonthlyReport(
    userId: string,
    month: number,
    year: number,
    overrideCompanyId?: string,
  ) {
    return this.report.generateMonthlyReport(
      userId,
      month,
      year,
      overrideCompanyId,
    );
  }

  async generateMonthlyAttendanceGrid(
    companyId: string,
    month: number,
    year: number,
  ) {
    return this.report.generateMonthlyAttendanceGrid(companyId, month, year);
  }

  // ============================================================================
  // ✅ LISTE DU JOUR — filtrée par département si MANAGER
  // ============================================================================
  async findToday(userId: string) {
    const user = await this.getVerifiedUser(userId);

    const whereClause: any = {
      companyId: user.companyId,
      date: this.utils.getTodayString(),
    };

    if (user.role === 'MANAGER' && !user.canRecordAttendanceForAll) {
      const deptId = await this.getManagerDeptId(user.id, user.companyId);
      if (!deptId) return [];
      whereClause.employee = { departmentId: deptId };
    }

    return this.prisma.attendance.findMany({
      where: whereClause,
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            position: true,
            department: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { checkIn: 'desc' },
    });
  }

  // ============================================================================
  // ✅ HISTORIQUE MENSUEL — filtré par département si MANAGER
  // ============================================================================
  async findAll(userId: string, month: number, year: number) {
    const user = await this.getVerifiedUser(userId);

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const startDateStr = this.utils.formatDate(startDate);
    const endDateStr = this.utils.formatDate(endDate);

    let departmentFilter: any = undefined;
    if (user.role === 'MANAGER' && !user.canRecordAttendanceForAll) {
      const deptId = await this.getManagerDeptId(user.id, user.companyId);
      if (!deptId)
        return {
          employees: [],
          attendances: [],
          dayStatuses: [],
          settings: null,
        };
      departmentFilter = { departmentId: deptId };
    }

    const payrollSettings = await this.prisma.payrollSettings.findFirst({
      where: { companyId: user.companyId },
      orderBy: { effectiveDate: 'desc' },
      select: {
        workDays: true,
        officialStartHour: true,
        lateToleranceMinutes: true,
      },
    });

    const workDays = (payrollSettings?.workDays ||
      DEFAULT_WORK_DAYS) as number[];

    const employeeWhere: any = {
      companyId: user.companyId,
      status: 'ACTIVE',
      ...departmentFilter,
    };

    const [employees, allAttendances, allLeaves, allHolidays] =
      await Promise.all([
        this.prisma.employee.findMany({
          where: employeeWhere,
          select: {
            id: true,
            firstName: true,
            lastName: true,
            photoUrl: true,
            employeeNumber: true,
            position: true,
            phone: true,
            department: { select: { name: true } },
          },
        }),
        this.prisma.attendance.findMany({
          where: {
            companyId: user.companyId,
            date: { gte: startDateStr, lte: endDateStr },
            ...(departmentFilter ? { employee: departmentFilter } : {}),
          },
          include: { employee: true },
          orderBy: { date: 'desc' },
        }),
        this.prisma.leave.findMany({
          where: {
            companyId: user.companyId,
            status: 'APPROVED',
            startDate: { lte: endDate },
            endDate: { gte: startDate },
            ...(departmentFilter ? { employee: departmentFilter } : {}),
          },
        }),
        this.prisma.publicHoliday.findMany({
          where: { companyId: user.companyId, year: startDate.getFullYear() },
        }),
      ]);

    const attendancesByEmp = new Map<string, any[]>();
    const leavesByEmp = new Map<string, any[]>();

    allAttendances.forEach((att) => {
      if (!attendancesByEmp.has(att.employeeId))
        attendancesByEmp.set(att.employeeId, []);
      attendancesByEmp.get(att.employeeId)!.push(att);
    });

    allLeaves.forEach((leave) => {
      if (!leavesByEmp.has(leave.employeeId))
        leavesByEmp.set(leave.employeeId, []);
      leavesByEmp.get(leave.employeeId)!.push(leave);
    });

    const holidayDates = new Set(allHolidays.map((h) => h.date));

    const dayStatuses = employees.map((emp) =>
      this.calculation.calculateDayStatusesOptimized(
        emp.id,
        startDate,
        endDate,
        attendancesByEmp.get(emp.id) || [],
        leavesByEmp.get(emp.id) || [],
        holidayDates,
        workDays,
      ),
    );

    return {
      employees,
      attendances: allAttendances,
      dayStatuses,
      settings: {
        workDays,
        officialStartHour: payrollSettings?.officialStartHour || 8,
        lateToleranceMinutes: payrollSettings?.lateToleranceMinutes || 0,
      },
    };
  }

  // ============================================================================
  // ✅ GET OR CREATE
  // ============================================================================
  async getOrCreate(userId: string, employeeId: string, date: string) {
    const user = await this.getVerifiedUser(userId);
    await this.assertCanAccessEmployee(
      user.id,
      user.companyId,
      user.role,
      employeeId,
      user.canRecordAttendanceForAll,
    );

    let attendance = await this.prisma.attendance.findFirst({
      where: { employeeId, date },
    });

    if (!attendance) {
      attendance = await this.prisma.attendance.create({
        data: {
          employeeId,
          companyId: user.companyId,
          date,
          status: 'UNKNOWN',
        },
      });
    }

    return attendance;
  }

  // ============================================================================
  // ✅ CREATE MANUAL
  // ✅ v5.1 : utilise buildOvertimeContext + calculateOvertimeV3
  //           workDays réels + jour férié DB + shift individuel
  // ============================================================================
  async createManual(
    userId: string,
    body: {
      employeeId: string;
      date: string;
      status: string;
      checkIn?: string;
      checkOut?: string;
      notes: string;
    },
  ) {
    const user = await this.getVerifiedUser(userId);
    await this.assertCanAccessEmployee(
      user.id,
      user.companyId,
      user.role,
      body.employeeId,
      user.canRecordAttendanceForAll,
    );

    const attendanceData: any = {
      employeeId: body.employeeId,
      companyId: user.companyId,
      date: body.date,
      status: body.status,
      notes: body.notes,
      checkIn: body.checkIn ? new Date(body.checkIn) : null,
      checkOut: body.checkOut ? new Date(body.checkOut) : null,
    };

    if (
      (body.status === 'PRESENT' || body.status === 'LATE') &&
      body.checkIn &&
      body.checkOut
    ) {
      const checkInDate = new Date(body.checkIn);
      const checkOutDate = new Date(body.checkOut);

      // ✅ Settings entreprise
      const ps = await this.prisma.payrollSettings.findFirst({
        where: { companyId: user.companyId },
        orderBy: { effectiveDate: 'desc' },
        select: {
          workHoursPerDay: true,
          officialStartHour: true,
          overtimeEnabled: true,
          workDays: true,
        } as any,
      });

      const workHoursPerDay = Number(ps?.workHoursPerDay ?? 8);
      const officialStartHour = Number((ps as any)?.officialStartHour ?? 8);
      const overtimeEnabled = (ps as any)?.overtimeEnabled ?? true;
      const workDays = ((ps as any)?.workDays ?? DEFAULT_WORK_DAYS) as number[];
      const officialEndHour = officialStartHour + workHoursPerDay;

      // ✅ Shift individuel pour cette date
      const dateObj = new Date(body.date);
      const sa = await this.prisma.employeeShiftAssignment.findFirst({
        where: {
          employeeId: body.employeeId,
          OR: [
            { specificDate: body.date },
            {
              dayOfWeek: dateObj.getDay(),
              specificDate: null,
              OR: [{ validFrom: null }, { validFrom: { lte: dateObj } }],
              AND: [
                {
                  OR: [{ validUntil: null }, { validUntil: { gte: dateObj } }],
                },
              ],
            },
          ],
        },
        include: { shift: true },
        orderBy: { specificDate: 'desc' },
      });
      const shift = sa?.shift ?? null;

      // ✅ Jour férié DB
      const holiday = await this.prisma.publicHoliday.findFirst({
        where: { companyId: user.companyId, date: body.date },
      });
      const isHoliday = !!holiday;

      // ✅ Contexte HS v5 (même logique que checkOut)
      const ctx = this.utils.buildOvertimeContext({
        shift,
        officialEndH: officialEndHour,
        officialEndMin: 0,
        workHoursPerDay,
        workDays,
        isHoliday,
        attendanceDate: dateObj,
        overtimeEnabled,
      });

      // ✅ Bridage arrivée anticipée
      const startH = shift?.startHour ?? officialStartHour;
      const startMin = shift?.startMinute ?? 0;
      const shiftStartThreshold = new Date(checkInDate);
      shiftStartThreshold.setHours(startH, startMin, 0, 0);
      const effectiveCheckIn =
        checkInDate < shiftStartThreshold && !shift?.crossesMidnight
          ? shiftStartThreshold
          : checkInDate;

      const totalHours = parseFloat(
        Math.max(
          0,
          (checkOutDate.getTime() - effectiveCheckIn.getTime()) / 3_600_000,
        ).toFixed(2),
      );

      // ✅ Calcul HS via calculateOvertimeV3 (cohérent avec checkOut)
      const ot = this.utils.calculateOvertimeV3(
        effectiveCheckIn,
        checkOutDate,
        ctx,
      );

      Object.assign(attendanceData, {
        checkIn: effectiveCheckIn,
        totalHours,
        normalHours: ot.normalHours,
        overtime10: ot.overtime10,
        overtime25: ot.overtime25,
        overtime50: ot.overtime50,
        overtime100: ot.overtime100,
        isNightShift: ot.isNightShift,
      });
    }

    const attendance = await this.prisma.attendance.upsert({
      where: {
        employeeId_date: { employeeId: body.employeeId, date: body.date },
      },
      update: attendanceData,
      create: attendanceData,
    });

    await this.prisma.attendanceLog.create({
      data: {
        attendanceId: attendance.id,
        modifiedBy: userId,
        field: 'status,checkIn,checkOut',
        oldValue: 'ABSENT_UNPAID',
        newValue: body.status,
        reason: body.notes,
      },
    });

    return { success: true, attendance };
  }

  // ============================================================================
  // ✅ LOGS D'AUDIT
  // ============================================================================
  async getLogs(userId: string, month: number, year: number) {
    const user = await this.getVerifiedUser(userId);

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const whereClause: any = {
      attendance: {
        companyId: user.companyId,
        date: { gte: startDate, lte: endDate },
      },
    };

    if (user.role === 'MANAGER' && !user.canRecordAttendanceForAll) {
      const deptId = await this.getManagerDeptId(user.id, user.companyId);
      if (!deptId) return { logs: [] };
      whereClause.attendance.employee = { departmentId: deptId };
    }

    const logs = await this.prisma.attendanceLog.findMany({
      where: whereClause,
      include: {
        attendance: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeNumber: true,
                department: { select: { name: true } },
              },
            },
          },
        },
        modifier: {
          select: { id: true, firstName: true, lastName: true, role: true },
        },
      },
      orderBy: { modifiedAt: 'desc' },
      take: 100,
    });

    return {
      logs: logs.map((log) => ({
        id: log.id,
        field: log.field,
        oldValue: log.oldValue,
        newValue: log.newValue,
        reason: log.reason,
        createdAt: log.modifiedAt,
        employee: log.attendance.employee,
        modifiedBy: log.modifier,
        ipAddress: log.ipAddress,
      })),
    };
  }

  // ============================================================================
  // ✅ RÉSUMÉ EMPLOYÉ SÉCURISÉ
  // ============================================================================
  async getEmployeeSummarySecure(
    userId: string,
    employeeId: string,
    month: number,
    year: number,
    summaryService: any,
  ) {
    const user = await this.getVerifiedUser(userId);
    await this.assertCanAccessEmployee(
      user.id,
      user.companyId,
      user.role,
      employeeId,
      user.canRecordAttendanceForAll,
    );

    const stored = await summaryService.getStoredSummaries(
      user.companyId,
      month,
      year,
      [employeeId],
    );
    if (stored.length > 0) return stored[0];
    return summaryService.getMonthlyAttendanceSummary(employeeId, month, year);
  }

  async getCompanyId(userId: string): Promise<string> {
    const user = await this.getVerifiedUser(userId);
    return user.companyId;
  }

  async getEmployeeDayStatuses(
    userId: string,
    employeeId: string,
    month: number,
    year: number,
  ): Promise<any[]> {
    const user = await this.getVerifiedUser(userId);
    await this.assertCanAccessEmployee(
      user.id,
      user.companyId,
      user.role,
      employeeId,
      user.canRecordAttendanceForAll,
    );
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    return this.calculation.calculateDayStatuses(
      employeeId,
      startDate,
      endDate,
    );
  }

  // ============================================================================
  // ✅ SHIFTS — inchangés (délégation Prisma directe)
  // ============================================================================

  async createShift(data: {
    companyId: string;
    name: string;
    startHour: number;
    startMinute?: number;
    endHour: number;
    endMinute?: number;
    isNightShift?: boolean;
    nightPremiumRate?: number;
    color?: string;
    isDefault?: boolean;
  }) {
    const sm = data.startMinute ?? 0;
    const em = data.endMinute ?? 0;
    const startTotal = data.startHour * 60 + sm;
    let endTotal = data.endHour * 60 + em;
    const crosses = endTotal <= startTotal;
    if (crosses) endTotal += 24 * 60;
    const duration = parseFloat(((endTotal - startTotal) / 60).toFixed(2));

    return this.prisma.workShift.create({
      data: {
        companyId: data.companyId,
        name: data.name,
        startHour: data.startHour,
        startMinute: sm,
        endHour: data.endHour,
        endMinute: em,
        durationHours: duration,
        crossesMidnight: crosses,
        isNightShift: data.isNightShift ?? crosses,
        nightPremiumRate: data.nightPremiumRate ?? 0,
        color: data.color ?? '#0EA5E9',
        isDefault: data.isDefault ?? false,
        isActive: true,
      },
    });
  }

  async getShifts(companyId: string) {
    return this.prisma.workShift.findMany({
      where: { companyId, isActive: true },
      orderBy: { startHour: 'asc' },
    });
  }

  async updateShift(shiftId: string, companyId: string, data: any) {
    const shift = await this.prisma.workShift.findFirst({
      where: { id: shiftId, companyId },
    });
    if (!shift) throw new Error('Shift introuvable');

    if (data.startHour !== undefined || data.endHour !== undefined) {
      const sh = data.startHour ?? shift.startHour;
      const sm = data.startMinute ?? Number(shift.startMinute ?? 0);
      const eh = data.endHour ?? shift.endHour;
      const em = data.endMinute ?? Number(shift.endMinute ?? 0);
      const startTotal = sh * 60 + sm;
      let endTotal = eh * 60 + em;
      const crosses = endTotal <= startTotal;
      if (crosses) endTotal += 24 * 60;
      data.durationHours = parseFloat(
        ((endTotal - startTotal) / 60).toFixed(2),
      );
      data.crossesMidnight = crosses;
    }

    return this.prisma.workShift.update({ where: { id: shiftId }, data });
  }

  async deleteShift(shiftId: string, companyId: string) {
    const shift = await this.prisma.workShift.findFirst({
      where: { id: shiftId, companyId },
    });
    if (!shift) throw new Error('Shift introuvable');
    return this.prisma.workShift.update({
      where: { id: shiftId },
      data: { isActive: false },
    });
  }

  async assignShift(data: {
    companyId: string;
    employeeId: string;
    shiftId: string;
    specificDate?: string;
    dayOfWeek?: number;
    validFrom?: Date;
    validUntil?: Date;
    notes?: string;
  }) {
    if (data.specificDate) {
      return this.prisma.employeeShiftAssignment.upsert({
        where: {
          employeeId_specificDate: {
            employeeId: data.employeeId,
            specificDate: data.specificDate,
          },
        },
        update: { shiftId: data.shiftId, notes: data.notes },
        create: {
          companyId: data.companyId,
          employeeId: data.employeeId,
          shiftId: data.shiftId,
          specificDate: data.specificDate,
          notes: data.notes,
        },
      });
    }
    return this.prisma.employeeShiftAssignment.create({
      data: {
        companyId: data.companyId,
        employeeId: data.employeeId,
        shiftId: data.shiftId,
        dayOfWeek: data.dayOfWeek,
        validFrom: data.validFrom,
        validUntil: data.validUntil,
        notes: data.notes,
      },
    });
  }

  async getEmployeeShifts(employeeId: string) {
    return this.prisma.employeeShiftAssignment.findMany({
      where: { employeeId },
      include: { shift: true },
      orderBy: [{ specificDate: 'asc' }, { dayOfWeek: 'asc' }],
    });
  }

  async getAllShiftAssignments(companyId: string) {
    return this.prisma.employeeShiftAssignment.findMany({
      where: { companyId },
      include: {
        shift: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            position: true,
            photoUrl: true,
            department: { select: { name: true } },
          },
        },
      },
      orderBy: [{ specificDate: 'asc' }, { dayOfWeek: 'asc' }],
    });
  }

  async getEmployeeShiftForDate(
    employeeId: string,
    companyId: string,
    date: string,
  ): Promise<any | null> {
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getDay();

    const specific = await this.prisma.employeeShiftAssignment.findFirst({
      where: { employeeId, specificDate: date },
      include: { shift: true },
    });
    if (specific) return specific.shift;

    const recurring = await this.prisma.employeeShiftAssignment.findFirst({
      where: {
        employeeId,
        dayOfWeek,
        specificDate: null,
        OR: [{ validFrom: null }, { validFrom: { lte: dateObj } }],
        AND: [{ OR: [{ validUntil: null }, { validUntil: { gte: dateObj } }] }],
      },
      include: { shift: true },
      orderBy: { createdAt: 'desc' },
    });
    if (recurring) return recurring.shift;

    return this.prisma.workShift.findFirst({
      where: { companyId, isDefault: true, isActive: true },
    });
  }
}
