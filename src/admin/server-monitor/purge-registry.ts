// ============================================================================
// 📁 src/admin/server-monitor/purge-registry.ts
// LISTE BLANCHE des données que le super admin peut purger depuis l'interface.
//
// ⚠️ Règle d'or : une table qui n'est PAS dans cette liste ne peut JAMAIS être
//    purgée depuis l'interface (employés, paies, congés, prêts, contrats…).
//
// ➕ Pour rendre une nouvelle table purgeable (ex. conversations du chat) :
//    ajoute simplement une entrée dans PURGE_TARGETS — rien d'autre à toucher.
//    Elle apparaît alors toute seule dans l'écran de purge.
// ============================================================================

export type PurgeRisk = 'SAFE' | 'CAUTION';

export interface PurgeTarget {
  /** Identifiant stable envoyé par le front (ne jamais le renommer) */
  key: string;
  label: string;
  /** Explication affichée au super admin : ce qui est supprimé */
  description: string;
  /** Ce qui est conservé (affiché sous la description) */
  keeps?: string;
  /** Nom SQL de la table (sert à croiser avec la taille réelle sur disque) */
  table: string;
  /** Nom du delegate Prisma (prisma[model]) — le modèle doit avoir un champ `id` */
  model: string;
  defaultDays: number;
  /** Ancienneté minimale imposée par le serveur, quoi que dise le front */
  minDays: number;
  /**
   * SAFE    = journaux techniques sans valeur métier
   * CAUTION = utile en cas de litige / d'enquête → confirmation par texte exigée
   */
  risk: PurgeRisk;
  /** Filtre Prisma : lignes plus vieilles que `cutoff` */
  where: (cutoff: Date) => Record<string, any>;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export const PURGE_TARGETS: PurgeTarget[] = [
  // ── Erreurs applicatives ────────────────────────────────────────────────
  {
    key: 'app_errors_resolved',
    label: 'Erreurs déjà résolues',
    description: 'Erreurs marquées « résolues » dans l’Error Tracker.',
    keeps: 'Les erreurs non résolues',
    table: 'app_errors', model: 'appError',
    defaultDays: 7, minDays: 7, risk: 'SAFE',
    where: (c) => ({ resolved: true, createdAt: { lt: c } }),
  },
  {
    key: 'app_errors_4xx',
    label: 'Erreurs client (400–499)',
    description: 'Validations refusées, 404, 403… (non résolues comprises) : bruit, rarement utile après une semaine.',
    keeps: 'Toutes les erreurs serveur (5xx)',
    table: 'app_errors', model: 'appError',
    defaultDays: 7, minDays: 7, risk: 'SAFE',
    where: (c) => ({ statusCode: { gte: 400, lt: 500 }, createdAt: { lt: c } }),
  },
  {
    key: 'app_errors_5xx',
    label: 'Erreurs serveur (5xx)',
    description: 'Vraies pannes du back : utiles pour comprendre un incident passé.',
    table: 'app_errors', model: 'appError',
    defaultDays: 30, minDays: 14, risk: 'CAUTION',
    where: (c) => ({ statusCode: { gte: 500 }, createdAt: { lt: c } }),
  },

  // ── Journaux système ────────────────────────────────────────────────────
  {
    key: 'system_logs_light',
    label: 'Journaux système (INFO / WARNING)',
    description: 'Comptes rendus des crons (rappels, clôtures, etc.).',
    keeps: 'Les journaux ERROR et ALERT',
    table: 'system_logs', model: 'systemLog',
    defaultDays: 7, minDays: 7, risk: 'SAFE',
    where: (c) => ({ level: { in: ['INFO', 'WARNING'] }, createdAt: { lt: c } }),
  },
  {
    key: 'system_logs_heavy',
    label: 'Journaux système (ERROR / ALERT)',
    description: 'Incidents signalés par les crons.',
    table: 'system_logs', model: 'systemLog',
    defaultDays: 30, minDays: 14, risk: 'CAUTION',
    where: (c) => ({ level: { in: ['ERROR', 'ALERT'] }, createdAt: { lt: c } }),
  },

  // ── Notifications & envois ──────────────────────────────────────────────
  {
    key: 'notifications_read',
    label: 'Notifications déjà lues',
    description: 'Notifications que l’utilisateur a ouvertes.',
    keeps: 'Les notifications non lues',
    table: 'notifications', model: 'notification',
    defaultDays: 30, minDays: 7, risk: 'SAFE',
    where: (c) => ({ read: true, createdAt: { lt: c } }),
  },
  {
    key: 'notifications_unread',
    label: 'Notifications jamais lues',
    description: 'Notifications que personne n’a ouvertes (utilisateurs inactifs).',
    table: 'notifications', model: 'notification',
    defaultDays: 90, minDays: 30, risk: 'CAUTION',
    where: (c) => ({ read: false, createdAt: { lt: c } }),
  },
  {
    key: 'push_deliveries',
    label: 'Suivi des envois push',
    description: 'Trace technique de chaque notification push envoyée.',
    table: 'push_deliveries', model: 'pushDelivery',
    defaultDays: 7, minDays: 7, risk: 'SAFE',
    where: (c) => ({ createdAt: { lt: c } }),
  },
  {
    key: 'dedup_keys_daily',
    label: 'Clés anti-doublon des rappels',
    description: 'Une clé par employé et par jour pour ne pas envoyer deux fois le même rappel.',
    keeps: 'Les clés d’abonnements, CNSS, impayés…',
    table: 'notification_dedup_keys', model: 'notificationDedupKey',
    defaultDays: 7, minDays: 3, risk: 'SAFE',
    where: (c) => ({
      createdAt: { lt: c },
      OR: [{ key: { startsWith: 'pre-start:' } }, { key: { startsWith: 'post-end:' } }],
    }),
  },

  // ── Activité & sessions ─────────────────────────────────────────────────
  {
    key: 'daily_user_activity',
    label: 'Activité quotidienne des utilisateurs',
    description: 'Statistiques « qui était en ligne » jour par jour.',
    table: 'daily_user_activity', model: 'dailyUserActivity',
    defaultDays: 90, minDays: 30, risk: 'SAFE',
    where: (c) => ({ date: { lt: day(c) } }),
  },
  {
    key: 'user_sessions',
    label: 'Sessions expirées ou révoquées',
    description: 'Anciennes sessions de connexion qui ne servent plus.',
    keeps: 'Les sessions encore valides',
    table: 'user_sessions', model: 'userSession',
    defaultDays: 7, minDays: 1, risk: 'SAFE',
    where: (c) => ({ OR: [{ expiresAt: { lt: c } }, { revokedAt: { lt: c } }] }),
  },
  {
    key: 'ip_sightings',
    label: 'Adresses IP observées',
    description: 'IP vues par entreprise (détection des réseaux de confiance).',
    table: 'company_ip_sightings', model: 'companyIpSighting',
    defaultDays: 30, minDays: 7, risk: 'SAFE',
    where: (c) => ({ lastSeenAt: { lt: c } }),
  },
  {
    key: 'job_offer_views',
    label: 'Vues des offres d’emploi',
    description: 'Compteur de visites du portail carrière.',
    table: 'job_offer_views', model: 'jobOfferView',
    defaultDays: 180, minDays: 30, risk: 'SAFE',
    where: (c) => ({ createdAt: { lt: c } }),
  },

  // ── Messagerie interne (chat) ───────────────────────────────────────────
  {
    key: 'chat_messages_old',
    label: 'Anciens messages du chat',
    description: 'Messages de la messagerie interne (chiffrés en base) plus vieux que X jours. Le chat se purge déjà seul après CHAT_RETENTION_DAYS (180 j par défaut) : ici tu peux purger plus tôt pour libérer de l’espace.',
    keeps: 'Les conversations, leurs participants et les messages récents',
    table: 'chat_messages', model: 'chatMessage',
    defaultDays: 180, minDays: 30, risk: 'CAUTION',
    where: (c) => ({ createdAt: { lt: c } }),
  },
  {
    key: 'chat_conversations_empty',
    label: 'Conversations vides',
    description: 'Conversations qui ne contiennent plus aucun message.',
    table: 'chat_conversations', model: 'chatConversation',
    defaultDays: 30, minDays: 7, risk: 'SAFE',
    where: (c) => ({ createdAt: { lt: c }, messages: { none: {} } }),
  },

  // ── Traçabilité (sensible) ──────────────────────────────────────────────
  {
    key: 'activity_logs',
    label: 'Journal d’audit (qui a fait quoi)',
    description: 'Historique des actions des utilisateurs (paies, salaires, validations).',
    keeps: 'Garde-le au moins 1 an : c’est ta preuve en cas de litige.',
    table: 'activity_logs', model: 'activityLog',
    defaultDays: 365, minDays: 180, risk: 'CAUTION',
    where: (c) => ({ createdAt: { lt: c } }),
  },

  // ── ➕ À AJOUTER PLUS TARD (modèle) ──────────────────────────────────────
  // {
  //   key: 'ma_nouvelle_regle',
  //   label: 'Libellé affiché',
  //   description: 'Ce qui est supprimé.',
  //   table: 'nom_sql_de_la_table', model: 'delegatePrisma',
  //   defaultDays: 90, minDays: 30, risk: 'SAFE',
  //   where: (c) => ({ createdAt: { lt: c } }),
  // },
];

export const PURGE_KEYS = PURGE_TARGETS.map((t) => t.key);
/** Tables pour lesquelles une purge existe (sert au diagnostic « pourquoi ça grossit ») */
export const PURGE_TABLES = new Set(PURGE_TARGETS.map((t) => t.table));
export const CAUTION_CONFIRM_TEXT = 'SUPPRIMER';