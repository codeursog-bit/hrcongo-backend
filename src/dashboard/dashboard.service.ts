// import { Injectable } from '@nestjs/common';
// import { PrismaService } from '../prisma/prisma.service';

// @Injectable()
// export class DashboardService {
//   constructor(private prisma: PrismaService) {}

//   // ============================================================
//   // 🔒 HELPER : récupérer le département du manager
//   // ============================================================
//   private async getManagerDeptId(userId: string, companyId: string): Promise<string | null> {
//     const dept = await this.prisma.department.findFirst({
//       where: { managerId: userId, companyId },
//       select: { id: true, name: true }
//     });
//     if (dept) return dept.id;

//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { email: true }
//     });
//     if (user?.email) {
//       const emp = await this.prisma.employee.findFirst({
//         where: { email: user.email, companyId },
//         select: { departmentId: true }
//       });
//       return emp?.departmentId ?? null;
//     }
//     return null;
//   }

//   // ============================================================
//   // ✅ RÉSUMÉ ADMIN / HR / SUPER_ADMIN (inchangé)
//   // ============================================================
//   async getSummary(userId: string) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true }
//     });

//     if (!user || !user.companyId) return {};

//     const companyId = user.companyId;
//     const now = new Date();
//     const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

//     const lastPayroll = await this.prisma.payroll.findFirst({
//       where: { companyId },
//       orderBy: [{ year: 'desc' }, { month: 'desc' }],
//       select: { month: true, year: true }
//     });

//     const currentMonth = lastPayroll?.month || now.getMonth() + 1;
//     const currentYear  = lastPayroll?.year  || now.getFullYear();
//     const timeLimit    = new Date(Date.now() - 36 * 60 * 60 * 1000);

//     const totalEmployees = await this.prisma.employee.count({ where: { companyId } });

//     const payrollSum = await this.prisma.payroll.aggregate({
//       where: { companyId, month: currentMonth, year: currentYear },
//       _sum: { grossSalary: true, netSalary: true }
//     });

//     const attendanceCount = await this.prisma.attendance.count({
//       where: { companyId, date: today }
//     });

//     const absentCount   = Math.max(0, totalEmployees - attendanceCount);
//     const pendingLeaves = await this.prisma.leave.count({
//       where: { companyId, status: 'PENDING' }
//     });

//     const recentPayrolls = await this.prisma.payroll.findMany({
//       where: { companyId },
//       orderBy: { createdAt: 'desc' },
//       take: 3,
//       include: { employee: { select: { firstName: true, lastName: true } } }
//     });

//     const recentLeaves = await this.prisma.leave.findMany({
//       where: { companyId, createdAt: { gte: timeLimit } },
//       orderBy: { createdAt: 'desc' },
//       take: 5,
//       include: { employee: { select: { firstName: true, lastName: true } } }
//     });

//     const recentHires = await this.prisma.employee.findMany({
//       where: { companyId, createdAt: { gte: timeLimit } },
//       orderBy: { createdAt: 'desc' },
//       take: 5
//     });

//     const recentAttendance = await this.prisma.attendance.findMany({
//       where: { companyId, updatedAt: { gte: timeLimit } },
//       orderBy: { updatedAt: 'desc' },
//       take: 5,
//       include: { employee: { select: { firstName: true, lastName: true } } }
//     });

//     const activities = [
//       ...recentLeaves.map((l: any) => ({
//         id: `leave-${l.id}`, type: 'LEAVE',
//         text: `${l.employee.firstName} a demandé un congé`,
//         subText: l.type, time: l.createdAt
//       })),
//       ...recentHires.map((h: any) => ({
//         id: `hire-${h.id}`, type: 'HIRE',
//         text: `Nouvel employé : ${h.firstName} ${h.lastName}`,
//         subText: h.position, time: h.createdAt
//       })),
//       ...recentAttendance.map((a: any) => ({
//         id: `att-${a.id}`, type: 'ATTENDANCE',
//         text: `${a.employee.firstName} a pointé (${a.checkOut ? 'Sortie' : 'Entrée'})`,
//         subText: a.checkOut ? 'Fin de journée' : 'Début de journée',
//         time: a.checkOut ? a.checkOut : a.checkIn
//       }))
//     ]
//       .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
//       .slice(0, 10);

//     return {
//       totalEmployees,
//       masseSalariale: payrollSum._sum.grossSalary || 0,
//       absentToday: absentCount,
//       pendingLeaves,
//       attendanceRate: totalEmployees > 0 ? Math.round((attendanceCount / totalEmployees) * 100) : 0,
//       recentPayrolls,
//       recentActivities: activities
//     };
//   }

//   // ============================================================
//   // ✅ RÉSUMÉ MANAGER — données filtrées par département
//   // ============================================================
//   async getManagerSummary(userId: string) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true, email: true }
//     });

//     if (!user?.companyId) return {};

//     const companyId = user.companyId;
//     const deptId    = await this.getManagerDeptId(userId, companyId);

//     // Département introuvable → retour minimal
//     if (!deptId) return { error: 'Département non trouvé', teamSize: 0 };

//     const now   = new Date();
//     const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

//     const dept = await this.prisma.department.findUnique({
//       where: { id: deptId },
//       select: { name: true }
//     });

//     // ── Membres de l'équipe ────────────────────────────────────
//     const [teamMembers, pendingLeaves] = await Promise.all([
//       this.prisma.employee.findMany({
//         where: { companyId, departmentId: deptId, status: 'ACTIVE' },
//         select: {
//           id: true,
//           firstName: true,
//           lastName: true,
//           position: true,
//           photoUrl: true,
//           contractType: true,
//         },
//         orderBy: [{ lastName: 'asc' }]
//       }),
//       this.prisma.leave.count({
//         where: {
//           companyId,
//           status: 'PENDING',
//           employee: { departmentId: deptId }
//         }
//       })
//     ]);

//     const teamIds = teamMembers.map(e => e.id);

//     // ── Pointages aujourd'hui (département) ────────────────────
//     const todayAttendances = await this.prisma.attendance.findMany({
//       where: {
//         companyId,
//         date: today,
//         employeeId: { in: teamIds }
//       },
//       select: {
//         employeeId: true,
//         status: true,
//         checkIn: true,
//         checkOut: true
//       }
//     });

//     const presentIds = new Set(
//       todayAttendances
//         .filter(a => ['PRESENT', 'LATE', 'REMOTE'].includes(a.status))
//         .map(a => a.employeeId)
//     );
//     const lateIds = new Set(
//       todayAttendances
//         .filter(a => a.status === 'LATE')
//         .map(a => a.employeeId)
//     );

//     const presentCount = presentIds.size;
//     const absentCount  = teamMembers.length - presentCount;
//     const lateCount    = lateIds.size;
//     const presenceRate = teamMembers.length > 0
//       ? Math.round((presentCount / teamMembers.length) * 100)
//       : 0;

//     // ── Absents du jour avec détail ────────────────────────────
//     const absentMembers = teamMembers
//       .filter(emp => !presentIds.has(emp.id))
//       .map(emp => {
//         const att = todayAttendances.find(a => a.employeeId === emp.id);
//         return {
//           id:        emp.id,
//           firstName: emp.firstName,
//           lastName:  emp.lastName,
//           position:  emp.position,
//           photoUrl:  emp.photoUrl,
//           status:    att?.status || 'ABSENT_UNPAID'
//         };
//       });

//     // ── Congés en cours dans l'équipe ─────────────────────────
//     const onLeaveNow = await this.prisma.leave.findMany({
//       where: {
//         companyId,
//         status: 'APPROVED',
//         startDate: { lte: now },
//         endDate:   { gte: now },
//         employee:  { departmentId: deptId }
//       },
//       select: {
//         id: true, type: true, startDate: true, endDate: true,
//         employee: { select: { firstName: true, lastName: true, position: true } }
//       }
//     });

//     // ── Demandes de congé récentes (dept) ─────────────────────
//     const recentLeaveRequests = await this.prisma.leave.findMany({
//       where: {
//         companyId,
//         employee: { departmentId: deptId },
//         createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
//       },
//       orderBy: { createdAt: 'desc' },
//       take: 5,
//       select: {
//         id: true, type: true, status: true, startDate: true, endDate: true,
//         daysCount: true, createdAt: true,
//         employee: { select: { firstName: true, lastName: true } }
//       }
//     });

//     // ── Pointages récents (activité équipe) ────────────────────
//     const recentActivity = await this.prisma.attendance.findMany({
//       where: {
//         companyId,
//         employeeId: { in: teamIds },
//         updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
//       },
//       orderBy: { updatedAt: 'desc' },
//       take: 8,
//       select: {
//         id: true, status: true, checkIn: true, checkOut: true, date: true,
//         employee: { select: { firstName: true, lastName: true } }
//       }
//     });

//     return {
//       departmentName: dept?.name || 'Mon Département',
//       teamSize:       teamMembers.length,
//       presentCount,
//       absentCount,
//       lateCount,
//       presenceRate,
//       pendingLeaves,
//       onLeaveCount:   onLeaveNow.length,

//       // Listes détaillées
//       teamMembers,
//       absentMembers,
//       onLeaveNow,
//       recentLeaveRequests,
//       recentActivity: recentActivity.map(a => ({
//         id:       `att-${a.id}`,
//         type:     'ATTENDANCE',
//         text:     `${a.employee.firstName} ${a.employee.lastName}`,
//         subText:  a.checkOut ? 'Sortie' : a.checkIn ? 'Entrée' : a.status,
//         status:   a.status,
//         checkIn:  a.checkIn,
//         checkOut: a.checkOut,
//         time:     a.checkOut || a.checkIn || a.date
//       }))
//     };
//   }

//   // ============================================================
//   // ✅ GRAPHIQUES (inchangé)
//   // ============================================================
//   async getChartsData(userId: string) {
//     const user = await this.prisma.user.findUnique({
//       where: { id: userId },
//       select: { companyId: true }
//     });

//     if (!user || !user.companyId) {
//       return { salaryTrend: [], deptDistribution: [] };
//     }

//     const companyId = user.companyId;

//     const departments = await this.prisma.department.findMany({
//       where: { companyId },
//       include: { _count: { select: { employees: true } } }
//     });

//     const deptDistribution = departments
//       .map((d: any) => ({
//         name: d.name,
//         value: d._count.employees,
//         color: '#' + Math.floor(Math.random() * 16777215).toString(16)
//       }))
//       .filter((d: any) => d.value > 0);

//     const today = new Date();
//     const salaryTrend: any[] = [];

//     for (let i = 4; i >= 0; i--) {
//       const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
//       const monthName = d.toLocaleString('fr-FR', { month: 'short' });
//       salaryTrend.push({
//         name: monthName.charAt(0).toUpperCase() + monthName.slice(1).replace('.', ''),
//         month: d.getMonth() + 1,
//         year: d.getFullYear(),
//         value: 0,
//         masseSalariale: 0
//       });
//     }

//     const payrolls = await this.prisma.payroll.groupBy({
//       by: ['month', 'year'],
//       where: { companyId },
//       _sum: { netSalary: true, grossSalary: true }
//     });

//     payrolls.forEach((p: any) => {
//       const entry = salaryTrend.find(s => s.month === p.month && s.year === p.year);
//       if (entry) {
//         entry.value         = Number(p._sum.netSalary)  || 0;
//         entry.masseSalariale = Number(p._sum.grossSalary) || 0;
//       }
//     });

//     const cleanTrend = salaryTrend.map(({ month, year, ...rest }) => rest);

//     return { deptDistribution, salaryTrend: cleanTrend };
//   }
// }
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  // ============================================================
  // 🔒 HELPER : récupérer le département du manager
  // ============================================================
  private async getManagerDeptId(
    userId: string,
    companyId: string,
  ): Promise<string | null> {
    const dept = await this.prisma.department.findFirst({
      where: { managerId: userId, companyId },
      select: { id: true, name: true },
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

  // ============================================================
  // ✅ RÉSUMÉ ADMIN / HR / SUPER_ADMIN
  // 🆕 FIX : totalEmployees filtre status: 'ACTIVE' uniquement
  // ============================================================
  async getSummary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user || !user.companyId) return {};

    const companyId = user.companyId;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const lastPayroll = await this.prisma.payroll.findFirst({
      where: { companyId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: { month: true, year: true },
    });

    const currentMonth = lastPayroll?.month || now.getMonth() + 1;
    const currentYear = lastPayroll?.year || now.getFullYear();
    const timeLimit = new Date(Date.now() - 36 * 60 * 60 * 1000);

    // 🆕 FIX : on ne compte que les ACTIFS — avant, TERMINATED étaient inclus
    const totalEmployees = await this.prisma.employee.count({
      where: { companyId, status: 'ACTIVE' },
    });

    const payrollSum = await this.prisma.payroll.aggregate({
      where: { companyId, month: currentMonth, year: currentYear },
      _sum: { grossSalary: true, netSalary: true },
    });

    const attendanceCount = await this.prisma.attendance.count({
      where: { companyId, date: today },
    });

    const absentCount = Math.max(0, totalEmployees - attendanceCount);
    const pendingLeaves = await this.prisma.leave.count({
      where: { companyId, status: 'PENDING' },
    });

    const pendingAbsences = await this.prisma.absenceRequest.count({
      where: { companyId, status: 'PENDING' },
    });
    const pendingPermissions = await this.prisma.permissionTicket.count({
      where: { companyId, status: 'PENDING' },
    });

    const recentPayrolls = await this.prisma.payroll.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 3,
      include: { employee: { select: { firstName: true, lastName: true } } },
    });

    const recentLeaves = await this.prisma.leave.findMany({
      where: { companyId, createdAt: { gte: timeLimit } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { employee: { select: { firstName: true, lastName: true } } },
    });

    const recentAbsenceRequests = await this.prisma.absenceRequest.findMany({
      where: { companyId, createdAt: { gte: timeLimit } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { employee: { select: { firstName: true, lastName: true } } },
    });

    const recentPermissionTickets = await this.prisma.permissionTicket.findMany(
      {
        where: { companyId, createdAt: { gte: timeLimit } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { employee: { select: { firstName: true, lastName: true } } },
      },
    );

    // 🆕 FIX : recentHires filtre aussi ACTIVE pour ne pas afficher les terminés
    const recentHires = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE', createdAt: { gte: timeLimit } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const recentAttendance = await this.prisma.attendance.findMany({
      where: { companyId, updatedAt: { gte: timeLimit } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      include: { employee: { select: { firstName: true, lastName: true } } },
    });

    const activities = [
      ...recentLeaves.map((l: any) => ({
        id: `leave-${l.id}`,
        type: 'LEAVE',
        text: `${l.employee.firstName} a demandé un congé`,
        subText: l.type,
        time: l.createdAt,
      })),
      ...recentAbsenceRequests.map((a: any) => ({
        id: `absence-${a.id}`,
        type: 'ABSENCE',
        text: `${a.employee.firstName} a demandé une autorisation d'absence`,
        subText: a.type,
        time: a.createdAt,
      })),
      ...recentPermissionTickets.map((p: any) => ({
        id: `permission-${p.id}`,
        type: 'PERMISSION',
        text: `${p.employee.firstName} a demandé un ticket de permission`,
        subText: p.type,
        time: p.createdAt,
      })),
      ...recentHires.map((h: any) => ({
        id: `hire-${h.id}`,
        type: 'HIRE',
        text: `Nouvel employé : ${h.firstName} ${h.lastName}`,
        subText: h.position,
        time: h.createdAt,
      })),
      ...recentAttendance.map((a: any) => ({
        id: `att-${a.id}`,
        type: 'ATTENDANCE',
        text: `${a.employee.firstName} a pointé (${a.checkOut ? 'Sortie' : 'Entrée'})`,
        subText: a.checkOut ? 'Fin de journée' : 'Début de journée',
        time: a.checkOut ? a.checkOut : a.checkIn,
      })),
    ]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 12);

    return {
      totalEmployees,
      masseSalariale: payrollSum._sum.grossSalary || 0,
      absentToday: absentCount,
      pendingLeaves,
      pendingAbsences,
      pendingPermissions,
      pendingRequestsTotal:
        pendingLeaves + pendingAbsences + pendingPermissions,
      attendanceRate:
        totalEmployees > 0
          ? Math.round((attendanceCount / totalEmployees) * 100)
          : 0,
      recentPayrolls,
      recentActivities: activities,
    };
  }

  // ============================================================
  // ✅ RÉSUMÉ MANAGER — données filtrées par département
  // (inchangé — filtre déjà status: 'ACTIVE' dans teamMembers)
  // ============================================================
  async getManagerSummary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, email: true },
    });

    if (!user?.companyId) return {};

    const companyId = user.companyId;
    const deptId = await this.getManagerDeptId(userId, companyId);

    if (!deptId) return { error: 'Département non trouvé', teamSize: 0 };

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const dept = await this.prisma.department.findUnique({
      where: { id: deptId },
      select: { name: true },
    });

    // status: 'ACTIVE' déjà présent ici — filtre correct
    const [teamMembers, pendingLeaves, pendingAbsences, pendingPermissions] =
      await Promise.all([
        this.prisma.employee.findMany({
          where: { companyId, departmentId: deptId, status: 'ACTIVE' },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            position: true,
            photoUrl: true,
            contractType: true,
          },
          orderBy: [{ lastName: 'asc' }],
        }),
        this.prisma.leave.count({
          where: {
            companyId,
            status: 'PENDING',
            employee: { departmentId: deptId },
          },
        }),
        this.prisma.absenceRequest.count({
          where: {
            companyId,
            status: 'PENDING',
            employee: { departmentId: deptId },
          },
        }),
        this.prisma.permissionTicket.count({
          where: {
            companyId,
            status: 'PENDING',
            employee: { departmentId: deptId },
          },
        }),
      ]);

    const teamIds = teamMembers.map((e) => e.id);

    const todayAttendances = await this.prisma.attendance.findMany({
      where: { companyId, date: today, employeeId: { in: teamIds } },
      select: { employeeId: true, status: true, checkIn: true, checkOut: true },
    });

    const presentIds = new Set(
      todayAttendances
        .filter((a) => ['PRESENT', 'LATE', 'REMOTE'].includes(a.status))
        .map((a) => a.employeeId),
    );
    const lateIds = new Set(
      todayAttendances
        .filter((a) => a.status === 'LATE')
        .map((a) => a.employeeId),
    );

    const presentCount = presentIds.size;
    const absentCount = teamMembers.length - presentCount;
    const lateCount = lateIds.size;
    const presenceRate =
      teamMembers.length > 0
        ? Math.round((presentCount / teamMembers.length) * 100)
        : 0;

    const absentMembers = teamMembers
      .filter((emp) => !presentIds.has(emp.id))
      .map((emp) => {
        const att = todayAttendances.find((a) => a.employeeId === emp.id);
        return {
          id: emp.id,
          firstName: emp.firstName,
          lastName: emp.lastName,
          position: emp.position,
          photoUrl: emp.photoUrl,
          status: att?.status || 'ABSENT_UNPAID',
        };
      });

    const onLeaveNow = await this.prisma.leave.findMany({
      where: {
        companyId,
        status: 'APPROVED',
        startDate: { lte: now },
        endDate: { gte: now },
        employee: { departmentId: deptId },
      },
      select: {
        id: true,
        type: true,
        startDate: true,
        endDate: true,
        employee: {
          select: { firstName: true, lastName: true, position: true },
        },
      },
    });

    const recentLeaveRequests = await this.prisma.leave.findMany({
      where: {
        companyId,
        employee: { departmentId: deptId },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        type: true,
        status: true,
        startDate: true,
        endDate: true,
        daysCount: true,
        createdAt: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });

    const recentActivity = await this.prisma.attendance.findMany({
      where: {
        companyId,
        employeeId: { in: teamIds },
        updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        status: true,
        checkIn: true,
        checkOut: true,
        date: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });

    return {
      departmentName: dept?.name || 'Mon Département',
      teamSize: teamMembers.length,
      presentCount,
      absentCount,
      lateCount,
      presenceRate,
      pendingLeaves,
      pendingAbsences,
      pendingPermissions,
      pendingRequestsTotal:
        pendingLeaves + pendingAbsences + pendingPermissions,
      onLeaveCount: onLeaveNow.length,
      teamMembers,
      absentMembers,
      onLeaveNow,
      recentLeaveRequests,
      recentActivity: recentActivity.map((a) => ({
        id: `att-${a.id}`,
        type: 'ATTENDANCE',
        text: `${a.employee.firstName} ${a.employee.lastName}`,
        subText: a.checkOut ? 'Sortie' : a.checkIn ? 'Entrée' : a.status,
        status: a.status,
        checkIn: a.checkIn,
        checkOut: a.checkOut,
        time: a.checkOut || a.checkIn || a.date,
      })),
    };
  }

  // ============================================================
  // ✅ GRAPHIQUES
  // 🆕 FIX : deptDistribution compte uniquement les ACTIVE
  // ============================================================
  async getChartsData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user || !user.companyId)
      return { salaryTrend: [], deptDistribution: [] };

    const companyId = user.companyId;

    const departments = await this.prisma.department.findMany({
      where: { companyId },
      include: {
        // 🆕 FIX : compter uniquement les employés ACTIFS par département
        employees: {
          where: { status: 'ACTIVE' },
          select: { id: true },
        },
      },
    });

    const deptDistribution = departments
      .map((d: any) => ({
        name: d.name,
        value: d.employees.length, // nombre d'ACTIFS seulement
        color:
          '#' +
          Math.floor(Math.random() * 16777215)
            .toString(16)
            .padStart(6, '0'),
      }))
      .filter((d: any) => d.value > 0);

    const today = new Date();
    const salaryTrend: any[] = [];

    for (let i = 4; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthName = d.toLocaleString('fr-FR', { month: 'short' });
      salaryTrend.push({
        name:
          monthName.charAt(0).toUpperCase() +
          monthName.slice(1).replace('.', ''),
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        value: 0,
        masseSalariale: 0,
      });
    }

    const payrolls = await this.prisma.payroll.groupBy({
      by: ['month', 'year'],
      where: { companyId },
      _sum: { netSalary: true, grossSalary: true },
    });

    payrolls.forEach((p: any) => {
      const entry = salaryTrend.find(
        (s) => s.month === p.month && s.year === p.year,
      );
      if (entry) {
        entry.value = Number(p._sum.netSalary) || 0;
        entry.masseSalariale = Number(p._sum.grossSalary) || 0;
      }
    });

    const cleanTrend = salaryTrend.map(({ month, year, ...rest }) => rest);
    return { deptDistribution, salaryTrend: cleanTrend };
  }

  async getPendingRequestsCount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true },
    });
    if (!user?.companyId)
      return { leaves: 0, absences: 0, permissions: 0, total: 0 };

    let deptFilter: any = {};
    if (user.role === 'MANAGER') {
      const deptId = await this.getManagerDeptId(userId, user.companyId);
      if (!deptId) return { leaves: 0, absences: 0, permissions: 0, total: 0 };
      deptFilter = { employee: { departmentId: deptId } };
    }

    const [leaves, absences, permissions] = await Promise.all([
      this.prisma.leave.count({
        where: { companyId: user.companyId, status: 'PENDING', ...deptFilter },
      }),
      this.prisma.absenceRequest.count({
        where: { companyId: user.companyId, status: 'PENDING', ...deptFilter },
      }),
      this.prisma.permissionTicket.count({
        where: { companyId: user.companyId, status: 'PENDING', ...deptFilter },
      }),
    ]);

    return {
      leaves,
      absences,
      permissions,
      total: leaves + absences + permissions,
    };
  }
}
