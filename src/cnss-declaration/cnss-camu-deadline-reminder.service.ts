// ============================================================================
// 📁 src/cnss-declaration/cnss-camu-deadline-reminder.service.ts
//
// Rappel automatique : les déclarations CNSS ET CAMU du mois précédent
// doivent être déposées au plus tard le 15 du mois en cours.
//
// Fenêtre de rappel : du 10 au 15 (rappel), puis du 16 au 25 (retard) —
// tourne une fois par jour. Anti-doublon via NotificationsService.tryClaim,
// même mécanisme que unpaid-salary.service.ts et leaves-balance.service.ts
// (voir leur en-tête pour le contexte : lire une notification la SUPPRIME,
// donc on ne peut pas se fier à la table `notifications` elle-même pour
// savoir "déjà notifié ce mois-ci" — on utilise un registre séparé, jamais
// supprimé par une action utilisateur).
//
// CNSS : on sait vérifier si la déclaration du mois a déjà été faite
// (CnssDeclaration.status) — si oui, pas de rappel.
// CAMU : géré comme une simple taxe custom (CompanyTax, code "CAMU"), sans
// suivi de statut de dépôt dédié — on ne peut donc pas savoir si elle a déjà
// été déclarée. Le rappel CAMU est envoyé à toute entreprise qui a la taxe
// CAMU active, indépendamment d'un statut (comme le rappel "salaires à
// payer" pour le paiement des salaires).
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const DEADLINE_DAY = 15;
const REMINDER_START_DAY = 10; // début des rappels (5 jours avant l'échéance)
const OVERDUE_END_DAY = 25; // au-delà, on arrête de spammer (le mois suivant prendra le relais)

const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

@Injectable()
export class CnssCamuDeadlineReminderService {
  private readonly logger = new Logger(CnssCamuDeadlineReminderService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  @Cron('0 8 * * *', { timeZone: 'Africa/Brazzaville' })
  async checkDeadlines() {
    const today = new Date();
    const day = today.getDate();

    if (day < REMINDER_START_DAY || day > OVERDUE_END_DAY) return; // hors fenêtre

    const daysLeft = DEADLINE_DAY - day; // >0 = avant échéance, <0 = en retard

    // Période concernée : mois précédent (la déclaration du 15 août porte
    // sur les salaires de juillet)
    const thisMonth = today.getMonth() + 1;
    const thisYear = today.getFullYear();
    const period = thisMonth === 1
      ? { month: 12, year: thisYear - 1 }
      : { month: thisMonth - 1, year: thisYear };
    const periodLabel = `${MONTHS_FR[period.month - 1]} ${period.year}`;
    const periodKey = `${period.year}-${String(period.month).padStart(2, '0')}`;

    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    for (const company of companies) {
      await this.checkCompany(company.id, period, periodLabel, periodKey, daysLeft)
        .catch((err) =>
          this.logger.error(`Erreur rappel CNSS/CAMU company ${company.id}: ${err.message}`),
        );
    }
  }

  private async checkCompany(
    companyId: string,
    period: { month: number; year: number },
    periodLabel: string,
    periodKey: string,
    daysLeft: number,
  ) {
    // ─── CNSS ────────────────────────────────────────────────────────────
    const cnssDeclaration = await this.prisma.cnssDeclaration.findFirst({
      where: { companyId, month: period.month, year: period.year },
      select: { status: true },
    });
    const cnssAlreadyDone =
      cnssDeclaration &&
      ['DECLAREE', 'PAYEE', 'REGULARISEE'].includes(cnssDeclaration.status);

    if (!cnssAlreadyDone) {
      const claimed = await this.notifications.tryClaim(
        `cnss-deadline:${companyId}:${periodKey}`,
      );
      if (claimed) {
        await this.sendReminder(
          companyId,
          'CNSS',
          periodLabel,
          daysLeft,
          '/cnss-declaration',
        );
      }
    }

    // ─── CAMU ────────────────────────────────────────────────────────────
    // Pas de suivi de statut dédié (voir en-tête du fichier) → on rappelle
    // seulement si l'entreprise a la taxe CAMU active.
    const camuTax = await this.prisma.companyTax.findFirst({
      where: { companyId, code: 'CAMU', isActive: true },
      select: { id: true },
    });

    if (camuTax) {
      const claimed = await this.notifications.tryClaim(
        `camu-deadline:${companyId}:${periodKey}`,
      );
      if (claimed) {
        await this.sendReminder(
          companyId,
          'CAMU',
          periodLabel,
          daysLeft,
          '/parametres/taxes',
        );
      }
    }
  }

  private async sendReminder(
    companyId: string,
    label: 'CNSS' | 'CAMU',
    periodLabel: string,
    daysLeft: number,
    link: string,
  ) {
    const recipients = await this.prisma.user.findMany({
      where: { companyId, role: { in: ['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'] }, isActive: true },
      select: { id: true },
    });
    if (recipients.length === 0) return;

    const isOverdue = daysLeft < 0;
    const title = isOverdue
      ? `🔴 Déclaration ${label} en retard`
      : daysLeft === 0
      ? `⚠️ Déclaration ${label} à faire aujourd'hui`
      : `📋 Déclaration ${label} — ${daysLeft} jour(s) restant(s)`;

    const message = isOverdue
      ? `La déclaration ${label} de ${periodLabel} devait être déposée le ${DEADLINE_DAY} — ${Math.abs(daysLeft)} jour(s) de retard.`
      : `La déclaration ${label} de ${periodLabel} doit être déposée au plus tard le ${DEADLINE_DAY} du mois.`;

    await this.prisma.notification.createMany({
      data: recipients.map((r) => ({
        userId: r.id,
        type: 'SYSTEM_ALERT' as const,
        title,
        message,
        link,
        metadata: { subtype: `${label}_DEADLINE`, companyId, periodLabel, daysLeft },
        read: false,
      })),
    });

    this.logger.log(
      `🔔 Rappel échéance ${label} envoyé (${periodLabel}, company ${companyId}, ${recipients.length} destinataire(s))`,
    );
  }
}