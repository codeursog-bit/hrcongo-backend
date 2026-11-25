import { Prisma } from '@prisma/client';

const number=(value:unknown)=>Number(value??0);
export const NON_TAXABLE_EXCLUSIONS=['SAL_BASE','INDEM_CONGE','CONGE_SUPP','HS_10','HS_25','HS_50','HS_100'];
export const GROSS_DEDUCTIONS=['ABS_DEDUCT','ABS_CONGE'];
export interface StoredItemGroup {
  code:string|null;label:string;type:string;rate:unknown;isTaxable:boolean;isCnss:boolean;
  _sum:{amount:unknown;base:unknown};
}
export function buildCostDetails(groups:StoredItemGroup[],totals:{gross:number;deductions:number;employerCharges:number}) {
  const composition:Record<string,number>={base:0,bonuses:0,overtime:0,seniority:0,leave:0,grossDeductions:0};
  const labels:Record<string,string>={base:'Salaire de base avant absences',bonuses:'Primes imposables et autres gains',overtime:'Heures supplémentaires',seniority:'Ancienneté',leave:'Indemnités de congé dans le brut',grossDeductions:'Déductions sur le brut (absences, congés)'};
  const employeeCharges:any[]=[],employerCharges:any[]=[];
  for(const group of groups) {
    const code=group.code??'',value=number(group._sum.amount);
    if(group.type==='GAIN') {
      if(!group.isTaxable&&!group.isCnss&&!NON_TAXABLE_EXCLUSIONS.includes(code))continue;
      const key=code==='SAL_BASE'?'base':/^HS_/.test(code)?'overtime':/ANCIENNET/i.test(group.label.normalize('NFD').replace(/[\u0300-\u036f]/g,''))?'seniority':['INDEM_CONGE','CONGE_SUPP'].includes(code)?'leave':'bonuses';
      composition[key]+=value;
    } else if(group.type==='DEDUCTION'&&GROSS_DEDUCTIONS.includes(code)) composition.grossDeductions-=value;
    else if(group.type==='DEDUCTION'||group.type==='EMPLOYER_COST') {
      const employer=group.type==='EMPLOYER_COST',denominator=employer?totals.employerCharges:totals.deductions;
      (employer?employerCharges:employeeCharges).push({code,label:group.label,
        base:group._sum.base===null?null:number(group._sum.base),ratePercent:group.rate===null?null:number(group.rate)*100,
        appliedCeiling:null,ceilingNote:'Plafond appliqué non historisé dans les lignes de ce bulletin.',
        amount:value,share:denominator===0?null:value/denominator*100,
        kind:employer?'EMPLOYER':code==='LOAN'?'LOAN':code==='ADVANCE'?'ADVANCE':['CNSS_SAL','ITS','BNC_SOURCE'].includes(code)||code.startsWith('CTAX_')?'EMPLOYEE_TAX':'OTHER_DEDUCTION'});
    }
  }
  return {composition:Object.entries(composition).filter(([,amount])=>amount!==0).map(([key,amount])=>({key,label:labels[key],amount})),
    employeeCharges,employerCharges,
    reconciliation:{grossItemsDelta:Object.values(composition).reduce((sum,value)=>sum+value,0)-totals.gross,
      employeeItemsDelta:employeeCharges.reduce((sum,row)=>sum+row.amount,0)-totals.deductions,
      employerItemsDelta:employerCharges.reduce((sum,row)=>sum+row.amount,0)-totals.employerCharges},
    provenance:'Montants, bases et taux enregistrés dans PayrollItem ; aucun taux actuel appliqué rétroactivement.'};
}

/** Contrôle par bulletin calculé en base ; aucune ligne complète de paie chargée. */
export function checkedPayrollSql(companyId:string,month:number,year:number) {
  return Prisma.sql`WITH checked AS (
    SELECT p.id,p."employeeId",p.status,
      p."grossSalary"-p."totalDeductions"+COALESCE(i.amount,0)-p."netSalary" AS "netDelta",
      p."grossSalary"+p."cnssEmployer"+p."tusTotal"+p."employerCustomTaxTotal"+COALESCE(i.amount,0)-p."totalEmployerCost" AS "employerCostDelta"
    FROM payrolls p LEFT JOIN LATERAL (
      SELECT SUM(amount) amount FROM payroll_items
      WHERE "payrollId"=p.id AND type='GAIN' AND NOT "isTaxable" AND NOT "isCnss"
      AND (code IS NULL OR code NOT IN (${Prisma.join(NON_TAXABLE_EXCLUSIONS)}))
    ) i ON true
    WHERE p."companyId"=${companyId}::uuid AND p.month=${month} AND p.year=${year} AND p.status<>'CANCELLED'
  )`;
}
