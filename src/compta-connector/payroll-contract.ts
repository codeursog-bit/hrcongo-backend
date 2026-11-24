
import { createHash } from 'node:crypto';

export type SnapshotItem = {code:string|null;label:string;type:string;amount:unknown;isTaxable:boolean};
export type PayrollSnapshot = {id:string;companyId:string;employee:{id:string;firstName:string;lastName:string};status:string;paid:boolean;month:number;year:number;periodEnd:Date;grossSalary:unknown;netSalary:unknown;totalDeductions:unknown;cnssSalarial:unknown;cnssEmployer:unknown;its:unknown;tusDgiAmount:unknown;tusCnssAmount:unknown;employeeCustomTaxTotal:unknown;employerCustomTaxTotal:unknown;items:SnapshotItem[]};
export type SemanticLine = {key:string;label:string;debit:number;credit:number};
export function fcfa(value:unknown):number {
 const n=Number(String(value ?? 0));
 if(!Number.isSafeInteger(n)||n<0) throw new Error('MONTANT_XAF_INVALIDE : montants entiers non négatifs exigés, sans arrondi implicite.');
 return n;
}
export function payrollLines(p:PayrollSnapshot):SemanticLine[] {
 if(p.status!=='TO_PAY'||p.paid) throw new Error('PAIE_NON_A_PAYER : seuls les bulletins au statut À payer et non déjà payés sont transmis.');
 const lines:SemanticLine[]=[];
 const add=(key:string,label:string,value:unknown,side:'debit'|'credit')=>{const n=fcfa(value);if(n)lines.push({key,label,debit:side==='debit'?n:0,credit:side==='credit'?n:0});};
 add('GROSS','Rémunérations brutes',p.grossSalary,'debit');
 const indemnities=p.items.filter(i=>i.type==='GAIN'&&!i.isTaxable).reduce((n,i)=>n+fcfa(i.amount),0);
 add('NON_TAXABLE','Indemnités non imposables',indemnities,'debit');
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
 const employer=(key:string,label:string,value:unknown)=>{add(key+'_EXPENSE',label,value,'debit');add(key+'_LIABILITY',label+' à reverser',value,'credit');};
 employer('CNSS_EMP','Charges patronales CNSS',p.cnssEmployer);
 employer('TUS_DGI','TUS part DGI',p.tusDgiAmount);
 employer('TUS_CNSS','TUS part CNSS',p.tusCnssAmount);
 let employerCustom=0;
 for(const item of p.items.filter(i=>i.type==='EMPLOYER_COST'&&i.code?.startsWith('CTAX_EMP_'))){employerCustom+=fcfa(item.amount);employer(item.code!,item.label,item.amount);}
 if(employerCustom!==fcfa(p.employerCustomTaxTotal))throw new Error('DETAIL_TAXES_PATRONALES_INCOHERENT.');
 const debit=lines.reduce((s,l)=>s+l.debit,0),credit=lines.reduce((s,l)=>s+l.credit,0);
 if(!Number.isSafeInteger(debit)||debit<=0||debit!==credit)throw new Error('PAIE_DESEQUILIBREE : les données enregistrées du bulletin ne se compensent pas ; aucune ligne de compensation inventée.');
 return lines;
}
export function buildPayrollEvent(p:PayrollSnapshot,mappings:Record<string,string>) {
 const semantic=payrollLines(p);
 const lines=semantic.map(l=>{
  const accountCode=mappings[l.key];
  if(!accountCode||!/^\d{2,10}$/.test(accountCode))throw new Error('AFFECTATION_ABSENTE : '+l.label+' ('+l.key+').');
  return {accountCode,category:l.key,label:l.label,debit:l.debit,credit:l.credit};
 });
 return {schemaVersion:1,id:'rh:payroll:'+p.id,type:'PAYROLL_TO_PAY',reference:'Paie '+String(p.month).padStart(2,'0')+'/'+p.year+' · '+p.id.slice(0,8),data:{companyId:p.companyId,employee:{id:p.employee.id,name:(p.employee.firstName+' '+p.employee.lastName).trim()},currency:'XAF',status:'TO_PAY',payrollId:p.id,date:p.periodEnd.toISOString().slice(0,10),periodLabel:String(p.month).padStart(2,'0')+'/'+p.year,employeeCount:1,netToPay:fcfa(p.netSalary),lines}};
}
export const payloadHash=(payload:unknown)=>createHash('sha256').update(canonicalJson(payload)).digest('hex');


/** Contrat Konza Connect v1 : JSON canonique signé, XAF entiers, événements immuables. */
export function canonicalJson(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().filter(key=>(value as Record<string,unknown>)[key]!==undefined).map(key=>JSON.stringify(key)+':'+canonicalJson((value as Record<string,unknown>)[key])).join(',')+'}';
 const encoded=JSON.stringify(value);if(encoded===undefined)throw new Error('Valeur JSON non supportée.');return encoded;
}
