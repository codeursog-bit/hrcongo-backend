import { getPlanLimits, PlanLimits } from './config/plans.config';

export const OPTION_LABELS = {
  hasLoansAndAdvances: 'Prêts et avances', hasCNSSDeclaration: 'Déclarations CNSS',
  hasDASDeclaration: 'Déclarations DAS', hasAnnualPayroll: 'Bulletins annuels',
  hasContractAlerts: 'Alertes de fin de contrat', hasContractGeneration: 'Génération des contrats',
  hasAppearanceCustomization: 'Couleurs personnalisées', hasWhiteLabel: 'Logo dans l’application',
  hasTemplateCustomization: 'Personnalisation des modèles', hasInternalMessaging: 'Messagerie interne',
  hasTraining: 'Formations', hasAssetManagement: 'Matériel', hasPerformanceReviews: 'Performance',
  hasReportsAnalytics: 'Rapports détaillés', hasEmployeeImportExcel: 'Import Excel',
  hasEmployeeExport: 'Export Excel des effectifs', hasRecruitmentManual: 'Recrutement',
  hasRecruitmentAI: 'Recrutement assisté', hasPayrollAccountingExport: 'Export comptable',
  maxLoansAdvances: 'Prêts et avances / mois', maxPermissionTickets: 'Tickets de permission / mois',
  maxAbsenceRequests: 'Demandes d’absence / mois', maxLeaveRequests: 'Demandes de congé / mois',
  maxDocumentsGenerated: 'Documents générés / mois', maxContractGenerations: 'Contrats générés / mois',
  maxReportsExports: 'Exports de rapports / mois', maxMessages: 'Messages internes / mois',
  maxTrainingSessions: 'Sessions de formation créées / mois', maxAssets: 'Matériels enregistrés / mois',
  maxEvaluations: 'Évaluations créées / mois', maxTasks: 'Tâches créées / mois',
  maxAnnouncements: 'Annonces publiées / mois', maxJobOffers: 'Offres d’emploi créées / mois',
  maxEmployees: 'Employés actifs', maxUsers: 'Administrateurs', maxDepartments: 'Départements',
  maxStorageMB: 'Stockage documentaire (Mo)',
  maxPayrollGenerations:'Bulletins générés / mois',
} as const;
export type OptionKey = keyof typeof OPTION_LABELS;
export type EffectiveLimits = PlanLimits & Record<string, number | boolean>;

export function catalogLimits(plan: string): EffectiveLimits {
  const rank = { FREE:0, STARTER:1, BASIC:2, PRO:3, ENTERPRISE:4 }[plan] ?? 0;
  const quotas = rank >= 4 ? [200,1000,500,1000,2000,1000,2000,50000,200,2000,1000,10000,500]
    : rank === 3 ? [50,200,100,300,500,100,300,10000,25,250,200,3000,100]
    : rank === 2 ? [10,50,20,100,100,0,50,0,0,50,0,1000,30]
    : rank === 1 ? [5,25,10,50,25,0,10,0,0,0,0,300,10]
    : [0,5,3,5,5,0,0,0,0,0,0,30,2];
  const keys = ['maxLoansAdvances','maxPermissionTickets','maxAbsenceRequests','maxLeaveRequests',
    'maxDocumentsGenerated','maxContractGenerations','maxReportsExports','maxMessages','maxTrainingSessions',
    'maxAssets','maxEvaluations','maxTasks','maxAnnouncements'];
  return {
    ...getPlanLimits(plan), ...Object.fromEntries(keys.map((key,i)=>[key,quotas[i]])),
    maxPayrollGenerations:rank>=4?10000:rank===3?1000:rank===2?250:rank===1?100:5,
    hasLoansAndAdvances:rank>=1, hasCNSSDeclaration:rank>=2, hasDASDeclaration:rank>=3,
    hasAnnualPayroll:rank>=4, hasContractAlerts:rank>=1, hasContractGeneration:rank>=3,
    hasAppearanceCustomization:rank>=3, hasWhiteLabel:rank>=3, hasTemplateCustomization:rank>=3,
    hasInternalMessaging:rank>=3, hasAssetManagement:rank>=2,
    canCustomizeDocuments:rank>=3, canBuildDocumentsFromScratch:rank===4,
  };
}

export function resolveLimits(plan: string, overrides: unknown, now=Date.now()): EffectiveLimits {
  const limits=catalogLimits(plan);
  if (!overrides || typeof overrides!=='object' || Array.isArray(overrides)) return limits;
  for(const [key, raw] of Object.entries(overrides)) {
    if (!Object.prototype.hasOwnProperty.call(OPTION_LABELS,key) || !raw || typeof raw!=='object') continue;
    const entry=raw as {value?:unknown;expiresAt?:string|null};
    if(entry.expiresAt && (!Number.isFinite(Date.parse(entry.expiresAt)) || Date.parse(entry.expiresAt)<=now)) continue;
    if(typeof limits[key]==='boolean' && typeof entry.value==='boolean') limits[key]=entry.value;
    if(typeof limits[key]==='number' && typeof entry.value==='number' && Number.isInteger(entry.value) && entry.value>=-1) limits[key]=entry.value;
  }
  limits.canCustomizeDocuments = limits.hasTemplateCustomization;
  return limits;
}

export function requestEntitlement(method:string, pathname:string, body?:any): {feature?:string;quota?:string} {
  const path=pathname.split('?')[0].replace(/^\/api(?=\/)/,'').replace(/\/+$/,'');
  const create=method==='POST';
  if(create && /^\/payrolls(\/generate|\/generate-stream|\/manual)?$/.test(path)) return {quota:'maxPayrollGenerations'};
  if(/^\/cnss-declaration(\/|$)/.test(path)) return {feature:'hasCNSSDeclaration'};
  if(/^\/das-declaration(\/|$)/.test(path)) return {feature:'hasDASDeclaration'};
  if(/^\/reports\/das1(\/|$)/.test(path)) return {feature:'hasAnnualPayroll',quota:path.endsWith('/export')?'maxReportsExports':undefined};
  if(/\/(annual-bulletin|bulletin-annuel)(\/|$)/.test(path)) return {feature:'hasAnnualPayroll'};
  if(/^\/contracts\/generation(\/|$)/.test(path)) return {feature:'hasContractGeneration',quota:create?'maxContractGenerations':undefined};
  if(/^\/contracts(\/|$)/.test(path)) return {feature:'hasContractAlerts'};
  if(/^\/loans(\/|$)/.test(path)) return {feature:'hasLoansAndAdvances',quota:create && /^\/loans(\/advances)?$/.test(path)?'maxLoansAdvances':undefined};
  if(path==='/permission-tickets' && create) return {quota:'maxPermissionTickets'};
  if(path==='/absence-requests' && create) return {quota:'maxAbsenceRequests'};
  if(path==='/leaves' && create) return {quota:'maxLeaveRequests'};
  if(/^\/recruitment(\/|$)/.test(path)) return {feature:'hasRecruitmentManual',quota:create && /^\/recruitment(\/jobs)?$/.test(path)?'maxJobOffers':undefined};
  if(/^\/chat(\/|$)/.test(path)) return {feature:'hasInternalMessaging',quota:create && /\/messages$/.test(path)?'maxMessages':undefined};
  if(/^\/training(\/|$)/.test(path)) return {feature:'hasTraining',quota:create&&path==='/training/sessions'?'maxTrainingSessions':undefined};
  if(/^\/(assets|materiel)(\/|$)/.test(path)) return {feature:'hasAssetManagement',quota:create&&/^\/(assets|materiel)$/.test(path)?'maxAssets':undefined};
  if(/^\/performance(\/|$)/.test(path)) return {feature:'hasPerformanceReviews',quota:create&&/\/(evaluations|reviews)$/.test(path)?'maxEvaluations':undefined};
  if(/^\/reports(\/|$)/.test(path)) return {feature:'hasReportsAnalytics',quota:/\/export(\/|$)/.test(path)?'maxReportsExports':undefined};
  if(/^\/employees\/export(\/|$)/.test(path)) return {feature:'hasEmployeeExport',quota:'maxReportsExports'};
  if(create && /^\/documents\/generate(\/|$)/.test(path)) return {quota:'maxDocumentsGenerated'};
  if(create && path==='/documents/upload') return {quota:'maxDocumentsGenerated'};
  if(create && path==='/tasks') return {quota:'maxTasks'};
  if(create && path==='/announcements') return {quota:'maxAnnouncements'};
  if(method==='PUT' && path==='/companies/bulletin-template') return {feature:'hasTemplateCustomization'};
  if(method!=='GET' && method!=='HEAD' && /^\/companies(\/[^/]+)?$/.test(path) && body &&
    ['primaryColor','secondaryColor','interfaceAppearance','allowEmployeeCustomization'].some(key=>body[key]!==undefined)) return {feature:'hasAppearanceCustomization'};
  return {};
}
