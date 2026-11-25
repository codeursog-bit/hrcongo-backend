import { buildCostBreakdowns, buildCostEvolution, comparisonPeriods } from './payroll-cost-dimensions';
import { Prisma } from '@prisma/client';
import { buildCostDetails, checkedPayrollSql, NON_TAXABLE_EXCLUSIONS } from './payroll-cost-details';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const PAYROLL_COST_DEFINITIONS = [
  {key:'gross',label:'Masse salariale brute',formula:'Somme des bruts enregistrés, primes imposables, heures supplémentaires et ancienneté comprises. Les retenues salariales sont déjà comprises dans ce brut.'},
  {key:'deductions',label:'Retenues salariales',formula:'Somme des retenues enregistrées : cotisations, impôts, taxes salariales et autres retenues (prêts, avances…). Elles ne s’ajoutent pas au coût employeur.'},
  {key:'employerCharges',label:'Charges patronales',formula:'CNSS patronale + TUS totale + taxes patronales configurées, dont CAMU patronale lorsqu’elle est appliquée. Montants enregistrés sur les bulletins.'},
  {key:'chargedGross',label:'Masse salariale chargée',formula:'Masse salariale brute + charges patronales.'},
  {key:'outsideGross',label:'Primes et indemnités hors brut',formula:'Lignes de gain non imposables et non soumises à CNSS enregistrées sur les bulletins. Ajoutées au net et au coût employeur, sans entrer dans le brut.'},
  {key:'employerCost',label:'Coût employeur total',formula:'Somme des coûts employeur enregistrés. Identité attendue : brut + charges patronales + primes et indemnités hors brut.'},
  {key:'net',label:'Net à payer',formula:'Somme des nets enregistrés. Identité attendue : brut − retenues + primes et indemnités hors brut. Ce montant n’est pas un coût supplémentaire.'},
];

const amount=(value:unknown)=>Number(value??0);
export function summarizePayrollCosts(sums:Record<string,unknown>,outsideGross:number,statuses:{status:string;count:number}[]) {
  const gross=amount(sums.grossSalary),deductions=amount(sums.totalDeductions),net=amount(sums.netSalary);
  const cnss=amount(sums.cnssEmployer),tus=amount(sums.tusTotal),customTaxes=amount(sums.employerCustomTaxTotal);
  const employerCharges=cnss+tus+customTaxes,chargedGross=gross+employerCharges;
  const employerCost=amount(sums.totalEmployerCost),headcount=statuses.reduce((sum,row)=>sum+row.count,0);
  const draftCount=statuses.find(row=>row.status==='DRAFT')?.count??0;
  return {
    scope:'CONGO' as const,headcount,paidHeadcount:statuses.find(row=>row.status==='PAID')?.count??0,draftCount,
    gross,deductions,net,employerCharges,chargedGross,outsideGross,employerCost,
    employerChargesRatio:gross===0?null:employerCharges/gross*100,
    averageGross:headcount?gross/headcount:null,averageEmployerCost:headcount?employerCost/headcount:null,
    employerBreakdown:{cnss,tus,customTaxes},
    reconciliation:{netDelta:gross-deductions+outsideGross-net,employerCostDelta:chargedGross+outsideGross-employerCost,
      level:'AGGREGATE_ONLY' as const,description:'Contrôle des totaux seulement ; les écarts par bulletin sont à vérifier séparément. Aucun montant n’est corrigé.'},
    statuses,scopeDescription:'Paie Congo : bulletins annulés exclus, brouillons inclus et signalés. Paies étrangères exclues de cette synthèse.',
    definitions:PAYROLL_COST_DEFINITIONS,
  };
}
export type PayrollCostSummary=ReturnType<typeof summarizePayrollCosts> & {details?:ReturnType<typeof buildCostDetails>;breakdowns?:ReturnType<typeof buildCostBreakdowns>;evolution?:ReturnType<typeof buildCostEvolution>;controls?:{checkedCount:number;issueCount:number;tolerance:number;issues:any[];truncated:boolean}};

@Injectable()
export class PayrollCostSummaryService {
  constructor(private readonly prisma:PrismaService){}
  /** companyId est exclusivement fourni après resolveVerifiedCompanyId dans le journal. */
  async get(companyId:string,month:number,year:number):Promise<PayrollCostSummary> {
    const where={companyId,month,year,status:{not:'CANCELLED' as const}};
    return this.prisma.$transaction(async tx=>{
      const [totals,indemnities,statuses,groups,employeeGroups,periodGroups]=await Promise.all([
        tx.payroll.aggregate({where,_sum:{grossSalary:true,totalDeductions:true,netSalary:true,cnssEmployer:true,tusTotal:true,employerCustomTaxTotal:true,totalEmployerCost:true}}),
        tx.payrollItem.aggregate({where:{payroll:where,type:'GAIN',isTaxable:false,isCnss:false,OR:[{code:null},{code:{notIn:NON_TAXABLE_EXCLUSIONS}}]},_sum:{amount:true}}),
        tx.payroll.groupBy({by:['status'],where,_count:{_all:true}}),
        tx.payrollItem.groupBy({by:['code','label','type','rate','isTaxable','isCnss'],where:{payroll:where},_sum:{amount:true,base:true}}),
        tx.payroll.groupBy({by:['employeeId'],where,_sum:{grossSalary:true,netSalary:true,cnssEmployer:true,tusTotal:true,employerCustomTaxTotal:true,totalEmployerCost:true}}),
        tx.payroll.groupBy({by:['month','year'],where:{companyId,status:{not:'CANCELLED'},OR:comparisonPeriods(month,year)},_sum:{grossSalary:true,netSalary:true,cnssEmployer:true,tusTotal:true,employerCustomTaxTotal:true,totalEmployerCost:true},_count:{_all:true}}),
      ]);
      const employees=employeeGroups.length?await tx.employee.findMany({where:{companyId,recordDeletedAt:{},id:{in:employeeGroups.map(row=>row.employeeId)}},select:{id:true,department:{select:{name:true}},professionalCategory:true,contractType:true}}):[];
      const summary=summarizePayrollCosts(totals._sum,amount(indemnities._sum.amount),statuses.map(row=>({status:row.status,count:row._count._all})));
      const checked=checkedPayrollSql(companyId,month,year);
      const [counts,issues]=await Promise.all([
        tx.$queryRaw<any[]>(Prisma.sql`${checked} SELECT COUNT(*)::int AS checked,COUNT(*) FILTER (WHERE ABS("netDelta")>1 OR ABS("employerCostDelta")>1)::int AS issues FROM checked`),
        tx.$queryRaw<any[]>(Prisma.sql`${checked} SELECT * FROM checked WHERE ABS("netDelta")>1 OR ABS("employerCostDelta")>1 ORDER BY GREATEST(ABS("netDelta"),ABS("employerCostDelta")) DESC,id LIMIT 50`),
      ]);
      return {...summary,details:buildCostDetails(groups,summary),breakdowns:buildCostBreakdowns(employeeGroups,employees,summary.employerCost),evolution:buildCostEvolution(month,year,periodGroups),controls:{checkedCount:Number(counts[0]?.checked??0),issueCount:Number(counts[0]?.issues??0),tolerance:1,
        issues:issues.map(row=>({...row,netDelta:amount(row.netDelta),employerCostDelta:amount(row.employerCostDelta)})),truncated:Number(counts[0]?.issues??0)>issues.length}};
    },{isolationLevel:'RepeatableRead',timeout:15000});
  }
}
