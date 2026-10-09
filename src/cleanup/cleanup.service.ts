// ============================================================================
// 📁 src/cleanup/cleanup.service.ts
// Service de nettoyage automatique de la base de données
// Évite la saturation de : app_errors, activity_logs, user_sessions
//
// Planning (heure Brazzaville) :
//   02h00 chaque nuit  → nettoyage erreurs 4xx + erreurs résolues
//   03h00 chaque nuit  → nettoyage sessions expirées / révoquées
//   04h00 chaque nuit  → purge logs d'audit anciens (>1 an)
//   Dimanche 01h00     → rapport hebdo console
//   04h30 / 04h40 / 04h50 / 05h00 → push, notifications, clés anti-doublon,
//                                   system_logs, activité quotidienne
// ============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger('🧹 Cleanup');

  constructor(private readonly prisma: PrismaService) {}

  // ══════════════════════════════════════════════════════════════════════════
  // ERREURS APPLICATIVES — chaque nuit à 02h00
  // ══════════════════════════════════════════════════════════════════════════
  @Cron('0 2 * * *', { timeZone: 'Africa/Brazzaville' })
  async cleanupAppErrors() {
    this.logger.log('Démarrage nettoyage app_errors…');

    const d7 = new Date(Date.now() - 7 * 86_400_000); // 7 jours
    const d30 = new Date(Date.now() - 30 * 86_400_000); // 30 jours
    const d90 = new Date(Date.now() - 90 * 86_400_000); // 90 jours

    try {
      // 1. Supprimer les erreurs 4xx résolues de plus de 7 jours
      //    (validations, 404, 403 → utiles sur 7j max)
      const r1 = await (this.prisma as any).appError.deleteMany({
        where: {
          resolved: true,
          statusCode: { gte: 400, lt: 500 },
          createdAt: { lt: d7 },
        },
      });

      // 2. Supprimer les erreurs 4xx NON résolues de plus de 30 jours
      //    (erreurs client répétitives ignorées depuis 1 mois)
      const r2 = await (this.prisma as any).appError.deleteMany({
        where: {
          resolved: false,
          statusCode: { gte: 400, lt: 500 },
          createdAt: { lt: d30 },
        },
      });

      // 3. Supprimer toutes les erreurs résolues de plus de 30 jours
      //    (peu importe le status code)
      const r3 = await (this.prisma as any).appError.deleteMany({
        where: {
          resolved: true,
          createdAt: { lt: d30 },
        },
      });

      // 4. Garder les 500 non résolus pendant 90 jours max
      //    (erreurs serveur critiques — on les garde plus longtemps)
      const r4 = await (this.prisma as any).appError.deleteMany({
        where: {
          statusCode: { gte: 500 },
          createdAt: { lt: d90 },
        },
      });

      const total = r1.count + r2.count + r3.count + r4.count;
      this.logger.log(
        `✅ app_errors nettoyées : ${total} lignes supprimées` +
          ` (4xx résolus +7j: ${r1.count}, 4xx anciens: ${r2.count},` +
          ` résolus +30j: ${r3.count}, 500 anciens +90j: ${r4.count})`,
      );

      return { deleted: total };
    } catch (err) {
      this.logger.error('❌ Erreur nettoyage app_errors:', err);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SESSIONS JWT — chaque nuit à 03h00
  // ══════════════════════════════════════════════════════════════════════════
  @Cron('0 3 * * *', { timeZone: 'Africa/Brazzaville' })
  async cleanupSessions() {
    this.logger.log('Démarrage nettoyage user_sessions…');

    const d7 = new Date(Date.now() - 7 * 86_400_000);
    const d30 = new Date(Date.now() - 30 * 86_400_000);

    try {
      // 1. Sessions expirées depuis plus de 7 jours
      const r1 = await this.prisma.userSession.deleteMany({
        where: { expiresAt: { lt: d7 } },
      });

      // 2. Sessions révoquées depuis plus de 30 jours
      //    (on les garde 30j pour audit de sécurité)
      const r2 = await this.prisma.userSession.deleteMany({
        where: { revokedAt: { lt: d30 } },
      });

      const total = r1.count + r2.count;
      this.logger.log(
        `✅ user_sessions nettoyées : ${total} lignes supprimées` +
          ` (expirées: ${r1.count}, révoquées +30j: ${r2.count})`,
      );

      return { deleted: total };
    } catch (err) {
      this.logger.error('❌ Erreur nettoyage sessions:', err);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOGS D'AUDIT — chaque nuit à 04h00
  // ══════════════════════════════════════════════════════════════════════════
  @Cron('0 4 * * *', { timeZone: 'Africa/Brazzaville' })
  async cleanupAuditLogs() {
    this.logger.log('Démarrage nettoyage activity_logs…');

    // Politique de rétention :
    // - Actions CRITICAL  → 2 ans  (ruptures, suppressions, exports eTax)
    // - Actions WARN      → 1 an   (modifications, exports classiques)
    // - Actions INFO      → 90 jours (connexions normales, lectures)
    const d90 = new Date(Date.now() - 90 * 86_400_000);
    const d365 = new Date(Date.now() - 365 * 86_400_000);
    const d730 = new Date(Date.now() - 730 * 86_400_000);

    const CRITICAL_ACTIONS = [
      'CONTRACT_RUPTURE',
      'EMPLOYEE_DELETE',
      'PAYROLL_DELETE',
      '2FA_DISABLED',
      'SUBSCRIPTION_CANCEL',
      'EXPORT_ETAX',
      'EXPORT_CNSS',
      'CABINET_REMOVE_COMPANY',
      'SETTINGS_PAYROLL',
    ];

    const WARN_ACTIONS = [
      'EXPORT_EXCEL',
      'EXPORT_SAGE',
      'EXPORT_PDF_BATCH',
      'EXPORT_CSV',
      'PAYROLL_GENERATE_BATCH',
      'PAYROLL_UPDATE',
      'PAYROLL_RECALCULATE',
      'EMPLOYEE_CREATE',
      'EMPLOYEE_UPDATE',
      'EMPLOYEE_IMPORT',
      'USER_INVITE',
      'USER_UPDATE',
      'LOAN_CREATE',
      'ADVANCE_CREATE',
      'ATTENDANCE_MANUAL',
      'ATTENDANCE_CORRECT',
    ];

    try {
      // 1. Supprimer les logs INFO de plus de 90 jours
      //    (connexions, consultations, actions normales)
      const r1 = await this.prisma.activityLog.deleteMany({
        where: {
          action: { notIn: [...CRITICAL_ACTIONS, ...WARN_ACTIONS] },
          createdAt: { lt: d90 },
        },
      });

      // 2. Supprimer les logs WARN de plus de 1 an
      const r2 = await this.prisma.activityLog.deleteMany({
        where: {
          action: { in: WARN_ACTIONS },
          createdAt: { lt: d365 },
        },
      });

      // 3. Supprimer les logs CRITICAL de plus de 2 ans
      //    (conformité légale Congo : archives 2 ans minimum)
      const r3 = await this.prisma.activityLog.deleteMany({
        where: {
          action: { in: CRITICAL_ACTIONS },
          createdAt: { lt: d730 },
        },
      });

      const total = r1.count + r2.count + r3.count;
      this.logger.log(
        `✅ activity_logs nettoyés : ${total} lignes supprimées` +
          ` (INFO +90j: ${r1.count}, WARN +1an: ${r2.count}, CRITICAL +2ans: ${r3.count})`,
      );

      return { deleted: total };
    } catch (err) {
      this.logger.error('❌ Erreur nettoyage audit logs:', err);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RAPPORT HEBDOMADAIRE — chaque dimanche à 01h00
  // ══════════════════════════════════════════════════════════════════════════
  @Cron('0 1 * * 0', { timeZone: 'Africa/Brazzaville' })
  async weeklyReport() {
    this.logger.log('Rapport hebdomadaire BDD…');
    try {
      const [
        totalErrors,
        unresolvedErrors,
        totalSessions,
        activeSessions,
        totalAuditLogs,
        totalUsers,
        totalCompanies,
      ] = await Promise.all([
        (this.prisma as any).appError.count(),
        (this.prisma as any).appError.count({ where: { resolved: false } }),
        this.prisma.userSession.count(),
        this.prisma.userSession.count({
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
        }),
        this.prisma.activityLog.count(),
        this.prisma.user.count(),
        this.prisma.company.count(),
      ]);

      this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.logger.log('📊 RAPPORT HEBDO — Konza RH');
      this.logger.log(`   Entreprises     : ${totalCompanies}`);
      this.logger.log(`   Utilisateurs    : ${totalUsers}`);
      this.logger.log(
        `   Sessions totales: ${totalSessions} (actives: ${activeSessions})`,
      );
      this.logger.log(`   Logs d'audit    : ${totalAuditLogs}`);
      this.logger.log(
        `   Erreurs totales : ${totalErrors} (non résolues: ${unresolvedErrors})`,
      );
      this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      if (unresolvedErrors > 100) {
        this.logger.warn(
          `⚠️  ${unresolvedErrors} erreurs non résolues — vérifier l'Error Tracker`,
        );
      }
    } catch (err) {
      this.logger.error('❌ Erreur rapport hebdo:', err);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NETTOYAGE MANUEL — appelable depuis l'admin controller
  // ══════════════════════════════════════════════════════════════════════════
  async manualCleanup(): Promise<{
    errors: number;
    sessions: number;
    auditLogs: number;
  }> {
    this.logger.log("Nettoyage manuel déclenché depuis l'interface admin…");
    const [e, s, a] = await Promise.all([
      this.cleanupAppErrors(),
      this.cleanupSessions(),
      this.cleanupAuditLogs(),
    ]);
    return {
      errors: (e as any)?.deleted ?? 0,
      sessions: (s as any)?.deleted ?? 0,
      auditLogs: (a as any)?.deleted ?? 0,
    };
  }

  // ============================================================================
  // 🆕 Purge du suivi des envois push (30 jours) — chaque rappel en crée une ligne
  // ============================================================================
  @Cron('30 4 * * *', { timeZone: 'Africa/Brazzaville' })
  async purgePushDeliveries(): Promise<void> {
    try {
      const r = await (this.prisma as any).pushDelivery.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } },
      });
      if (r?.count) this.logger.log(`🧹 ${r.count} suivi(s) d'envoi push de plus de 30 jours supprimé(s)`);
    } catch (e: any) {
      this.logger.warn(`Purge push_deliveries: ${e?.message ?? e}`);
    }
  }

  // ============================================================================
  // 🆕 Purge des notifications — lues > 90 j, non lues > 365 j
  // (le rappel pré-début en crée 1 par employé et par jour)
  // ============================================================================
  @Cron('40 4 * * *', { timeZone: 'Africa/Brazzaville' })
  async purgeNotifications(): Promise<void> {
    try {
      const d90 = new Date(Date.now() - 90 * 86_400_000);
      const d365 = new Date(Date.now() - 365 * 86_400_000);
      const r = await this.prisma.notification.deleteMany({
        where: {
          OR: [
            { read: true, createdAt: { lt: d90 } },
            { read: false, createdAt: { lt: d365 } },
          ],
        },
      });
      if (r.count) this.logger.log(`🧹 ${r.count} notification(s) ancienne(s) supprimée(s)`);
    } catch (e: any) {
      this.logger.warn(`Purge notifications: ${e?.message ?? e}`);
    }
  }

  // ============================================================================
  // 🆕 Purge des clés anti-doublon — pre-start:/post-end: (1 par employé/jour)
  // > 30 j ; toutes les autres (abonnements, CNSS, impayés…) > 400 j
  // ============================================================================
  @Cron('45 4 * * *', { timeZone: 'Africa/Brazzaville' })
  async purgeDedupKeys(): Promise<void> {
    try {
      const d30 = new Date(Date.now() - 30 * 86_400_000);
      const d400 = new Date(Date.now() - 400 * 86_400_000);
      const daily = await this.prisma.notificationDedupKey.deleteMany({
        where: {
          createdAt: { lt: d30 },
          OR: [{ key: { startsWith: 'pre-start:' } }, { key: { startsWith: 'post-end:' } }],
        },
      });
      const others = await this.prisma.notificationDedupKey.deleteMany({
        where: { createdAt: { lt: d400 } },
      });
      const total = daily.count + others.count;
      if (total) this.logger.log(`🧹 ${total} clé(s) anti-doublon supprimée(s)`);
    } catch (e: any) {
      this.logger.warn(`Purge notification_dedup_keys: ${e?.message ?? e}`);
    }
  }

  // ============================================================================
  // 🆕 Purge des journaux système — INFO/WARNING > 30 j, ERROR/ALERT > 180 j
  // ============================================================================
  @Cron('50 4 * * *', { timeZone: 'Africa/Brazzaville' })
  async purgeSystemLogs(): Promise<void> {
    try {
      const d30 = new Date(Date.now() - 30 * 86_400_000);
      const d180 = new Date(Date.now() - 180 * 86_400_000);
      const light = await this.prisma.systemLog.deleteMany({
        where: { level: { in: ['INFO', 'WARNING'] }, createdAt: { lt: d30 } },
      });
      const heavy = await this.prisma.systemLog.deleteMany({
        where: { level: { in: ['ERROR', 'ALERT'] }, createdAt: { lt: d180 } },
      });
      const total = light.count + heavy.count;
      if (total) this.logger.log(`🧹 ${total} journal(aux) système supprimé(s)`);
    } catch (e: any) {
      this.logger.warn(`Purge system_logs: ${e?.message ?? e}`);
    }
  }

  // ============================================================================
  // 🆕 Purge de l'activité quotidienne des utilisateurs — > 400 jours
  // (date au format "YYYY-MM-DD" : la comparaison de texte est chronologique)
  // ============================================================================
  @Cron('0 5 * * *', { timeZone: 'Africa/Brazzaville' })
  async purgeDailyUserActivity(): Promise<void> {
    try {
      const limit = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
      const r = await this.prisma.dailyUserActivity.deleteMany({
        where: { date: { lt: limit } },
      });
      if (r.count) this.logger.log(`🧹 ${r.count} ligne(s) d'activité quotidienne supprimée(s)`);
    } catch (e: any) {
      this.logger.warn(`Purge daily_user_activity: ${e?.message ?? e}`);
    }
  }
}