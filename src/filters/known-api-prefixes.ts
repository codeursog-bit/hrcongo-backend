// ============================================================================
// 📁 src/filters/known-api-prefixes.ts
// Premiers segments d'URL réellement servis par l'API (déduits des @Controller).
// Utilisé par GlobalExceptionFilter : un 404 SANS utilisateur connecté dont le
// chemin ne commence pas par l'un de ces préfixes est une sonde de robot
// (/config.json, /aws, /wp-admin…) → ni stocké dans app_errors, ni logué.
//
// À tenir à jour : le test known-api-prefixes.spec.ts échoue si un contrôleur
// utilise un préfixe absent de cette liste.
// ============================================================================
export const KNOWN_API_PREFIXES: ReadonlySet<string> = new Set([
  'absence-requests',
  'absence-tracking',
  'accounting',
  'admin',
  'affiliate',
  'anniversaries',
  'announcements',
  'appearance',
  'approvals',
  'assets',
  'assistant',
  'attendance',
  'attendance-break',
  'attendance-dashboard',
  'audit',
  'audit-engine',
  'audit-trail',
  'auth',
  'blog',
  'bonus-templates',
  'cabinet',
  'chat',
  'checkin-devices',
  'client-errors',
  'cnss-declaration',
  'companies',
  'company-deductions',
  'company-taxes',
  'compta-connector',
  'contact',
  'contract-chain',
  'contract-templates',
  'contracts',
  'conventions',
  'das-declaration',
  'dashboard',
  'day-events',
  'day-overview',
  'departments',
  'device-sync',
  'display',
  'document-layouts',
  'documents',
  'echelon-suggestions',
  'employee-bonuses',
  'employees',
  'finance',
  'health',
  'leaves',
  'legal-parameters',
  'loans',
  'loans-dashboard',
  'notifications',
  'onboarding',
  'payroll-journal',
  'payroll-settings',
  'payrolls',
  'performance',
  'permission-tickets',
  'pointage-qr',
  'portfolio',
  'pse',
  'public',
  'push',
  'recruitment',
  'reports',
  'rupture',
  'subscriptions',
  'support',
  'tasks',
  'training',
  'unpaid-salary',
  'users',
  'webhooks',
  'workforce-dashboard',
]);

/** Premier segment du chemin, en minuscules ("/Employees/12?x=1" → "employees"). */
export function firstSegment(path: string): string {
  return (path ?? '').replace(/^\/+/, '').split(/[/?#]/, 1)[0].toLowerCase();
}

export function isKnownApiPath(path: string): boolean {
  const seg = firstSegment(path);
  return seg !== '' && KNOWN_API_PREFIXES.has(seg);
}