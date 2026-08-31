// ============================================================================
// 📁 src/notifications/notifications.service.ts - PRODUCTION READY
// ============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType, UserRole, Prisma } from '@prisma/client';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  // ============================================================================
  // 📋 RÉCUPÉRER NOTIFICATIONS (Filtré par rôle et entreprise)
  // ============================================================================

  /**
   * 🐛 CORRIGÉ EN PROFONDEUR : chaque utilisateur ne voit désormais QUE ses
   * propres notifications — plus jamais celles d'un autre admin/manager de
   * l'entreprise. L'ancienne version élargissait le périmètre à "tous les
   * utilisateurs de l'entreprise" pour RH/Admin (et "tout le département"
   * pour les managers), ce qui causait deux bugs à la fois :
   *   1. Un admin voyait les notifications personnelles d'un AUTRE admin
   *      (ex: "vous êtes en retard" adressé à quelqu'un d'autre).
   *   2. "Tout marquer lu" ne supprimait que les notifications de
   *      l'utilisateur courant — celles des autres, elles, restaient
   *      affichées, donc tout semblait "revenir" après actualisation alors
   *      que rien n'avait de bug côté suppression : c'était un problème de
   *      PÉRIMÈTRE D'AFFICHAGE, pas de suppression.
   * Chaque événement (nouvelle demande, alerte de retard, etc.) crée déjà
   * une notification PAR destinataire concerné (voir createForGroup) — il
   * n'y a donc aucun besoin d'élargir le périmètre de lecture au-delà de
   * l'utilisateur lui-même.
   */
  private async getVisibleUserIds(userId: string): Promise<string[] | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });
    if (!user) return null;
    return [user.id];
  }

  async findAll(userId: string, limit?: number) {
    // ✅ CORRECTION : Vérifier que userId existe
    if (!userId) {
      this.logger.error('findAll appelé sans userId');
      return [];
    }

    const userIds = await this.getVisibleUserIds(userId);
    if (!userIds) return [];

    // 🐛 CORRIGÉ : l'ancienne liste blanche de types ('LEAVE_REQUEST',
    // 'PAYROLL_ERROR', 'PAYROLL_WARNING', 'ATTENDANCE_ALERT', 'SYSTEM_ALERT'
    // pour la RH ; 'LEAVE_REQUEST/APPROVED/REJECTED', 'ATTENDANCE_ALERT' pour
    // les managers) excluait silencieusement presque toutes les demandes qui
    // comptent : ABSENCE_REQUEST, PERMISSION_REQUEST, LOAN_REQUEST,
    // ADVANCE_REQUEST, OVERTIME_REQUEST, etc. n'apparaissaient JAMAIS, même
    // créées en base. La RH/le manager doit voir toute l'activité de son
    // périmètre → plus de filtre par type.
    // 🐛 CORRIGÉ : ne renvoyait jusqu'ici AUCUN filtre sur `read`, donc
    // d'anciennes notifications déjà marquées lues (restes d'avant que la
    // règle "lire = supprimer" soit appliquée partout) restaient affichées
    // indéfiniment — rien ne les purge avant le nettoyage à 90 jours
    // (deleteOldNotifications). Résultat observé : des notifications
    // visibles alors que "Tout marquer lu" est déjà désactivé (il n'y a
    // effectivement plus rien de non-lu — ces lignes-là le sont déjà).
    // Comme "lire" supprime désormais la ligne, toute notification encore
    // en base est censée être non lue par construction — on ne renvoie
    // donc que celles-là, ce qui fait aussi disparaître ces restes légataires.
    return this.prisma.notification.findMany({
      where: { userId: { in: userIds }, read: false },
      orderBy: { createdAt: 'desc' },
      take: limit || 50
    });
  }

  /**
   * ✅ Comportement demandé : lire une notification la SUPPRIME (au lieu de
   * juste la marquer lue et la garder affichée). deleteMany plutôt que
   * delete : accepte un where composite (id + userId) sans exiger une
   * contrainte unique dessus.
   */
  async markAsRead(id: string, userId?: string) {
    const whereClause: any = { id };
    if (userId) {
      whereClause.userId = userId;
    }

    try {
      const result = await this.prisma.notification.deleteMany({ where: whereClause });
      if (result.count === 0) {
        return { success: false, error: 'Notification introuvable' };
      }
      return { success: true };
    } catch (error) {
      this.logger.error(`Erreur markAsRead (suppression) notification ${id}:`, error);
      return { success: false, error: 'Notification introuvable' };
    }
  }

  /** ✅ "Tout marquer lu" supprime maintenant toutes les notifications non lues de l'utilisateur */
  async markAllAsRead(userId: string) {
    try {
      await this.prisma.notification.deleteMany({
        where: {
          userId,
          read: false
        }
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`Erreur markAllAsRead pour user ${userId}:`, error);
      return { success: false };
    }
  }

  // ============================================================================
  // 🆕 CRÉER UNE NOTIFICATION
  // ============================================================================

  async create(data: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
    metadata?: any;
  }) {
    try {
      const notification = await this.prisma.notification.create({
        data: {
          userId: data.userId,
          type: data.type,
          title: data.title,
          message: data.message,
          link: data.link || null,
          metadata: data.metadata !== undefined ? data.metadata : Prisma.JsonNull,
          read: false
        }
      });

      this.logger.log(`✅ Notification créée pour user ${data.userId}: ${data.title}`);
      return notification;
    } catch (error) {
      this.logger.error(`❌ Erreur création notification:`, error);
      throw error;
    }
  }

  // ============================================================================
  // 🆕 CRÉER NOTIFICATIONS POUR GROUPE
  // ============================================================================

  async createForGroup(
    companyId: string,
    roles: string[],
    data: {
      type: NotificationType;
      title: string;
      message: string;
      link?: string;
      metadata?: any;
    }
  ) {
    const users = await this.prisma.user.findMany({
      where: {
        companyId,
        role: { in: roles as UserRole[] },
        isActive: true
      },
      select: { id: true }
    });

    if (users.length === 0) {
      this.logger.warn(`Aucun utilisateur trouvé pour rôles ${roles.join(', ')} dans company ${companyId}`);
      return [];
    }

    const notifications = users.map(user => ({
      userId: user.id,
      type: data.type,
      title: data.title,
      message: data.message,
      link: data.link || null,
      metadata: data.metadata !== undefined ? data.metadata : Prisma.JsonNull,
      read: false
    }));

    try {
      await this.prisma.notification.createMany({
        data: notifications
      });

      this.logger.log(`✅ ${notifications.length} notifications créées pour rôles: ${roles.join(', ')}`);
      return notifications;
    } catch (error) {
      this.logger.error(`❌ Erreur création notifications groupe:`, error);
      throw error;
    }
  }

  async getUnreadCount(userId: string): Promise<number> {
    if (!userId) {
      return 0;
    }

    const userIds = await this.getVisibleUserIds(userId);
    if (!userIds) return 0;

    return this.prisma.notification.count({
      where: {
        userId: { in: userIds },
        read: false
      }
    });
  }

  // ============================================================================
  // 🔒 IDEMPOTENCE POUR NOTIFICATIONS AUTOMATIQUES (cron)
  // ============================================================================
  //
  // 🐛 CONTEXTE DU BUG CORRIGÉ : les crons qui notifient un événement
  // récurrent (retard de paie, retour de congé non confirmé...) vérifiaient
  // auparavant "est-ce que j'ai déjà créé cette notification ?" en
  // interrogeant la table `notifications` elle-même. Problème : lire une
  // notification la SUPPRIME (comportement demandé). Donc dès qu'un
  // utilisateur marquait une notif comme lue, la preuve "déjà notifié"
  // disparaissait avec elle — et le prochain passage du cron (ou la
  // prochaine visite de page qui déclenche la même vérification) la
  // recréait aussitôt. Symptôme observé : notifications qui "reviennent"
  // juste après avoir été marquées lues, et doublons avec un timestamp
  // identique à la seconde près (plusieurs instances backend/replicas
  // exécutant le même cron en parallèle).
  //
  // Solution : un registre d'idempotence séparé (`NotificationDedupKey`),
  // jamais touché par les actions de l'utilisateur, avec une contrainte
  // unique en base. `tryClaim(key)` tente d'insérer la clé : si elle existe
  // déjà (violation de contrainte unique), c'est que l'événement a déjà été
  // notifié → on ne recrée rien. L'unicité en base gère aussi nativement la
  // concurrence entre plusieurs instances (une seule gagne la course).
  //
  // Convention de clé : "<domaine>:<sous-type>:<id concerné>:<période>"
  // ex: "unpaid-salary:overdue:<companyId>:2026-08"
  //     "leave-return:overdue:<leaveId>:2026-08-14"
  async tryClaim(key: string): Promise<boolean> {
    try {
      await this.prisma.notificationDedupKey.create({ data: { key } });
      return true; // clé inédite → l'appelant peut notifier
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false; // déjà notifié — on ne recrée rien
      }
      this.logger.error(`Erreur tryClaim("${key}"):`, error);
      throw error;
    }
  }

  /** Nettoyage périodique du registre d'idempotence (appelé par un cron dédié). */
  async cleanupOldDedupKeys(daysOld: number = 180) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    try {
      const deleted = await this.prisma.notificationDedupKey.deleteMany({
        where: { createdAt: { lt: cutoffDate } },
      });
      this.logger.log(`🗑️ ${deleted.count} clés d'idempotence anciennes supprimées`);
      return { success: true, deleted: deleted.count };
    } catch (error) {
      this.logger.error(`❌ Erreur nettoyage clés d'idempotence:`, error);
      return { success: false };
    }
  }

  async deleteOldNotifications(daysOld: number = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    try {
      const deleted = await this.prisma.notification.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
          read: true 
        }
      });

      this.logger.log(`🗑️ ${deleted.count} notifications anciennes supprimées`);
      return { success: true, deleted: deleted.count };
    } catch (error) {
      this.logger.error(`❌ Erreur suppression anciennes notifications:`, error);
      return { success: false };
    }
  }
}