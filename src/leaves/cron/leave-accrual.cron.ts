// ============================================================================
// 📁 src/leaves/cron/leave-accrual.cron.ts
// ✅ LACUNE 1 — Acquisition mensuelle automatique des congés
// 🇨🇬 Conforme Congo : +2.1667 jours/mois, plafond 78 jours
// Tourne le 1er de chaque mois à 6h00 (heure Brazzaville)
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { LeavesService } from '../leaves.service';

@Injectable()
export class LeaveAccrualCron {
  private readonly logger = new Logger(LeaveAccrualCron.name);

  constructor(
    private prisma: PrismaService,
    private leavesService: LeavesService,
  ) {}

  // ============================================================================
  // ⏰ CRON 1 — Acquisition mensuelle (1er de chaque mois à 6h00 Brazzaville)
  // ============================================================================

  @Cron('0 6 1 * *', { timeZone: 'Africa/Brazzaville' })
  async handleMonthlyAccrual(): Promise<void> {
    this.logger.log('⏰ [CRON] Démarrage acquisition mensuelle des congés...');

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    try {
      // Récupérer tous les employés actifs
      const employees = await this.prisma.employee.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          companyId: true,
          hireDate: true,
        },
      });

      this.logger.log(
        `📋 ${employees.length} employés actifs à traiter pour ${month}/${year}`,
      );

      let success = 0;
      const skipped = 0;
      let errors = 0;

      for (const emp of employees) {
        try {
          await this.leavesService.accrueMonthlyLeaveForEmployee(
            emp.id,
            month,
            year,
          );
          success++;
        } catch (err: any) {
          errors++;
          this.logger.error(
            `❌ Erreur acquisition pour ${emp.firstName} ${emp.lastName}: ${err?.message ?? err}`,
          );
        }
      }

      this.logger.log(
        `✅ [CRON] Acquisition terminée — Succès: ${success} | Ignorés: ${skipped} | Erreurs: ${errors}`,
      );
    } catch (err) {
      this.logger.error(
        '❌ [CRON] Erreur critique acquisition mensuelle:',
        err,
      );
    }
  }

  // ============================================================================
  // ⏰ CRON 2 — Alertes RH (chaque lundi à 8h00 Brazzaville)
  // Vérifie les seuils de congés non pris et envoie les alertes
  // ============================================================================

  @Cron('0 8 * * 1', { timeZone: 'Africa/Brazzaville' })
  async handleWeeklyLeaveAlerts(): Promise<void> {
    this.logger.log(
      '⏰ [CRON] Vérification hebdomadaire des alertes congés...',
    );

    try {
      const employees = await this.prisma.employee.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
      });

      let alertsSent = 0;

      for (const emp of employees) {
        try {
          await this.leavesService.checkAndSendLeaveAlerts(emp.id);
          alertsSent++;
        } catch (err: any) {
          this.logger.error(
            `❌ Erreur alerte pour employé ${emp.id}: ${err?.message ?? err}`,
          );
        }
      }

      this.logger.log(
        `✅ [CRON] Alertes vérifiées pour ${alertsSent} employés`,
      );
    } catch (err) {
      this.logger.error('❌ [CRON] Erreur vérification alertes:', err);
    }
  }

  // ============================================================================
  // ❌ CRON 3 — RETIRÉ : "Report de congés en fin d'année" (31 décembre)
  // ============================================================================
  // Ce cron reportait le solde restant de l'année N vers l'année N+1, un
  // mécanisme propre au modèle calendaire (LeaveBalance keyé par année).
  // Depuis le passage au CYCLE D'ACQUISITION glissant (12 mois par employé,
  // démarre à l'embauche, redémarre à chaque retour de congé Annuel — voir
  // `Employee.leaveCycleStartDate`), il n'y a plus de notion de "31 décembre"
  // à gérer : un cycle ne se clôture jamais par une date calendaire, il se
  // clôture uniquement quand l'employé part effectivement en congé Annuel
  // (voir `LeavesService.updateStatus()`, qui met à jour `leaveCycleStartDate`
  // à ce moment-là). Laisser ce cron actif créerait des lignes LeaveBalance
  // orphelines, déconnectées du cycle réel de l'employé.

  // ============================================================================
  // ⏰ CRON 4 — Rappels de retour de congé (tous les jours à 7h00 Brazzaville)
  // ============================================================================

  @Cron('0 7 * * *', { timeZone: 'Africa/Brazzaville' })
  async handleLeaveReturnReminders(): Promise<void> {
    this.logger.log('⏰ [CRON] Vérification des rappels de retour de congé...');
    try {
      await this.leavesService.checkLeaveReturnReminders();
    } catch (err) {
      this.logger.error('❌ [CRON] Erreur rappels retour congé:', err);
    }
  }

  // ============================================================================
  // ⏰ CRON 5 — Alerte RH avant paie (tous les jours à 7h30 Brazzaville)
  // ✅ Valeurs fixes (pas de config par entreprise pour l'instant) :
  //    - le 15 du mois (J-10 avant clôture supposée le 25) : alerte
  //      "chauffe" groupée sur tous les départs du mois SUIVANT.
  //    - le 22 du mois (J-3) : relance, uniquement les départs encore
  //      théoriques (pas de congé réellement planifié).
  // ============================================================================

  @Cron('30 7 * * *', { timeZone: 'Africa/Brazzaville' })
  async handleDepartureAlerts(): Promise<void> {
    const day = new Date().getDate();
    if (day !== 15 && day !== 22) return;

    const mode = day === 15 ? 'HEADS_UP' : 'FOLLOWUP';
    this.logger.log(`⏰ [CRON] Alerte départs RH (${mode}, jour ${day})...`);
    try {
      await this.leavesService.sendDepartureAlerts(mode);
    } catch (err) {
      this.logger.error('❌ [CRON] Erreur alerte départs RH:', err);
    }
  }
}