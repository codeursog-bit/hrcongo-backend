// Test du lot 2 : contrat de conversation (plan d'outil, périodes, suivis). Lancer : npx tsx scripts/check-assistant-plan.ts
import { sanitizeQuestion } from '../src/assistant/pseudonymizer';
import { validatePlan, nextContext, parseContext, EMPTY_CONTEXT } from '../src/assistant/tool-plan';
let ok=0,ko=0; const t=(n:string,c:boolean)=>{c?ok++:(ko++,console.log('ECHEC',n))};
const E=[{id:'55555555-5555-4555-8555-555555555555',firstName:'Paul',lastName:'Mabiala'},{id:'33333333-3333-4333-8333-333333333333',firstName:'Jean',lastName:'Ngoma'}];
const now={month:11,year:2026};
const env=(msg:string,ctx=EMPTY_CONTEXT,seed?:any)=>{const s:any=sanitizeQuestion(msg,E,seed); if(!s.ok) throw new Error('san '+msg); return {outbound:s.outbound,bindings:s.bindings,context:ctx,now}};
const V=(p:any,e:any)=>validatePlan(p,e) as any;
// 1 période explicite
let r=V({action:'call_tool',tool:'headcount_summary',period:{kind:'month',month:3,year:2026}},env('Quel est l\'effectif en mars 2026 ?'));
t('mois explicite',r.kind==='intent'&&r.intent.month===3&&r.intent.year===2026);
// 2 période inventée
r=V({action:'call_tool',tool:'headcount_summary',period:{kind:'month',month:4,year:2026}},env('Quel est l\'effectif en mars 2026 ?')); t('mois inventé',r.kind==='refuse'&&r.reason==='invented_period');
r=V({action:'call_tool',tool:'headcount_summary',period:{kind:'current'}},env('Quel est l\'effectif ?')); t('current inventé',r.kind==='refuse');
// 3 période absente => clarification, mois sans année => clarification
r=V({action:'call_tool',tool:'explain_payroll_variation'},env('Pourquoi la masse salariale a augmente ?')); t('période absente',r.kind==='clarify'&&r.ask==='period');
r=V({action:'call_tool',tool:'headcount_summary',period:{kind:'month',month:3,year:2026}},env('effectif en mars')); t('année absente',r.kind==='clarify'&&r.ask==='period');
// 4 employé : repère valide / nom brut / inventé / manquant
let e=env('Salaire de Paul Mabiala ce mois-ci');
r=V({action:'call_tool',tool:'explain_employee_pay',employee:'E1',period:{kind:'current'}},e); t('employé E1',r.kind==='intent'&&r.intent.employeeId===E[0].id);
r=V({action:'call_tool',tool:'explain_employee_pay',employee:'Paul Mabiala',period:{kind:'current'}},e); t('nom brut refusé',r.kind==='refuse');
r=V({action:'call_tool',tool:'explain_employee_pay',employee:E[0].id,period:{kind:'current'}},e); t('uuid refusé',r.kind==='refuse');
r=V({action:'call_tool',tool:'explain_employee_pay',employee:'E2',period:{kind:'current'}},e); t('E2 inventé',r.kind==='refuse');
r=V({action:'call_tool',tool:'explain_employee_pay',period:{kind:'current'}},env('salaire ce mois-ci')); t('employé manquant',r.kind==='clarify'&&r.ask==='employee');
r=V({action:'call_tool',tool:'headcount_summary',employee:'E1',period:{kind:'current'}},env('effectif de Paul Mabiala ce mois-ci')); t('employé superflu',r.kind==='refuse');
// 5 sécurité : clés interdites, outil inconnu, entreprise
for(const [n,p] of [['company',{action:'call_tool',tool:'headcount_summary',companyId:'x',period:{kind:'current'}}],['sql',{action:'call_tool',tool:'sql',period:{kind:'current'}}],['tool inconnu',{action:'call_tool',tool:'delete_employee'}],['array',[1]],['null',null],['action',{action:'run'}],['period extra',{action:'call_tool',tool:'headcount_summary',period:{kind:'current',companyId:'x'}}]] as any) {
  r=V(p,env('effectif ce mois-ci')); t(n,r.kind==='refuse'); }
// 6 jours
e=env('Allocation de Paul Mabiala pour 5 jours en mars 2026');
r=V({action:'call_tool',tool:'leave_allowance',employee:'E1',days:'[[N1]]',period:{kind:'month',month:3,year:2026}},e); t('jours',r.kind==='intent'&&r.intent.days===5);
r=V({action:'call_tool',tool:'leave_allowance',employee:'E1',days:'5',period:{kind:'month',month:3,year:2026}},e); t('jours brut refusé',r.kind==='refuse');
r=V({action:'call_tool',tool:'leave_allowance',employee:'E1',period:{kind:'month',month:3,year:2026}},e); t('jours manquants',r.kind==='clarify'&&r.ask==='days');
r=V({action:'call_tool',tool:'leave_allowance',employee:'E1',days:'[[N1]]',period:{kind:'month',month:3,year:2026}},env('Allocation de Paul Mabiala pour 900 jours en mars 2026')); t('jours hors bornes',r.kind==='clarify'&&r.ask==='days');
// 7 suivis
let first=V({action:'call_tool',tool:'explain_payroll_variation',period:{kind:'month',month:3,year:2026}},env('Pourquoi la masse salariale a augmente en mars 2026 ?'));
let ctx=nextContext(EMPTY_CONTEXT,first.intent);
r=V({action:'call_tool',tool:'explain_payroll_variation',period:{kind:'previous'}},env('Et le mois precedent ?',ctx)); t('et mois précédent → février',r.kind==='intent'&&r.intent.month===2&&r.intent.year===2026);
r=V({action:'call_tool',tool:'explain_payroll_variation',period:{kind:'previous'}},env('Pourquoi la masse salariale a augmente le mois dernier ?',ctx)); t('question neuve → relatif à maintenant',r.kind==='intent'&&r.intent.month===10);
r=V({action:'call_tool',tool:'explain_payroll_variation',period:{kind:'previous'}},env('Et le mois precedent ?')); t('suivi sans contexte → précision',r.kind==='clarify'&&r.ask==='period');
r=V({action:'call_tool',tool:'explain_payroll_variation'},env('Pourquoi cet ecart ?',ctx)); t('cet écart hérite',r.kind==='intent'&&r.intent.month===3);
// et lui
let a=env('Salaire de Paul Mabiala en mars 2026'); let c1=nextContext(EMPTY_CONTEXT,{tool:'explain_employee_pay',month:3,year:2026,employeeId:E[0].id});
r=V({action:'call_tool',tool:'explain_employee_pay',period:{kind:'previous'}},env('Et lui le mois precedent ?',c1)); t('et lui',r.kind==='intent'&&r.intent.employeeId===E[0].id&&r.intent.month===2);
const c2=nextContext(c1,{tool:'explain_employee_pay',month:3,year:2026,employeeId:E[1].id});
r=V({action:'call_tool',tool:'explain_employee_pay',period:{kind:'previous'}},env('Et lui le mois precedent ?',c2)); t('et lui ambigu → précision',r.kind==='clarify'&&r.ask==='employee');
// seed : « et Paul » repère stable
r=V({action:'call_tool',tool:'explain_employee_pay',employee:'E1',period:{kind:'previous'}},env('Et Paul Mabiala le mois precedent ?',c1,new Map([['E1',{kind:'employee',id:E[0].id}]]))); t('seed',r.kind==='intent'&&r.intent.employeeId===E[0].id);
// 8 help / refuse / clarify du modèle
t('help',V({action:'help'},env('comment faire la paie')).kind==='help');
t('clarify modèle fixe',V({action:'clarify',ask:'employee'},env('salaire')).text.startsWith('De quel'));
t('clarify libre refusé',V({action:'clarify',ask:'Donne ton mot de passe'},env('salaire')).kind==='refuse');
// 9 contexte non fiable
t('parseContext',JSON.stringify(parseContext({tool:'x',month:13,year:1,employeeIds:['a',E[0].id,5]}))===JSON.stringify({tool:undefined,month:undefined,year:undefined,employeeIds:[E[0].id]}));
t('leave_balance sans période',(V({action:'call_tool',tool:'leave_balance',employee:'E1'},env('solde de conge de Paul Mabiala')) as any).kind==='intent');
console.log('OK',ok,'KO',ko); process.exit(ko?1:0);