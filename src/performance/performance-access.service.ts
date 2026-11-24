// ============================================================================
// 📄 src/performance/performance-access.service.ts
// 🔒 Point UNIQUE de contrôle d'accès du module performance (phase 0)
//
// Règles :
//   • RH / Admin (+ cabinet vérifié)  → toute l'entreprise
//   • MANAGER                         → les employés des départements dont il est
//                                       Department.managerId (même logique que
//                                       attendance / training / absences)
//   • EMPLOYEE (ou tout rôle sur soi) → uniquement ses propres données
// Le lien User → Employee passe par User.employeeId (repli : email).
// ============================================================================

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
import { resolveVerifiedCompanyId } from '../common/resolve-verified-company.util';
import { asOptUuid, asUuid } from './performance-validation.util';

/** Rôles qui gèrent la performance de toute l'entreprise */
export const PERF_HR_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'HR_MANAGER',
  'CABINET_ADMIN',
  'CABINET_GESTIONNAIRE',
];
/** Rôles autorisés à rédiger des évaluations / fixer des objectifs */
export const PERF_MANAGE_ROLES = [...PERF_HR_ROLES, 'MANAGER'];

export interface PerfCtx {
  userId: string;
  role: string;
  email: string;
  companyId: string;
  employeeId: string | null;
  isHR: boolean;
  isManager: boolean;
}

export interface AccessibleEmployee {
  id: string;
  companyId: string;
  email: string;
  firstName: string;
  lastName: string;
  position: string;
  departmentId: string;
  department: { managerId: string | null } | null;
}

@Injectable()
export class PerformanceAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionGuard: SubscriptionGuard,
  ) {}

  // ── Contexte de l'appelant ────────────────────────────────────────────────
  async getCtx(userId: string, requestedCompanyId?: unknown): Promise<PerfCtx> {
    // 🔒 L'identifiant d'entreprise demandé vient du client (?companyId=…).
    // On exige une chaîne UUID : un objet (?companyId[not]=x) serait sinon
    // transmis tel quel à Prisma comme filtre et porterait sur d'autres entreprises.
    const wanted = asOptUuid(requestedCompanyId, 'companyId');

    const user = await this.prisma.user.findUnique({
      where: { id: asUuid(userId, 'Utilisateur') },
      select: {
        id: true,
        role: true,
        email: true,
        companyId: true,
        employeeId: true,
        isActive: true,
        manageMultipleCompanies: true,
      },
    });
    // Le rôle est relu en base à chaque appel (le jeton peut être périmé :
    // utilisateur rétrogradé ou désactivé après l'émission du jeton).
    if (!user || user.isActive === false)
      throw new ForbiddenException('Accès refusé');

    const companyId = await resolveVerifiedCompanyId(
      this.prisma,
      user as any,
      wanted,
    );
    if (!companyId) throw new ForbiddenException('Accès refusé');

    let employeeId: string | null = user.employeeId ?? null;
    if (employeeId) {
      // Le lien doit pointer vers un employé de l'entreprise courante
      const linked = await this.prisma.employee.findFirst({
        where: { id: employeeId, companyId },
        select: { id: true },
      });
      if (!linked) employeeId = null;
    } else if (user.companyId === companyId) {
      // Repli par e-mail, strictement encadré : uniquement dans SA propre
      // entreprise, et seulement si cet employé n'est lié à aucun autre compte.
      const emp = await this.prisma.employee.findFirst({
        where: { email: user.email, companyId },
        select: { id: true },
      });
      if (emp) {
        const taken = await this.prisma.user.findFirst({
          where: { employeeId: emp.id, id: { not: user.id } },
          select: { id: true },
        });
        if (!taken) employeeId = emp.id;
      }
    }

    return {
      userId: user.id,
      role: user.role as string,
      email: user.email,
      companyId,
      employeeId,
      isHR: PERF_HR_ROLES.includes(user.role as string),
      isManager: user.role === 'MANAGER',
    };
  }

  async assertFeature(ctx: PerfCtx) {
    await this.subscriptionGuard.checkFeatureAccess(
      ctx.companyId,
      'hasPerformanceReviews',
    );
  }

  assertHR(ctx: PerfCtx) {
    if (!ctx.isHR)
      throw new ForbiddenException('Réservé aux RH et administrateurs');
  }

  assertCanManage(ctx: PerfCtx) {
    if (!ctx.isHR && !ctx.isManager)
      throw new ForbiddenException('Accès refusé');
  }

  // ── Périmètre manager ─────────────────────────────────────────────────────
  /** IDs des employés dont l'appelant (MANAGER) est le chef de département */
  async managedEmployeeIds(ctx: PerfCtx): Promise<string[]> {
    if (!ctx.isManager) return [];
    const deps = await this.prisma.department.findMany({
      where: { managerId: ctx.userId, companyId: ctx.companyId },
      select: { id: true },
    });
    if (!deps.length) return [];
    const emps = await this.prisma.employee.findMany({
      where: {
        companyId: ctx.companyId,
        departmentId: { in: deps.map((d) => d.id) },
        ...(ctx.employeeId && { id: { not: ctx.employeeId } }),
      },
      select: { id: true },
    });
    return emps.map((e) => e.id);
  }

  /**
   * Filtre Prisma `employee` correspondant à ce que l'appelant a le droit de
   * superviser (jamais utilisé pour un EMPLOYEE simple : voir selfOnly).
   */
  async superviseWhere(ctx: PerfCtx): Promise<Record<string, any>> {
    if (ctx.isHR) return { companyId: ctx.companyId };
    if (ctx.isManager) {
      const ids = await this.managedEmployeeIds(ctx);
      return { companyId: ctx.companyId, id: { in: ids } };
    }
    return { companyId: ctx.companyId, id: ctx.employeeId ?? 'none' };
  }

  // ── Accès à un employé ────────────────────────────────────────────────────
  async loadEmployee(ctx: PerfCtx, employeeId: string) {
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        companyId: true,
        email: true,
        firstName: true,
        lastName: true,
        position: true,
        departmentId: true,
        department: { select: { managerId: true } },
      },
    });
    // Autre entreprise → on ne révèle pas l'existence
    if (!emp || emp.companyId !== ctx.companyId)
      throw new NotFoundException('Employé introuvable');
    return emp as AccessibleEmployee;
  }

  isSelf(ctx: PerfCtx, employeeId: string) {
    return !!ctx.employeeId && ctx.employeeId === employeeId;
  }

  isSupervisorOf(ctx: PerfCtx, emp: AccessibleEmployee) {
    if (this.isSelf(ctx, emp.id)) return false;
    if (ctx.isHR) return true;
    return ctx.isManager && emp.department?.managerId === ctx.userId;
  }

  /** Peut fixer des objectifs / rédiger des évaluations pour cet employé */
  async assertCanManageEmployee(ctx: PerfCtx, employeeId: string) {
    const emp = await this.loadEmployee(ctx, employeeId);
    if (!this.isSupervisorOf(ctx, emp))
      throw new ForbiddenException(
        "Vous n'avez pas accès à cet employé",
      );
    return emp;
  }

  /** Peut consulter les données de cet employé (soi-même, supérieur, RH) */
  async assertCanViewEmployee(ctx: PerfCtx, employeeId: string) {
    const emp = await this.loadEmployee(ctx, employeeId);
    if (!this.isSelf(ctx, emp.id) && !this.isSupervisorOf(ctx, emp))
      throw new ForbiddenException("Vous n'avez pas accès à cet employé");
    return emp;
  }

  // ── Accès à une évaluation ────────────────────────────────────────────────
  /** Rédaction : RH, ou le reviewer désigné (qui doit rester superviseur de l'employé) */
  canWriteReview(
    ctx: PerfCtx,
    review: { reviewerId: string; employeeId: string; employee: AccessibleEmployee },
  ): boolean {
    if (this.isSelf(ctx, review.employeeId)) return false;
    if (ctx.isHR) return true;
    // 🔒 Un manager n'écrit que sur les employés qu'il supervise ACTUELLEMENT
    // (département dont il est responsable) — être l'ancien évaluateur ne suffit
    // plus après un changement de service ou de responsable.
    return ctx.isManager && review.employee.department?.managerId === ctx.userId;
  }
}