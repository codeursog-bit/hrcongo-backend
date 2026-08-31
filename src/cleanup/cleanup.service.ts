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
}
