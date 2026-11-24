// ============================================================================
// 📁 src/echelon-suggestions/echelon-suggestions.service.ts
//
// Suggestions de changement d'échelon — jamais automatique. Le RH garde
// toujours la décision finale (valider / refuser, individuellement ou en
// masse). Rien ne se passe si Company.echelonReminderEnabled === false.
// ============================================================================

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  getEchelonProgressionConfig,
  computeTargetEchelonIndex,
} from '../conventions/echelon-progression.config';
import {
  parseEchelonIndex,
  formatEchelonLabel,
} from '../common/utils/echelon.util';
import {
  EchelonSuggestionView,
  EchelonBulkAcceptResultItem,
} from './dto/echelon-suggestion.dto';

/** Nombre max de notifications RH envoyées par jour pour l'étalement. */
const DAILY_NOTIFY_BATCH_SIZE = 5;

@Injectable()
export class EchelonSuggestionsService {
  private readonly logger = new Logger(EchelonSuggestionsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════
  // ▼ GÉNÉRATION (appelée par le cron mensuel — voir echelon-suggestions.cron.ts)
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Parcourt toutes les entreprises ayant activé le rappel d'échelon,
   * détecte les employés ayant franchi un palier d'ancienneté ce mois-ci
   * (ou dont une suggestion précédente n'a jamais été traitée), et
   * crée/actualise les lignes PENDING correspondantes — sans notifier
   * personne à ce stade (l'étalement se fait juste après).
   */
  async generateSuggestionsForCurrentMonth(): Promise<void> {
    const companies = await this.prisma.company.findMany({
      where: {
        echelonReminderEnabled: true,
        collectiveAgreement: { not: null },
        isActive: true,
      },
      select: { id: true, collectiveAgreement: true },
    });

    for (const company of companies) {
      const cfg = getEchelonProgressionConfig(company.collectiveAgreement);
      if (!cfg) continue; // convention sans règle d'échelon gérée → on ignore

      await this._generateForCompany(company.id, company.collectiveAgreement!, cfg);
    }

    // Une fois toutes les entreprises traitées, on étale les notifications
    // à envoyer sur les jours du mois (voir _scheduleNotifications).
    await this._scheduleNotifications();
  }

  private async _generateForCompany(
    companyId: string,
    conventionCode: string,
    cfg: { stepYears: number; maxEchelonIndex: number },
  ): Promise<void> {
    const now = new Date();
    const currentMonth = now.getMonth();

    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, hireDate: true, echelon: true },
    });

    for (const emp of employees) {
      const hire = new Date(emp.hireDate);
      if (hire.getMonth() !== currentMonth) continue; // pas son mois anniversaire

      let yearsCompleted = now.getFullYear() - hire.getFullYear();
      if (now.getDate() < hire.getDate()) yearsCompleted -= 1;
      if (yearsCompleted <= 0) continue;

      // Palier atteint uniquement les années multiples de stepYears (Art.22 : tous les 2 ans)
      if (yearsCompleted % cfg.stepYears !== 0) continue;

      const currentIndex = parseEchelonIndex(emp.echelon);
      const targetIndex = computeTargetEchelonIndex(yearsCompleted, cfg);
      if (targetIndex <= currentIndex) continue; // déjà à jour ou plafond atteint

      const anniversaryDate = new Date(now.getFullYear(), hire.getMonth(), hire.getDate());

      // Une suggestion PENDING déjà en attente pour cet employé (ignorée un
      // mois précédent) est mise à jour plutôt que dupliquée — c'est ce qui
      // fait qu'elle "repasse le mois suivant" au lieu de s'empiler.
      const existing = await this.prisma.echelonSuggestion.findFirst({
        where: { employeeId: emp.id, status: 'PENDING' },
      });

      if (existing) {
        await this.prisma.echelonSuggestion.update({
          where: { id: existing.id },
          data: {
            suggestedEchelonIndex: targetIndex,
            yearsCompleted,
            anniversaryDate,
            // scheduledNotifyDate réassignée par _scheduleNotifications()
            notifiedAt: null,
          },
        });
      } else {
        await this.prisma.echelonSuggestion.create({
          data: {
            employeeId: emp.id,
            companyId,
            conventionCode,
            currentEchelonIndex: currentIndex,
            suggestedEchelonIndex: targetIndex,
            yearsCompleted,
            anniversaryDate,
            scheduledNotifyDate: now, // provisoire, réassignée juste après
          },
        });
      }
    }
  }

  /**
   * Étale les notifications RH sur les jours du mois — jamais tout le monde
   * le même jour. Reprend TOUTES les suggestions PENDING non encore
   * notifiées (nouvelles + celles reportées du mois précédent), groupées
   * par entreprise, et leur assigne une date d'envoi répartie sur les jours
   * ouvrés à venir, à raison de DAILY_NOTIFY_BATCH_SIZE par jour.
   */
  private async _scheduleNotifications(): Promise<void> {
    const toSchedule = await this.prisma.echelonSuggestion.findMany({
      where: { status: 'PENDING', notifiedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, companyId: true },
    });

    const byCompany = new Map<string, string[]>();
    for (const s of toSchedule) {
      const list = byCompany.get(s.companyId) ?? [];
      list.push(s.id);
      byCompany.set(s.companyId, list);
    }

    for (const [, ids] of byCompany) {
      let dayCursor = this._nextBusinessDay(new Date());
      for (let i = 0; i < ids.length; i++) {
        if (i > 0 && i % DAILY_NOTIFY_BATCH_SIZE === 0) {
          dayCursor = this._nextBusinessDay(dayCursor);
        }
        await this.prisma.echelonSuggestion.update({
          where: { id: ids[i] },
          data: { scheduledNotifyDate: dayCursor },
        });
      }
    }
  }

  private _nextBusinessDay(from: Date): Date {
    const d = new Date(from);
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day === 0) d.setDate(d.getDate() + 1); // dimanche → lundi
    if (day === 6) d.setDate(d.getDate() + 2); // samedi → lundi
    return d;
  }

  // ══════════════════════════════════════════════════════════════════════
  // ▼ ENVOI DES NOTIFICATIONS DU JOUR (appelé par le cron quotidien)
  // ══════════════════════════════════════════════════════════════════════

  async sendDueNotifications(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const due = await this.prisma.echelonSuggestion.findMany({
      where: {
        status: 'PENDING',
        notifiedAt: null,
        scheduledNotifyDate: { gte: today, lt: tomorrow },
      },
      include: { employee: { select: { firstName: true, lastName: true, hireDate: true } } },
    });

    for (const s of due) {
      const name = `${s.employee.firstName} ${s.employee.lastName}`;
      await this.notifications.createForGroup(s.companyId, ['ADMIN', 'HR_MANAGER'], {
        type: 'SYSTEM_ALERT',
        title: "Changement d'échelon à valider",
        message: `${name} a atteint ${s.yearsCompleted} ans d'ancienneté — passage suggéré de ${formatEchelonLabel(s.currentEchelonIndex)} à ${formatEchelonLabel(s.suggestedEchelonIndex)}.`,
        link: '/parametres/conventions/echelons',
        metadata: { echelonSuggestionId: s.id, employeeId: s.employeeId },
      });

      await this.prisma.echelonSuggestion.update({
        where: { id: s.id },
        data: { notifiedAt: new Date() },
      });
    }

    if (due.length > 0) {
      this.logger.log(`✅ ${due.length} rappel(s) d'échelon notifié(s) aujourd'hui`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ▼ CONSULTATION / DÉCISION RH
  // ══════════════════════════════════════════════════════════════════════

  async listPending(companyId: string): Promise<EchelonSuggestionView[]> {
    const rows = await this.prisma.echelonSuggestion.findMany({
      where: { companyId, status: 'PENDING' },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { scheduledNotifyDate: 'asc' },
    });

    return rows.map((s) => ({
      id: s.id,
      employeeId: s.employeeId,
      employeeName: `${s.employee.firstName} ${s.employee.lastName}`,
      conventionCode: s.conventionCode,
      currentEchelonIndex: s.currentEchelonIndex,
      currentEchelonLabel: formatEchelonLabel(s.currentEchelonIndex),
      suggestedEchelonIndex: s.suggestedEchelonIndex,
      suggestedEchelonLabel: formatEchelonLabel(s.suggestedEchelonIndex),
      yearsCompleted: s.yearsCompleted,
      anniversaryDate: s.anniversaryDate,
      scheduledNotifyDate: s.scheduledNotifyDate,
      status: s.status,
    }));
  }

  /** Valide une suggestion : met à jour Employee.echelon. Décision RH finale. */
  async accept(suggestionId: string, companyId: string, userId: string) {
    const s = await this._getOwnedPending(suggestionId, companyId);

    await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id: s.employeeId },
        data: { echelon: String(s.suggestedEchelonIndex) },
      }),
      this.prisma.echelonSuggestion.update({
        where: { id: s.id },
        data: { status: 'ACCEPTED', decidedAt: new Date(), decidedById: userId },
      }),
    ]);

    return { success: true };
  }

  /** Refuse une suggestion : l'échelon actuel est conservé, décision tracée. */
  async reject(suggestionId: string, companyId: string, userId: string) {
    const s = await this._getOwnedPending(suggestionId, companyId);

    await this.prisma.echelonSuggestion.update({
      where: { id: s.id },
      data: { status: 'REJECTED', decidedAt: new Date(), decidedById: userId },
    });

    return { success: true };
  }

  /**
   * "Tout valider" — bascule en une fois toutes les suggestions PENDING de
   * l'entreprise (pas seulement celles déjà notifiées). Retourne la liste
   * pour le récapitulatif (toast/modal) affiché côté front.
   */
  async acceptAll(
    companyId: string,
    userId: string,
  ): Promise<EchelonBulkAcceptResultItem[]> {
    const pending = await this.prisma.echelonSuggestion.findMany({
      where: { companyId, status: 'PENDING' },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });

    if (pending.length === 0) return [];

    const result: EchelonBulkAcceptResultItem[] = [];

    for (const s of pending) {
      await this.prisma.$transaction([
        this.prisma.employee.update({
          where: { id: s.employeeId },
          data: { echelon: String(s.suggestedEchelonIndex) },
        }),
        this.prisma.echelonSuggestion.update({
          where: { id: s.id },
          data: { status: 'ACCEPTED', decidedAt: new Date(), decidedById: userId },
        }),
      ]);

      result.push({
        employeeId: s.employeeId,
        employeeName: `${s.employee.firstName} ${s.employee.lastName}`,
        oldEchelonLabel: formatEchelonLabel(s.currentEchelonIndex),
        newEchelonLabel: formatEchelonLabel(s.suggestedEchelonIndex),
      });
    }

    this.logger.log(`✅ ${result.length} échelon(s) mis à jour en masse pour company ${companyId}`);
    return result;
  }

  // ── Helper ────────────────────────────────────────────────────────────

  private async _getOwnedPending(suggestionId: string, companyId: string) {
    const s = await this.prisma.echelonSuggestion.findFirst({
      where: { id: suggestionId, companyId },
    });
    if (!s) throw new NotFoundException('Suggestion introuvable');
    if (s.status !== 'PENDING') {
      throw new BadRequestException('Cette suggestion a déjà été traitée');
    }
    return s;
  }
}