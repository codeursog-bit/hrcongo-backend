import { createHash } from 'node:crypto';
import { AccountPlan, classifyGain, DEFAULT_PLAN, getPlanForPeriod, grossKey, isNonNational, labelOfGrossKey, resolveAccount } from '../accounting/syscohada';

export type SnapshotItem = {code:string|null;label:string;type:string;amount:unknown;isTaxable:boolean;isNature?:boolean|null};
export type PayrollSnapshot = {id:string;companyId:string;employee:{id:string;firstName:string;lastName:string;nationality?:string|null};status:string;paid:boolean;month:number;year:number;periodEnd:Date;grossSalary:unknown;netSalary:unknown;totalDeductions:unknown;cnssSalarial:unknown;cnssEmployer:unknown;cnssEmployerPension?:unknown;cnssEmployerFamily?:unknown;cnssEmployerAccident?:unknown;its:unknown;tusDgiAmount:unknown;tusCnssAmount:unknown;employeeCustomTaxTotal:unknown;employerCustomTaxTotal:unknown;items:SnapshotItem[]};
export type SemanticLine = {key:string;label:string;debit:number;credit:number};
export function fcfa(value:unknown):number {
 const n=Number(String(value ?? 0));
 if(!Number.isSafeInteger(n)||n<0) throw new Error('MONTANT_XAF_INVALIDE : montants entiers non négatifs exigés, sans arrondi implicite.');
 return n;
}

/** Bulletins comptabilisables dans le journal : ni brouillon, ni annulé. */
export const ACCOUNTABLE_STATUSES = ['VALIDATED','TO_PAY','PAID'] as const;

/**
 * Écriture de constatation d'un bulletin, par rubrique sémantique, SANS contrôle de statut.
 * Brut ventilé par nature (66110/66122/66123/66130/663xx), indemnités non imposables
 * ventilées, retenues par code. Équilibre exigé ; aucune ligne de compensation inventée.
 */
export function computeLines(p:PayrollSnapshot):SemanticLine[] {
 const lines:SemanticLine[]=[];
 const add=(key:string,label:string,value:unknown,side:'debit'|'credit')=>{const n=fcfa(value);if(n)lines.push({key,label,debit:side==='debit'?n:0,credit:side==='credit'?n:0});};
 const nonNational=isNonNational(p.employee.nationality);

 // ── Rémunérations : brut ventilé. Le salaire de base est le résidu du brut
 //    (déjà net des absences) : la somme ventilée = le brut enregistré, toujours.
 const gross=fcfa(p.grossSalary);
 const buckets=new Map<string,number>();
 const bucket=(key:string,amount:number)=>buckets.set(key,(buckets.get(key)??0)+amount);
 let taxableGains=0;
 for(const item of p.items.filter(i=>i.type==='GAIN'&&i.isTaxable&&i.code!=='SAL_BASE')){
  const amount=fcfa(item.amount);taxableGains+=amount;
  bucket(grossKey(classifyGain(item),nonNational),amount);
 }
 const base=gross-taxableGains;
 if(base<0)throw new Error('VENTILATION_BRUT_INCOHERENTE : les rubriques imposables dépassent le brut enregistré.');
 bucket(grossKey('BASE',nonNational),base);
 // Indemnités non imposables (transport, panier, …) : ventilées par nature.
 for(const item of p.items.filter(i=>i.type==='GAIN'&&!i.isTaxable))bucket(grossKey(classifyGain(item),nonNational),fcfa(item.amount));
 for(const [key,amount] of buckets)add(key,labelOfGrossKey(key),amount,'debit');

 add('NET','Rémunérations nettes dues',p.netSalary,'credit');
 add('CNSS_SAL','CNSS retenue aux salariés',p.cnssSalarial,'credit');
 const fiscal=p.items.find(i=>i.code==='BNC_SOURCE');
 add(fiscal?'BNC':'ITS',fiscal?'Retenue BNC':'Impôt sur les traitements et salaires',p.its,'credit');
 const ignored=new Set(['ABS_DEDUCT','ABS_CONGE','CNSS_SAL','ITS','BNC_SOURCE']);
 let otherDeductions=0,customTaxes=0;
 for(const item of p.items.filter(i=>i.type==='DEDUCTION'&&!ignored.has(i.code??''))){
  if(!item.code)throw new Error('RUBRIQUE_SANS_CODE : une retenue nécessite une affectation explicite.');
  const amount=fcfa(item.amount);otherDeductions+=amount;
  if(item.code.startsWith('CTAX_'))customTaxes+=amount;
  add(item.code,item.label,amount,'credit');
 }
 if(customTaxes!==fcfa(p.employeeCustomTaxTotal))throw new Error('DETAIL_TAXES_INCOHERENT : les taxes détaillées diffèrent du bulletin.');
 const deductions=fcfa(p.cnssSalarial)+fcfa(p.its)+otherDeductions;
 if(deductions!==fcfa(p.totalDeductions))throw new Error('DETAIL_RETENUES_INCOHERENT : les retenues détaillées diffèrent du bulletin.');
 const employer=(key:string,label:string,value:unknown,expenseKey=key+'_EXPENSE')=>{add(expenseKey,label,value,'debit');add(key+'_LIABILITY',label+' à reverser',value,'credit');};
 // CNSS patronale : charge 6641/6642 ; dette ventilée retraite 4313 / famille 4311 / AT 4312
 // à partir des montants déjà enregistrés sur le bulletin (aucun recalcul). Bulletins
 // anciens non ventilés : dette sur le compte parent 431.
 {
  const total=fcfa(p.cnssEmployer),pension=fcfa(p.cnssEmployerPension??0),family=fcfa(p.cnssEmployerFamily??0),accident=fcfa(p.cnssEmployerAccident??0);
  add(nonNational?'CNSS_EMP_EXPENSE_PE':'CNSS_EMP_EXPENSE','Charges patronales CNSS',total,'debit');
  if(total>0&&pension+family+accident===total){
   add('CNSS_EMP_PENSION_LIABILITY','CNSS patronale — retraite (PVID)',pension,'credit');
   add('CNSS_EMP_FAMILY_LIABILITY','CNSS patronale — prestations familiales',family,'credit');
   add('CNSS_EMP_ACCIDENT_LIABILITY','CNSS patronale — accidents du travail',accident,'credit');
  } else add('CNSS_EMP_LIABILITY','Charges patronales CNSS à reverser',total,'credit');
 }
 employer('TUS_DGI','TUS part DGI',p.tusDgiAmount);
 employer('TUS_CNSS','TUS part CNSS',p.tusCnssAmount);
 let employerCustom=0;
 for(const item of p.items.filter(i=>i.type==='EMPLOYER_COST'&&i.code?.startsWith('CTAX_EMP_'))){employerCustom+=fcfa(item.amount);employer(item.code!,item.label,item.amount);}
 if(employerCustom!==fcfa(p.employerCustomTaxTotal))throw new Error('DETAIL_TAXES_PATRONALES_INCOHERENT.');
 const debit=lines.reduce((s,l)=>s+l.debit,0),credit=lines.reduce((s,l)=>s+l.credit,0);
 if(!Number.isSafeInteger(debit)||debit<=0||debit!==credit)throw new Error('PAIE_DESEQUILIBREE : les données enregistrées du bulletin ne se compensent pas ; aucune ligne de compensation inventée.');
 return lines;
}

/** Connecteur : seuls les bulletins À payer et non payés sont transmis. */
export function payrollLines(p:PayrollSnapshot):SemanticLine[] {
 if(p.status!=='TO_PAY'||p.paid) throw new Error('PAIE_NON_A_PAYER : seuls les bulletins au statut À payer et non déjà payés sont transmis.');
 return computeLines(p);
}

/** Affecte un compte à chaque ligne : liaison de l'entreprise, sinon plan en vigueur (défaut ⊕ super admin). */
export function accountLines(lines:SemanticLine[],mappings:Record<string,string>|null|undefined,plan:Readonly<AccountPlan>=DEFAULT_PLAN){
 return lines.map(l=>{
  const account=resolveAccount(l.key,mappings,plan);
  if(!account)throw new Error('AFFECTATION_ABSENTE : '+l.label+' ('+l.key+').');
  return {accountCode:account.code,accountName:account.name,category:l.key,label:l.label,debit:l.debit,credit:l.credit};
 });
}
export function buildPayrollEvent(p:PayrollSnapshot,mappings:Record<string,string>,plan:Readonly<AccountPlan>=getPlanForPeriod(p.year,p.month)) {
 // accountName reste interne (écrans, exports) : le contrat Konza Connect v1 n'est pas modifié.
 const lines=accountLines(payrollLines(p),mappings,plan).map(({accountName:_n,...line})=>line);
 return {schemaVersion:1,id:'rh:payroll:'+p.id,type:'PAYROLL_TO_PAY',reference:'Paie '+String(p.month).padStart(2,'0')+'/'+p.year+' · '+p.id.slice(0,8),data:{companyId:p.companyId,employee:{id:p.employee.id,name:(p.employee.firstName+' '+p.employee.lastName).trim()},currency:'XAF',status:'TO_PAY',payrollId:p.id,date:p.periodEnd.toISOString().slice(0,10),periodLabel:String(p.month).padStart(2,'0')+'/'+p.year,employeeCount:1,netToPay:fcfa(p.netSalary),lines}};
}
export const payloadHash=(payload:unknown)=>createHash('sha256').update(canonicalJson(payload)).digest('hex');


/** Contrat Konza Connect v1 : JSON canonique signé, XAF entiers, événements immuables. */
export function canonicalJson(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().filter(key=>(value as Record<string,unknown>)[key]!==undefined).map(key=>JSON.stringify(key)+':'+canonicalJson((value as Record<string,unknown>)[key])).join(',')+'}';
 const encoded=JSON.stringify(value);if(encoded===undefined)throw new Error('Valeur JSON non supportée.');return encoded;
}