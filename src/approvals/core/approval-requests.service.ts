// ============================================================================
// 📁 src/approvals/core/approval-requests.service.ts — LOT B + LOT C + LOT E
// Lecture NORMALISÉE des demandes (prêts / avances / absences / congés) — lecture seule,
// aucune écriture : l'existant n'est jamais modifié ici.
// ============================================================================

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalRequestType } from '../approvals.constants';

export interface RequestSummary {
  type: ApprovalRequestType;
  id: string;
  status: string;
  companyId: string;
  employeeId: string;
  employeeName: string;
  // Montant (prêts / avances). null pour les absences.
  amount: number | null;
  // Résumé lisible : "120 000 FCFA" ou "3 jour(s) du 12/10/2026 au 14/10/2026"
  detail: string;
  createdAt: Date;
  reason: string | null;
  // "prêt" | "avance" | "absence" | "congé"
  noun: string;
}

const fmtMoney = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} FCFA`;
const fmtDay = (d: Date) => new Date(d).toLocaleDateString('fr-FR');

@Injectable()
export class ApprovalRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRequestOrThrow(
    type: ApprovalRequestType,
    id: string,
    companyId: string,
  ): Promise<RequestSummary> {
    if (type === 'LOAN') {
      const loan = await this.prisma.loan.findFirst({
        where: { id, employee: { companyId } },
        select: {
          id: true, status: true, amount: true, createdAt: true, reason: true, employeeId: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      });
      if (!loan) throw new NotFoundException('Prêt introuvable');
      return this.fromMoney('LOAN', 'prêt', companyId, loan);
    }
    if (type === 'ADVANCE') {
      const adv = await this.prisma.advance.findFirst({
        where: { id, employee: { companyId } },
        select: {
          id: true, status: true, amount: true, createdAt: true, reason: true, employeeId: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      });
      if (!adv) throw new NotFoundException('Avance introuvable');
      return this.fromMoney('ADVANCE', 'avance', companyId, adv);
    }
    if (type === 'ABSENCE') {
      const abs = await this.prisma.absenceRequest.findFirst({
        where: { id, companyId },
        select: {
          id: true, status: true, workingDays: true, startDate: true, endDate: true,
          createdAt: true, reason: true, employeeId: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      });
      if (!abs) throw new NotFoundException('Demande d’absence introuvable');
      return this.fromAbsence(companyId, abs);
    }
    if (type === 'LEAVE') {
      const lv = await this.prisma.leave.findFirst({
        where: { id, companyId },
        select: {
          id: true, status: true, daysCount: true, startDate: true, endDate: true,
          createdAt: true, reason: true, employeeId: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      });
      if (!lv) throw new NotFoundException('Demande de congé introuvable');
      return this.fromLeave(companyId, lv);
    }
    throw new BadRequestException('Type de demande non pris en charge');
  }

  /** Une demande est "en attente" tant que son statut existant est PENDING. */
  isPending(summary: RequestSummary): boolean {
    return summary.status === 'PENDING';
  }

  async listPending(
    type: ApprovalRequestType,
    companyId: string,
    take = 100,
  ): Promise<RequestSummary[]> {
    if (type === 'LOAN') {
      const rows = await this.prisma.loan.findMany({
        where: { status: 'PENDING', employee: { companyId } },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true, status: true, amount: true, createdAt: true, reason: true, employeeId: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      });
      return rows.map((r) => this.fromMoney('LOAN', 'prêt', companyId, r));
    }
    if (type === 'ADVANCE') {
      const rows = await this.prisma.advance.findMany({
        where: { status: 'PENDING', employee: { companyId } },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true, status: true, amount: true, createdAt: true, reason: true, employeeId: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      });
      return rows.map((r) => this.fromMoney('ADVANCE', 'avance', companyId, r));
    }
    if (type === 'LEAVE') {
      const rows = await this.prisma.leave.findMany({
        where: { status: 'PENDING', companyId },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true, status: true, daysCount: true, startDate: true, endDate: true,
          createdAt: true, reason: true, employeeId: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      });
      return rows.map((r) => this.fromLeave(companyId, r));
    }
    const rows = await this.prisma.absenceRequest.findMany({
      where: { status: 'PENDING', companyId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, status: true, workingDays: true, startDate: true, endDate: true,
        createdAt: true, reason: true, employeeId: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    return rows.map((r) => this.fromAbsence(companyId, r));
  }

  // ── Normalisation ─────────────────────────────────────────────────────────
  private fromMoney(
    type: 'LOAN' | 'ADVANCE',
    noun: string,
    companyId: string,
    r: any,
  ): RequestSummary {
    const amount = Number(r.amount);
    return {
      type,
      id: r.id,
      status: r.status as string,
      companyId,
      employeeId: r.employeeId,
      employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
      amount,
      detail: fmtMoney(amount),
      createdAt: r.createdAt,
      reason: r.reason ?? null,
      noun,
    };
  }

  private fromLeave(companyId: string, r: any): RequestSummary {
    const days = Number(r.daysCount);
    return {
      type: 'LEAVE',
      id: r.id,
      status: r.status as string,
      companyId,
      employeeId: r.employeeId,
      employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
      amount: null,
      detail: `${Math.round(days * 10) / 10} jour(s) du ${fmtDay(r.startDate)} au ${fmtDay(r.endDate)}`,
      createdAt: r.createdAt,
      reason: r.reason ?? null,
      noun: 'congé',
    };
  }

  private fromAbsence(companyId: string, r: any): RequestSummary {
    const days = Number(r.workingDays);
    return {
      type: 'ABSENCE',
      id: r.id,
      status: r.status as string,
      companyId,
      employeeId: r.employeeId,
      employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
      amount: null,
      detail: `${days} jour(s) du ${fmtDay(r.startDate)} au ${fmtDay(r.endDate)}`,
      createdAt: r.createdAt,
      reason: r.reason ?? null,
      noun: 'absence',
    };
  }
}
