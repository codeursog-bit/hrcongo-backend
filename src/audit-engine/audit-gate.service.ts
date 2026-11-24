// ============================================================================
// 📁 src/audit-engine/audit-gate.service.ts
// Barrière à la validation de la paie : lance le contrôle sur les bulletins
// concernés et refuse la validation s'il reste un écart BLOQUANT ouvert.
//
// AUDIT_GATE_MODE (variable d'environnement) :
//   enforce  → refus 422 AUDIT_BLOCKED avec la liste des écarts
//   observe  → (défaut) on contrôle, on enregistre les écarts et un événement
//              d'audit, mais on laisse valider. À utiliser le temps de vérifier
//              les écarts sur vos vraies données, puis passer en « enforce ».
// ============================================================================
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditActor, AuditTrailService } from '../audit-trail/audit-trail.service';
import { AuditEngineService } from './audit-engine.service';

export type GateMode = 'enforce' | 'observe';

@Injectable()
export class AuditGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: AuditEngineService,
    private readonly audit: AuditTrailService,
  ) {}

  mode(): GateMode {
    return process.env.AUDIT_GATE_MODE === 'enforce' ? 'enforce' : 'observe';
  }

  /**
   * À appeler AVANT de passer des bulletins en VALIDATED.
   * `companyId` doit déjà être vérifié (jamais celui du client).
   */
  async assertCanValidate(args: { companyId: string; payrollIds: string[]; actor: AuditActor | null }) {
    const { companyId, payrollIds, actor } = args;
    if (payrollIds.length === 0) return { blocked: false, openBlocking: 0, mode: this.mode() };

    await this.engine.run(companyId, { payrollIds, trigger: 'GATE', actor });

    const payrolls = await this.prisma.payroll.findMany({
      where: { id: { in: payrollIds }, companyId },
      select: { id: true, employeeId: true },
    });
    const where = {
      companyId, status: 'OPEN' as const, blocking: true,
      OR: [
        { entity: 'PAYROLL', entityId: { in: payrolls.map((p) => p.id) } },
        { periodYear: null, employeeId: { in: [...new Set(payrolls.map((p) => p.employeeId))] } },
      ],
    };
    const [total, sample] = await Promise.all([
      this.prisma.auditFinding.count({ where }),
      this.prisma.auditFinding.findMany({
        where, orderBy: [{ severity: 'desc' }, { lastDetectedAt: 'desc' }], take: 50,
        select: { id: true, ruleCode: true, severity: true, message: true, expected: true, actual: true, entity: true, entityId: true, employeeId: true },
      }),
    ]);
    if (total === 0) return { blocked: false, openBlocking: 0, mode: this.mode() };

    if (this.mode() === 'enforce') {
      throw new UnprocessableEntityException({
        error: 'AUDIT_BLOCKED',
        message: `Validation refusée : ${total} écart${total > 1 ? 's' : ''} bloquant${total > 1 ? 's' : ''} à traiter. Corrigez-les ou faites-les justifier par un administrateur.`,
        total,
        findings: sample,
      });
    }

    await this.audit.record(this.prisma, {
      companyId, actor,
      action: 'PAYROLL_VALIDATED_WITH_OPEN_FINDINGS', entity: 'PAYROLL',
      entityId: payrollIds.length === 1 ? payrollIds[0] : null, severity: 'WARN',
      summary: `Validation autorisée en mode observation malgré ${total} écart(s) bloquant(s) ouvert(s) (${payrollIds.length} bulletin(s))`,
    });
    return { blocked: false, openBlocking: total, mode: this.mode() };
  }
}