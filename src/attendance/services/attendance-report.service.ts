// ============================================================================
// 📁 src/attendance/services/attendance-report.service.ts
// ✅ v5.1 — Cohérent avec tous les services v5
//
// CHANGEMENTS v5.1 :
//   - totalHours = normalHours + ot10 + ot25 + ot50 + ot100
//     (pas juste normalHours comme avant)
//   - overtime10 lu depuis DB = heures de jour brutes au checkout
//     La ventilation finale ot10/ot25 est dans attendance-summary
//   - Details enrichis : overtime10/25/50/100 par jour
//   - Multi-PME (cabinet) via overrideCompanyId — inchangé
// ============================================================================

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceCalculationService } from './attendance-calculation.service';
import {
  AttendanceUtilsService,
  MonthlyReportItem,
  DayStatusEnum,
  DEFAULT_WORK_DAYS,
  BATCH_SIZE,
} from './attendance-utils.service';

@Injectable()
export class AttendanceReportService {
  constructor(
    private prisma: PrismaService,
    private utils: AttendanceUtilsService,
    private calculation: AttendanceCalculationService,
  ) {}

  // ============================================================================
  // ✅ GRILLE MENSUELLE — Pré-remplissage des statuts par défaut
  // ============================================================================
  async generateMonthlyAttendanceGrid(
    companyId: string,
    month: number,
    year: number,
  ) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: { id: true },
    });

    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const payrollSettings = await this.prisma.payrollSettings.findFirst({
      where: { companyId },
      orderBy: { effectiveDate: 'desc' },
      select: { workDays: true },
    });
    const workDays = (payrollSettings?.workDays ||
      DEFAULT_WORK_DAYS) as number[];

    const [holidays, leaves, absenceRequests] = await Promise.all([
      this.prisma.publicHoliday.findMany({ where: { companyId, year } }),
      this.prisma.leave.findMany({
        where: {
          companyId,
          status: 'APPROVED',
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
      this.prisma.absenceRequest.findMany({
        where: {
          companyId,
          status: 'APPROVED',
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
    ]);

    const absenceMap = new Map<
      string,
      Map<string, { id: string; isPaid: boolean }>
    >();
    absenceRequests.forEach((ar) => {
      if (!absenceMap.has(ar.employeeId))
        absenceMap.set(ar.employeeId, new Map());
      const current = new Date(ar.startDate);
      const end = new Date(ar.endDate);
      while (current <= end) {
        absenceMap.get(ar.employeeId)!.set(this.utils.formatDate(current), {
          id: ar.id,
          isPaid: ar.isPaid,
        });
        current.setDate(current.getDate() + 1);
      }
    });

    const holidaySet = new Set(holidays.map((h) => h.date));
    const leaveMap = new Map<string, Map<string, string>>();

    leaves.forEach((leave) => {
      if (!leaveMap.has(leave.employeeId))
        leaveMap.set(leave.employeeId, new Map());
      const current = new Date(leave.startDate);
      const end = new Date(leave.endDate);
      while (current <= end) {
        const dateStr = this.utils.formatDate(current);
        leaveMap.get(leave.employeeId)!.set(dateStr, leave.id);
        current.setDate(current.getDate() + 1);
      }
    });

    let totalGenerated = 0;

    for (let i = 0; i < employees.length; i += BATCH_SIZE) {
      const batch = employees.slice(i, i + BATCH_SIZE);
      const records: Array<{
        employeeId: string;
        companyId: string;
        date: string;
        status: string;
        leaveId: string | null;
        absenceRequestId: string | null;
      }> = [];

      for (const emp of batch) {
        const empLeaves = leaveMap.get(emp.id);
        const empAbsences = absenceMap.get(emp.id);

        for (let day = 1; day <= daysInMonth; day++) {
          const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const current = this.utils.createLocalDate(date);

          let defaultStatus = 'UNKNOWN';
          let leaveId: string | null = null;
          let absenceRequestId: string | null = null;

          if (holidaySet.has(date)) {
            defaultStatus = 'HOLIDAY';
          } else if (!this.utils.isWorkingDay(current, workDays)) {
            defaultStatus = 'OFF_DAY';
          } else if (empLeaves?.has(date)) {
            // ✅ CORRECTIF : 'ON_LEAVE' n'existe pas dans l'enum Postgres
            // AttendanceStatus (seul 'LEAVE' existe) — cette ligne faisait
            // très probablement échouer l'insertion dès qu'un jour de congé
            // était rencontré (valeur invalide pour l'enum), empêchant tout
            // statut LEAVE d'être réellement persisté.
            defaultStatus = 'LEAVE';
            leaveId = empLeaves.get(date)!;
          } else if (empAbsences?.has(date)) {
            const absence = empAbsences.get(date)!;
            defaultStatus = absence.isPaid ? 'ABSENT_PAID' : 'ABSENT_UNPAID';
            absenceRequestId = absence.id;
          } else {
            defaultStatus = 'PENDING';
          }

          records.push({
            employeeId: emp.id,
            companyId,
            date,
            status: defaultStatus,
            leaveId,
            absenceRequestId,
          });
        }
      }

      if (records.length > 0) {
        await this.prisma.attendance.createMany({
          data: records,
          skipDuplicates: true,
        } as any);
        totalGenerated += records.length;
      }
    }

    return {
      success: true,
      generated: totalGenerated,
      message: `${totalGenerated} jours générés pour ${employees.length} employés`,
    };
  }

  // ============================================================================
  // ✅ RAPPORT MENSUEL v5.1
  //
  // normalHours = heures réelles pointées (pas forfait 173.33h)
  // totalHours  = normalHours + ot10 + ot25 + ot50 + ot100
  //
  // Note sur overtime10 :
  //   Au checkout, overtime10 stocke les heures de jour brutes.
  //   La ventilation finale ot10/ot25 via la semaine ISO est faite
  //   par attendance-summary. Ici on affiche ce qui est en DB.
  //   Pour le rapport RH détaillé, utiliser getMonthlyAttendanceSummary.
  // ============================================================================
  private static readonly MANAGE_ALL_ROLES = [
    'ADMIN',
    'SUPER_ADMIN',
    'HR_MANAGER',
  ];

  async generateMonthlyReport(
    userId: string,
    month: number,
    year: number,
    overrideCompanyId?: string,
  ): Promise<MonthlyReportItem[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true, email: true },
    });

    const isCabinet =
      user?.role === 'CABINET_ADMIN' || user?.role === 'CABINET_GESTIONNAIRE';
    const targetCompanyId =
      isCabinet && overrideCompanyId ? overrideCompanyId : user?.companyId;
    if (!targetCompanyId) return [];

    // 🔒 Scoping par rôle — c'était le trou : avant ce correctif, TOUT
    //    utilisateur authentifié (y compris un simple employé) recevait le
    //    rapport complet de tous les employés de l'entreprise via ce endpoint.
    //    - ADMIN/SUPER_ADMIN/HR_MANAGER (ou cabinet) : toute l'entreprise
    //    - MANAGER : uniquement son département
    //    - Employé standard : uniquement sa propre fiche
    const employeeWhere: any = { companyId: targetCompanyId, status: 'ACTIVE' };

    if (!isCabinet && !AttendanceReportService.MANAGE_ALL_ROLES.includes(user?.role || '')) {
      if (user?.role === 'MANAGER') {
        const dept = await this.prisma.department.findFirst({
          where: { managerId: userId, companyId: targetCompanyId },
          select: { id: true },
        });
        let deptId = dept?.id ?? null;
        if (!deptId && user?.email) {
          const emp = await this.prisma.employee.findFirst({
            where: { email: user.email, companyId: targetCompanyId },
            select: { departmentId: true },
          });
          deptId = emp?.departmentId ?? null;
        }
        // Aucun département trouvé → aucun résultat plutôt que tout montrer
        employeeWhere.departmentId = deptId ?? '__none__';
      } else {
        // Employé standard : uniquement sa propre fiche
        employeeWhere.email = user?.email ?? '__none__';
      }
    }

    const employees = await this.prisma.employee.findMany({
      where: employeeWhere,
      include: { department: true },
    });

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const report: MonthlyReportItem[] = [];

    for (const emp of employees) {
      const dayStatuses = await this.calculation.calculateDayStatuses(
        emp.id,
        startDate,
        endDate,
      );

      // ── Décompte jours ──────────────────────────────────────────────────────
      const daysPresent = dayStatuses.filter(
        (d) => d.status === DayStatusEnum.PRESENT,
      ).length;
      const daysLate = dayStatuses.filter(
        (d) => d.status === DayStatusEnum.LATE,
      ).length;
      const daysRemote = dayStatuses.filter(
        (d) => d.status === DayStatusEnum.REMOTE,
      ).length;
      const daysOnLeave = dayStatuses.filter(
        (d) => d.status === DayStatusEnum.LEAVE,
      ).length;
      const daysHoliday = dayStatuses.filter(
        (d) => d.status === DayStatusEnum.HOLIDAY,
      ).length;
      const daysOffDay = dayStatuses.filter(
        (d) => d.status === DayStatusEnum.OFF_DAY,
      ).length;
      const daysAbsentUnpaid = dayStatuses.filter(
        (d) => d.status === DayStatusEnum.ABSENT_UNPAID,
      ).length;
      const daysAbsentPaid = dayStatuses.filter(
        (d) => (d.status as string) === 'ABSENT_PAID',
      ).length;

      // ── Heures réelles depuis les pointages ──────────────────────────────────
      // normalHours = heures dans le shift (pas forfait)
      const normalHours = dayStatuses.reduce(
        (sum, d) => sum + (d.totalHours || 0),
        0,
      );

      // ✅ v5.1 : lire les 4 catégories HS depuis la DB
      // overtime10 = heures de jour brutes (ventilation hebdo dans summary)
      const overtime10 = dayStatuses.reduce(
        (sum, d) => sum + ((d as any).overtime10 || 0),
        0,
      );
      const overtime25 = dayStatuses.reduce(
        (sum, d) => sum + ((d as any).overtime25 || 0),
        0,
      );
      const overtime50 = dayStatuses.reduce(
        (sum, d) => sum + (d.overtime50 || 0),
        0,
      );
      const overtime100 = dayStatuses.reduce(
        (sum, d) => sum + ((d as any).overtime100 || 0),
        0,
      );

      // ✅ totalHours = normalHours + toutes les HS
      const totalHours =
        normalHours + overtime10 + overtime25 + overtime50 + overtime100;

      report.push({
        id: emp.id,
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        matricule: emp.employeeNumber,
        avatar: emp.photoUrl,
        department: emp.department?.name || 'N/A',

        daysPresent,
        daysLate,
        daysRemote,
        daysOnLeave,
        daysHoliday,
        daysOffDay,
        daysAbsentUnpaid,
        daysAbsentPaid,

        normalHours: parseFloat(normalHours.toFixed(2)),
        totalHours: parseFloat(totalHours.toFixed(2)),

        // ✅ 4 catégories HS — Décret 78-360
        overtime10: parseFloat(overtime10.toFixed(2)),
        overtime25: parseFloat(overtime25.toFixed(2)),
        overtime50: parseFloat(overtime50.toFixed(2)),
        overtime100: parseFloat(overtime100.toFixed(2)),

        status:
          daysAbsentUnpaid === 0 && daysPresent >= 20 ? 'perfect' : 'warning',
        trend: 'stable',

        // ✅ Détail journalier enrichi
        details: dayStatuses.map((d) => ({
          date: d.date,
          status: d.status,
          in: d.checkIn
            ? new Date(d.checkIn).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '-',
          out: d.checkOut
            ? new Date(d.checkOut).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '-',
          total: d.totalHours?.toFixed(2) || '0.00',
          // HS du jour
          ot10: ((d as any).overtime10 || 0).toFixed(2),
          ot25: ((d as any).overtime25 || 0).toFixed(2),
          ot50: (d.overtime50 || 0).toFixed(2),
          ot100: ((d as any).overtime100 || 0).toFixed(2),
          type: d.status,
          leaveType: d.leaveType,
          absenceType: (d as any).absenceType,
          isPaid: (d as any).isPaid,
        })),
      });
    }

    return report;
  }
}