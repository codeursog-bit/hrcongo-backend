// ============================================================================
// 📁 src/audit/audit.interceptor.ts
// Audit log COMPLET — 100% des services, 100% des actions sensibles
// Chaque action : userId, IP réelle, route, méthode, durée, severité
// Mots de passe et tokens toujours [REDACTED]
// ============================================================================
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service';

type Severity = 'INFO' | 'WARN' | 'CRITICAL';

type AuditRule = {
  method: string;
  pattern: RegExp;
  action: string;
  entity: string;
  severity: Severity;
  describe: (req: any) => string;
};

const RULES: AuditRule[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // AUTH
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/auth\/login$/,
    action: 'LOGIN',
    entity: 'AUTH',
    severity: 'INFO',
    describe: (r) => `Connexion réussie — IP: ${r.ip}`,
  },

  {
    method: 'POST',
    pattern: /^\/auth\/logout$/,
    action: 'LOGOUT',
    entity: 'AUTH',
    severity: 'INFO',
    describe: (r) => `Déconnexion — userId: ${r.user?.userId}`,
  },

  {
    method: 'POST',
    pattern: /^\/auth\/register$/,
    action: 'REGISTER',
    entity: 'AUTH',
    severity: 'INFO',
    describe: (r) => `Nouveau compte — email: ${r.body?.email}`,
  },

  {
    method: 'POST',
    pattern: /^\/auth\/change-password$/,
    action: 'CHANGE_PASSWORD',
    entity: 'AUTH',
    severity: 'WARN',
    describe: () => 'Changement de mot de passe (depuis profil)',
  },

  {
    method: 'POST',
    pattern: /^\/auth\/reset-password$/,
    action: 'RESET_PASSWORD',
    entity: 'AUTH',
    severity: 'WARN',
    describe: () => 'Réinitialisation mot de passe via lien email',
  },

  {
    method: 'POST',
    pattern: /^\/auth\/force-password-change$/,
    action: 'FORCE_PASSWORD',
    entity: 'AUTH',
    severity: 'WARN',
    describe: () => 'Changement forcé de mot de passe (premier login)',
  },

  {
    method: 'POST',
    pattern: /^\/auth\/2fa\/setup$/,
    action: '2FA_SETUP',
    entity: 'AUTH',
    severity: 'WARN',
    describe: () => 'Initialisation configuration 2FA',
  },

  {
    method: 'POST',
    pattern: /^\/auth\/2fa\/activate$/,
    action: '2FA_ACTIVATED',
    entity: 'AUTH',
    severity: 'WARN',
    describe: () => '2FA activé sur le compte',
  },

  {
    method: 'POST',
    pattern: /^\/auth\/2fa\/authenticate$/,
    action: '2FA_AUTH',
    entity: 'AUTH',
    severity: 'INFO',
    describe: (r) => `Authentification 2FA — IP: ${r.ip}`,
  },

  {
    method: 'POST',
    pattern: /^\/auth\/2fa\/disable$/,
    action: '2FA_DISABLED',
    entity: 'AUTH',
    severity: 'CRITICAL',
    describe: () => '⚠️ 2FA désactivé sur le compte',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // EMPLOYÉS
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/employees$/,
    action: 'EMPLOYEE_CREATE',
    entity: 'EMPLOYEE',
    severity: 'INFO',
    describe: (r) =>
      `Création employé : ${r.body?.firstName ?? ''} ${r.body?.lastName ?? ''} — poste: ${r.body?.position ?? ''}`,
  },

  {
    method: 'PATCH',
    pattern: /^\/employees\/[^/]+$/,
    action: 'EMPLOYEE_UPDATE',
    entity: 'EMPLOYEE',
    severity: 'INFO',
    describe: (r) => `Modification employé #${r.params?.id}`,
  },

  {
    method: 'PUT',
    pattern: /^\/employees\/[^/]+$/,
    action: 'EMPLOYEE_UPDATE',
    entity: 'EMPLOYEE',
    severity: 'INFO',
    describe: (r) => `Mise à jour complète employé #${r.params?.id}`,
  },

  {
    method: 'DELETE',
    pattern: /^\/employees\/[^/]+$/,
    action: 'EMPLOYEE_DELETE',
    entity: 'EMPLOYEE',
    severity: 'CRITICAL',
    describe: (r) => `🚨 Suppression employé #${r.params?.id}`,
  },

  {
    method: 'POST',
    pattern: /\/employees.*import/,
    action: 'EMPLOYEE_IMPORT',
    entity: 'EMPLOYEE',
    severity: 'WARN',
    describe: () => 'Import en masse employés via Excel',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PRIMES EMPLOYÉS
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /\/employee-bonuses$/,
    action: 'BONUS_CREATE',
    entity: 'BONUS',
    severity: 'INFO',
    describe: (r) => `Création prime — employé: ${r.body?.employeeId}`,
  },

  {
    method: 'PUT',
    pattern: /\/employee-bonuses\/[^/]+$/,
    action: 'BONUS_UPDATE',
    entity: 'BONUS',
    severity: 'INFO',
    describe: (r) => `Modification prime #${r.params?.bonusId}`,
  },

  {
    method: 'PATCH',
    pattern: /\/employee-bonuses\/[^/]+$/,
    action: 'BONUS_UPDATE',
    entity: 'BONUS',
    severity: 'INFO',
    describe: (r) => `Modification prime #${r.params?.bonusId}`,
  },

  {
    method: 'DELETE',
    pattern: /\/employee-bonuses\/[^/]+$/,
    action: 'BONUS_DELETE',
    entity: 'BONUS',
    severity: 'WARN',
    describe: (r) => `Suppression prime #${r.params?.bonusId}`,
  },

  {
    method: 'POST',
    pattern: /\/employees\/[^/]+\/bonuses$/,
    action: 'BONUS_CREATE',
    entity: 'BONUS',
    severity: 'INFO',
    describe: (r) => `Prime créée pour employé #${r.params?.employeeId}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PAIE
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/payrolls\/generate$/,
    action: 'PAYROLL_GENERATE_BATCH',
    entity: 'PAYROLL',
    severity: 'WARN',
    describe: (r) =>
      `Génération paie masse : ${r.body?.employeeIds?.length ?? 0} employés — ${r.body?.month}/${r.body?.year}`,
  },

  {
    method: 'POST',
    pattern: /^\/payrolls$/,
    action: 'PAYROLL_CREATE',
    entity: 'PAYROLL',
    severity: 'INFO',
    describe: (r) =>
      `Création bulletin individuel — ${r.body?.month}/${r.body?.year}`,
  },

  {
    method: 'PATCH',
    pattern: /^\/payrolls\/[^/]+$/,
    action: 'PAYROLL_UPDATE',
    entity: 'PAYROLL',
    severity: 'WARN',
    describe: (r) => `Modification bulletin #${r.params?.id}`,
  },

  {
    method: 'DELETE',
    pattern: /^\/payrolls\/[^/]+$/,
    action: 'PAYROLL_DELETE',
    entity: 'PAYROLL',
    severity: 'CRITICAL',
    describe: (r) => `🚨 Suppression bulletin #${r.params?.id}`,
  },

  {
    method: 'PATCH',
    pattern: /^\/payrolls\/[^/]+\/recalculate$/,
    action: 'PAYROLL_RECALCULATE',
    entity: 'PAYROLL',
    severity: 'WARN',
    describe: (r) => `Recalcul bulletin #${r.params?.id}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // EXPORTS — tous critiques / sensibles
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'GET',
    pattern: /\/export\/excel/,
    action: 'EXPORT_EXCEL',
    entity: 'EXPORT',
    severity: 'WARN',
    describe: (r) =>
      `Export Excel — ${r.path} — période ${r.query?.month ?? '?'}/${r.query?.year ?? '?'}`,
  },

  {
    method: 'GET',
    pattern: /\/export\/sage/,
    action: 'EXPORT_SAGE',
    entity: 'EXPORT',
    severity: 'WARN',
    describe: (r) =>
      `Export Sage — ${r.query?.month ?? '?'}/${r.query?.year ?? '?'}`,
  },

  {
    method: 'POST',
    pattern: /\/export\/sage/,
    action: 'EXPORT_SAGE',
    entity: 'EXPORT',
    severity: 'WARN',
    describe: (r) =>
      `Export Sage bulletins sélectionnés — ${r.body?.ids?.length ?? 0} bulletins`,
  },

  {
    method: 'GET',
    pattern: /\/export\/etax/,
    action: 'EXPORT_ETAX',
    entity: 'EXPORT',
    severity: 'CRITICAL',
    describe: (r) =>
      `Export eTax DGI — ${r.query?.month ?? '?'}/${r.query?.year ?? '?'}`,
  },

  {
    method: 'GET',
    pattern: /\/export\/csv/,
    action: 'EXPORT_CSV',
    entity: 'EXPORT',
    severity: 'WARN',
    describe: (r) => `Export CSV — ${r.path}`,
  },

  {
    method: 'POST',
    pattern: /\/export\/batch-pdf/,
    action: 'EXPORT_PDF_BATCH',
    entity: 'EXPORT',
    severity: 'WARN',
    describe: (r) =>
      `Export PDF bulletins en masse — ${r.body?.ids?.length ?? 0} bulletins`,
  },

  {
    method: 'POST',
    pattern: /\/export\/declarations-pdf/,
    action: 'EXPORT_DECLARATIONS_PDF',
    entity: 'EXPORT',
    severity: 'WARN',
    describe: () => 'Export PDF déclarations',
  },

  {
    method: 'GET',
    pattern: /\/cnss-declaration\/export/,
    action: 'EXPORT_CNSS',
    entity: 'EXPORT',
    severity: 'CRITICAL',
    describe: (r) => `Export déclaration CNSS — ${r.path}`,
  },

  {
    method: 'GET',
    pattern: /\/cabinet\/.*\/export/,
    action: 'CABINET_EXPORT',
    entity: 'EXPORT',
    severity: 'CRITICAL',
    describe: (r) => `Export cabinet — ${r.path}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CONGÉS
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/leaves$/,
    action: 'LEAVE_CREATE',
    entity: 'LEAVE',
    severity: 'INFO',
    describe: (r) =>
      `Demande congé : ${r.body?.type ?? ''} du ${r.body?.startDate ?? ''} au ${r.body?.endDate ?? ''}`,
  },

  {
    method: 'PATCH',
    pattern: /^\/leaves\/[^/]+\/status$/,
    action: 'LEAVE_STATUS',
    entity: 'LEAVE',
    severity: 'INFO',
    describe: (r) =>
      `Décision congé #${r.params?.id} → ${r.body?.status ?? ''}`,
  },

  {
    method: 'PATCH',
    pattern: /^\/leaves\/[^/]+\/cancel$/,
    action: 'LEAVE_CANCEL',
    entity: 'LEAVE',
    severity: 'INFO',
    describe: (r) => `Annulation congé #${r.params?.id}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PRÊTS & AVANCES
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/loans$/,
    action: 'LOAN_CREATE',
    entity: 'LOAN',
    severity: 'WARN',
    describe: (r) =>
      `Prêt accordé : ${r.body?.amount ?? 0} FCFA — ${r.body?.months ?? 0} mois`,
  },

  {
    method: 'POST',
    pattern: /^\/loans\/advances$/,
    action: 'ADVANCE_CREATE',
    entity: 'LOAN',
    severity: 'WARN',
    describe: (r) => `Avance sur salaire : ${r.body?.amount ?? 0} FCFA`,
  },

  {
    method: 'PATCH',
    pattern: /^\/loans\/[^/]+\/deduct$/,
    action: 'LOAN_DEDUCT',
    entity: 'LOAN',
    severity: 'INFO',
    describe: (r) => `Déduction prêt #${r.params?.id}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CONTRATS & RUPTURE
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/contract-rupture$/,
    action: 'CONTRACT_RUPTURE',
    entity: 'CONTRACT',
    severity: 'CRITICAL',
    describe: (r) =>
      `🚨 Rupture contrat — motif: ${r.body?.reason ?? '?'} — employé: ${r.body?.employeeId ?? '?'}`,
  },

  {
    method: 'PATCH',
    pattern: /^\/contracts\/[^/]+\/confirm-trial$/,
    action: 'TRIAL_CONFIRMED',
    entity: 'CONTRACT',
    severity: 'INFO',
    describe: (r) =>
      `Période essai confirmée — employé: ${r.params?.employeeId}`,
  },

  {
    method: 'PATCH',
    pattern: /^\/contracts\/[^/]+\/fail-trial$/,
    action: 'TRIAL_FAILED',
    entity: 'CONTRACT',
    severity: 'WARN',
    describe: (r) => `Période essai échouée — employé: ${r.params?.employeeId}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // UTILISATEURS & RÔLES
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/users\/invite$/,
    action: 'USER_INVITE',
    entity: 'USER',
    severity: 'WARN',
    describe: (r) =>
      `Invitation : ${r.body?.email ?? ''} — rôle: ${r.body?.role ?? ''}`,
  },

  {
    method: 'POST',
    pattern: /^\/users$/,
    action: 'USER_CREATE',
    entity: 'USER',
    severity: 'WARN',
    describe: (r) => `Création utilisateur : ${r.body?.email ?? ''}`,
  },

  {
    method: 'PATCH',
    pattern: /^\/users\/[^/]+$/,
    action: 'USER_UPDATE',
    entity: 'USER',
    severity: 'WARN',
    describe: (r) =>
      `Modification utilisateur #${r.params?.id}${r.body?.role ? ' — rôle → ' + r.body.role : ''}${r.body?.isActive === false ? ' — DÉSACTIVATION' : ''}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ENTREPRISE & DÉPARTEMENTS
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/companies$/,
    action: 'COMPANY_CREATE',
    entity: 'COMPANY',
    severity: 'INFO',
    describe: (r) =>
      `Création entreprise : ${r.body?.name ?? r.body?.legalName ?? ''}`,
  },

  {
    method: 'PATCH',
    pattern: /^\/companies/,
    action: 'COMPANY_UPDATE',
    entity: 'COMPANY',
    severity: 'INFO',
    describe: () => 'Modification paramètres entreprise',
  },

  {
    method: 'POST',
    pattern: /^\/departments$/,
    action: 'DEPT_CREATE',
    entity: 'DEPARTMENT',
    severity: 'INFO',
    describe: (r) => `Création département : ${r.body?.name ?? ''}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PARAMÈTRES PAIE — CRITIQUE
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'PATCH',
    pattern: /^\/payroll-settings/,
    action: 'SETTINGS_PAYROLL',
    entity: 'SETTINGS',
    severity: 'CRITICAL',
    describe: () =>
      '🚨 Modification paramètres de paie (taux CNSS / barèmes ITS)',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CABINET
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/cabinet\/[^/]+\/companies/,
    action: 'CABINET_ADD_COMPANY',
    entity: 'CABINET',
    severity: 'INFO',
    describe: (r) => `Cabinet ajoute PME : ${r.body?.name ?? ''}`,
  },

  {
    method: 'DELETE',
    pattern: /^\/cabinet\/[^/]+\/companies\/[^/]+$/,
    action: 'CABINET_REMOVE_COMPANY',
    entity: 'CABINET',
    severity: 'CRITICAL',
    describe: (r) => `🚨 Cabinet retire PME #${r.params?.companyId}`,
  },

  {
    method: 'DELETE',
    pattern: /^\/cabinet\/[^/]+\/users\/[^/]+$/,
    action: 'CABINET_REMOVE_USER',
    entity: 'CABINET',
    severity: 'WARN',
    describe: (r) => `Cabinet retire utilisateur #${r.params?.userId}`,
  },

  {
    method: 'PATCH',
    pattern: /^\/cabinet\/[^/]+\/branding$/,
    action: 'CABINET_BRANDING',
    entity: 'CABINET',
    severity: 'INFO',
    describe: () => 'Modification branding cabinet',
  },

  {
    method: 'POST',
    pattern: /^\/cabinet\/[^/]+\/companies\/[^/]+\/invite-admin$/,
    action: 'CABINET_INVITE_ADMIN',
    entity: 'CABINET',
    severity: 'WARN',
    describe: (r) => `Invitation admin PME #${r.params?.companyId}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ABONNEMENT
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/subscriptions\/upgrade$/,
    action: 'SUBSCRIPTION_UPGRADE',
    entity: 'SUBSCRIPTION',
    severity: 'INFO',
    describe: (r) => `Upgrade abonnement → plan ${r.body?.plan ?? ''}`,
  },

  {
    method: 'POST',
    pattern: /^\/subscriptions\/cancel$/,
    action: 'SUBSCRIPTION_CANCEL',
    entity: 'SUBSCRIPTION',
    severity: 'CRITICAL',
    describe: () => '🚨 Annulation abonnement',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DOCUMENTS
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'GET',
    pattern: /^\/documents\/[^/]+\/download$/,
    action: 'DOCUMENT_DOWNLOAD',
    entity: 'DOCUMENT',
    severity: 'INFO',
    describe: (r) => `Téléchargement document #${r.params?.id}`,
  },

  {
    method: 'DELETE',
    pattern: /^\/documents\/[^/]+$/,
    action: 'DOCUMENT_DELETE',
    entity: 'DOCUMENT',
    severity: 'WARN',
    describe: (r) => `Suppression document #${r.params?.id}`,
  },

  {
    method: 'POST',
    pattern: /^\/documents\/upload$/,
    action: 'DOCUMENT_UPLOAD',
    entity: 'DOCUMENT',
    severity: 'INFO',
    describe: (r) => `Upload document — employé: ${r.body?.employeeId ?? ''}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PRÉSENCES & POINTAGE
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/attendance\/create-manual$/,
    action: 'ATTENDANCE_MANUAL',
    entity: 'ATTENDANCE',
    severity: 'WARN',
    describe: (r) =>
      `Pointage manuel — employé: ${r.body?.employeeId ?? ''} — ${r.body?.date ?? ''}`,
  },

  {
    method: 'PUT',
    pattern: /^\/attendance\/correct\/[^/]+$/,
    action: 'ATTENDANCE_CORRECT',
    entity: 'ATTENDANCE',
    severity: 'WARN',
    describe: (r) => `Correction présence #${r.params?.attendanceId}`,
  },

  {
    method: 'POST',
    pattern: /^\/attendance\/approve-overtime\/[^/]+$/,
    action: 'OVERTIME_APPROVE',
    entity: 'ATTENDANCE',
    severity: 'INFO',
    describe: (r) => `Validation heures sup #${r.params?.attendanceId}`,
  },

  {
    method: 'POST',
    pattern: /^\/attendance\/reject-overtime\/[^/]+$/,
    action: 'OVERTIME_REJECT',
    entity: 'ATTENDANCE',
    severity: 'INFO',
    describe: (r) => `Rejet heures sup #${r.params?.attendanceId}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MATÉRIEL (ASSETS)
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/assets$/,
    action: 'ASSET_CREATE',
    entity: 'ASSET',
    severity: 'INFO',
    describe: (r) =>
      `Ajout matériel : ${r.body?.name ?? ''} — ${r.body?.type ?? ''}`,
  },

  {
    method: 'PATCH',
    pattern: /^\/assets\/[^/]+\/assign$/,
    action: 'ASSET_ASSIGN',
    entity: 'ASSET',
    severity: 'INFO',
    describe: (r) =>
      `Attribution matériel #${r.params?.id} → employé: ${r.body?.employeeId ?? ''}`,
  },

  {
    method: 'PATCH',
    pattern: /^\/assets\/[^/]+\/status$/,
    action: 'ASSET_STATUS',
    entity: 'ASSET',
    severity: 'INFO',
    describe: (r) =>
      `Changement statut matériel #${r.params?.id} → ${r.body?.status ?? ''}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // RECRUTEMENT
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/recruitment\/jobs$/,
    action: 'JOB_CREATE',
    entity: 'RECRUITMENT',
    severity: 'INFO',
    describe: (r) => `Offre d'emploi créée : ${r.body?.title ?? ''}`,
  },

  {
    method: 'DELETE',
    pattern: /^\/recruitment\/jobs\/[^/]+$/,
    action: 'JOB_DELETE',
    entity: 'RECRUITMENT',
    severity: 'WARN',
    describe: (r) => `Suppression offre #${r.params?.id}`,
  },

  {
    method: 'POST',
    pattern: /^\/recruitment\/candidates\/[^/]+\/convert-to-employee$/,
    action: 'CANDIDATE_HIRED',
    entity: 'RECRUITMENT',
    severity: 'INFO',
    describe: (r) => `Candidat #${r.params?.id} converti en employé`,
  },

  {
    method: 'PATCH',
    pattern: /^\/recruitment\/candidates\/[^/]+\/hr-decision$/,
    action: 'CANDIDATE_DECISION',
    entity: 'RECRUITMENT',
    severity: 'INFO',
    describe: (r) =>
      `Décision RH candidat #${r.params?.id} : ${r.body?.decision ?? ''}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // FORMATION
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/training\/courses$/,
    action: 'TRAINING_CREATE',
    entity: 'TRAINING',
    severity: 'INFO',
    describe: (r) => `Formation créée : ${r.body?.title ?? ''}`,
  },

  {
    method: 'PATCH',
    pattern: /^\/training\/validate\/[^/]+$/,
    action: 'TRAINING_VALIDATE',
    entity: 'TRAINING',
    severity: 'INFO',
    describe: (r) => `Validation formation session #${r.params?.sessionId}`,
  },

  {
    method: 'POST',
    pattern: /^\/training\/assign$/,
    action: 'TRAINING_ASSIGN',
    entity: 'TRAINING',
    severity: 'INFO',
    describe: (r) =>
      `Formation assignée — employé: ${r.body?.employeeId ?? ''}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CONVENTIONS & COTISATIONS
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/conventions\/activate$/,
    action: 'CONVENTION_ACTIVATE',
    entity: 'SETTINGS',
    severity: 'CRITICAL',
    describe: () => '🚨 Activation convention collective — impact paie',
  },

  {
    method: 'POST',
    pattern: /^\/conventions\/rules$/,
    action: 'CONVENTION_RULE',
    entity: 'SETTINGS',
    severity: 'WARN',
    describe: (r) => `Nouvelle règle convention : ${r.body?.name ?? ''}`,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ONBOARDING
  // ══════════════════════════════════════════════════════════════════════════
  {
    method: 'POST',
    pattern: /^\/onboarding$/,
    action: 'ONBOARDING_PLAN',
    entity: 'ONBOARDING',
    severity: 'INFO',
    describe: (r) =>
      `Plan onboarding créé — employé: ${r.body?.employeeId ?? ''}`,
  },
];

// ─── Champs sensibles à toujours masquer dans les logs ───────────────────────
const REDACTED = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'tempToken',
  'temp2faToken',
  'token',
  'secret',
  'twoFactorSecret',
  'backupCode',
  'code',
  'apiKey',
  'refreshToken',
  'accessToken',
]);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = (req.method as string).toUpperCase();
    const path = req.path as string;

    const rule = RULES.find((r) => r.method === method && r.pattern.test(path));
    if (!rule) return next.handle();

    const userId = req.user?.userId ?? null;
    const startTime = Date.now();

    // IP réelle (derrière proxy Nginx)
    const ip =
      (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.ip ??
      'unknown';

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const desc = rule.describe(req);
          const icon =
            rule.severity === 'CRITICAL'
              ? '🚨'
              : rule.severity === 'WARN'
                ? '⚠️ '
                : '✅';

          this.logger.log(
            `${icon} [${rule.action}] ${rule.entity} | ` +
              `user:${userId ?? 'anon'} | IP:${ip} | ${desc} | ${duration}ms`,
          );

          if (userId) {
            this.prisma.activityLog
              .create({
                data: {
                  userId,
                  action: rule.action,
                  entity: rule.entity,
                  entityId:
                    req.params?.id ??
                    req.params?.employeeId ??
                    req.params?.companyId ??
                    null,
                  description: desc,
                  metadata: {
                    severity: rule.severity,
                    method,
                    path,
                    ip,
                    duration,
                    query: Object.keys(req.query ?? {}).length
                      ? req.query
                      : undefined,
                    body: this.sanitize(req.body),
                  },
                },
              })
              .catch((e) =>
                this.logger.error(`Erreur persist audit [${rule.action}]:`, e),
              );
          }
        },

        error: (err) => {
          const duration = Date.now() - startTime;
          this.logger.warn(
            `❌ [${rule.action}_FAILED] ${rule.entity} | ` +
              `user:${userId ?? 'anon'} | IP:${ip} | ${err.message} | ${duration}ms`,
          );

          // Persister aussi les échecs des actions critiques
          const trackFailed = [
            'LOGIN',
            'CHANGE_PASSWORD',
            'RESET_PASSWORD',
            '2FA_DISABLED',
            'CONTRACT_RUPTURE',
            'PAYROLL_DELETE',
            'EMPLOYEE_DELETE',
            'SUBSCRIPTION_CANCEL',
          ];
          if (userId && trackFailed.includes(rule.action)) {
            this.prisma.activityLog
              .create({
                data: {
                  userId,
                  action: `${rule.action}_FAILED`,
                  entity: rule.entity,
                  description: `Échec ${rule.action} : ${err.message}`,
                  metadata: { ip, error: err.message, duration },
                },
              })
              .catch(() => {});
          }
        },
      }),
    );
  }

  private sanitize(body: any): Record<string, any> | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(body)) {
      out[k] = REDACTED.has(k) ? '[REDACTED]' : v;
    }
    return out;
  }
}
