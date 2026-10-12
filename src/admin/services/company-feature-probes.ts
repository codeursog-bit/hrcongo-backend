// ============================================================================
// 📁 src/admin/services/company-feature-probes.ts
// SONDES D'USAGE : comment mesurer l'utilisation de chaque fonctionnalité par
// une entreprise (page « détail entreprise » du super admin).
//
// ➕ Nouvelle fonctionnalité dans l'app ? Ajoute UNE entrée dans FEATURE_PROBES :
//    elle apparaît toute seule (classement, dernière utilisation, volume en base).
// ============================================================================

export interface FeatureProbe {
  key: string;
  label: string;
  /** Ce qu'on compte (affiché à côté du nombre) */
  unit: string;
  /** Clé de PlanLimits qui active la fonctionnalité (absente = toujours incluse) */
  planFlag?: string;
  /** Delegate Prisma (prisma[model]) */
  model: string;
  /** Champ date utilisé pour « 30 derniers jours » et « dernière utilisation » */
  dateField: string;
  /** Filtre « lignes appartenant à cette entreprise » */
  where: (companyId: string) => Record<string, any>;
  /** Table SQL (pour estimer le volume en base) */
  table: string;
}

export const FEATURE_PROBES: FeatureProbe[] = [
  { key: 'attendance', label: 'Pointage', unit: 'pointages', planFlag: 'hasAttendanceManual',
    model: 'attendance', dateField: 'createdAt', table: 'attendances',
    where: (c) => ({ companyId: c }) },
  { key: 'attendance_corrections', label: 'Corrections de pointage', unit: 'corrections', planFlag: 'hasAttendanceCorrections',
    model: 'attendanceCorrection', dateField: 'modifiedAt', table: 'attendance_corrections',
    where: (c) => ({ attendance: { companyId: c } }) },
  { key: 'payroll', label: 'Paie (bulletins)', unit: 'bulletins', planFlag: 'hasPayrollIndividual',
    model: 'payroll', dateField: 'createdAt', table: 'payrolls',
    where: (c) => ({ companyId: c }) },
  { key: 'leaves', label: 'Congés', unit: 'demandes', planFlag: 'hasLeaveManagement',
    model: 'leave', dateField: 'createdAt', table: 'leaves',
    where: (c) => ({ companyId: c }) },
  { key: 'absences', label: 'Absences', unit: 'demandes', planFlag: 'hasLeaveManagement',
    model: 'absenceRequest', dateField: 'createdAt', table: 'absence_requests',
    where: (c) => ({ companyId: c }) },
  { key: 'permissions', label: 'Permissions de sortie', unit: 'tickets',
    model: 'permissionTicket', dateField: 'createdAt', table: 'permission_tickets',
    where: (c) => ({ companyId: c }) },
  { key: 'loans', label: 'Prêts', unit: 'prêts', planFlag: 'hasLoansAndAdvances',
    model: 'loan', dateField: 'createdAt', table: 'loans',
    where: (c) => ({ employee: { companyId: c } }) },
  { key: 'advances', label: 'Avances sur salaire', unit: 'avances', planFlag: 'hasLoansAndAdvances',
    model: 'advance', dateField: 'createdAt', table: 'advances',
    where: (c) => ({ employee: { companyId: c } }) },
  { key: 'documents', label: 'Documents', unit: 'documents', planFlag: 'hasDocumentManagement',
    model: 'document', dateField: 'createdAt', table: 'documents',
    where: (c) => ({ companyId: c }) },
  { key: 'recruitment', label: 'Recrutement (candidatures)', unit: 'candidatures', planFlag: 'hasRecruitmentManual',
    model: 'candidate', dateField: 'createdAt', table: 'candidates',
    where: (c) => ({ jobOffer: { companyId: c } }) },
  { key: 'training', label: 'Formations', unit: 'inscriptions', planFlag: 'hasTraining',
    model: 'employeeTraining', dateField: 'createdAt', table: 'employee_trainings',
    where: (c) => ({ employee: { companyId: c } }) },
  { key: 'reviews', label: 'Évaluations de performance', unit: 'évaluations', planFlag: 'hasPerformanceReviews',
    model: 'performanceReview', dateField: 'createdAt', table: 'performance_reviews',
    where: (c) => ({ employee: { companyId: c } }) },
  { key: 'onboarding', label: 'Intégration (onboarding)', unit: 'parcours', planFlag: 'hasOnboarding',
    model: 'onboardingProcess', dateField: 'createdAt', table: 'onboarding_processes',
    where: (c) => ({ employee: { companyId: c } }) },
  { key: 'assets', label: 'Matériel / actifs', unit: 'équipements', planFlag: 'hasAssetManagement',
    model: 'asset', dateField: 'createdAt', table: 'assets',
    where: (c) => ({ companyId: c }) },
  { key: 'contracts', label: 'Contrats générés', unit: 'contrats',
    model: 'generatedContract', dateField: 'generatedAt', table: 'generated_contracts',
    where: (c) => ({ companyId: c }) },
  { key: 'cnss', label: 'Déclarations CNSS', unit: 'déclarations',
    model: 'cnssDeclaration', dateField: 'createdAt', table: 'cnss_declarations',
    where: (c) => ({ companyId: c }) },
  { key: 'shifts', label: 'Plannings / équipes', unit: 'affectations',
    model: 'employeeShiftAssignment', dateField: 'createdAt', table: 'employee_shift_assignments',
    where: (c) => ({ companyId: c }) },
  { key: 'chat', label: 'Messagerie interne', unit: 'messages',
    model: 'chatMessage', dateField: 'createdAt', table: 'chat_messages',
    where: (c) => ({ conversation: { companyId: c } }) },
];

/**
 * Tables qui pèsent dans la base mais ne sont pas des « fonctionnalités » :
 * uniquement pour estimer le volume de données de l'entreprise.
 */
export const STORAGE_EXTRAS: { table: string; label: string; model: string; where: (companyId: string) => Record<string, any> }[] = [
  { table: 'employees', label: 'Fiches employés', model: 'employee', where: (c) => ({ companyId: c }) },
  { table: 'users', label: 'Comptes utilisateurs', model: 'user', where: (c) => ({ companyId: c }) },
  { table: 'payroll_items', label: 'Lignes de bulletins', model: 'payrollItem', where: (c) => ({ payroll: { companyId: c } }) },
  { table: 'attendance_summaries', label: 'Résumés de présence', model: 'attendanceSummary', where: (c) => ({ employee: { companyId: c } }) },
  { table: 'leave_balances', label: 'Soldes de congés', model: 'leaveBalance', where: (c) => ({ employee: { companyId: c } }) },
  { table: 'employee_bonuses', label: 'Primes', model: 'employeeBonus', where: (c) => ({ employee: { companyId: c } }) },
  { table: 'attendance_breaks', label: 'Pauses', model: 'attendanceBreak', where: (c) => ({ companyId: c }) },
  { table: 'notifications', label: 'Notifications', model: 'notification', where: (c) => ({ user: { companyId: c } }) },
  { table: 'activity_logs', label: 'Journal d’audit', model: 'activityLog', where: (c) => ({ user: { companyId: c } }) },
];