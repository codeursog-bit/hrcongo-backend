export interface PayrollPeriod {month:number;year:number}
export const comparisonPeriods=(month:number,year:number):PayrollPeriod[]=>Array.from({length:13},(_,index)=>{
  const date=new Date(Date.UTC(year,month-13+index,1));return {month:date.getUTCMonth()+1,year:date.getUTCFullYear()};
});
const value=(v:unknown)=>Number(v??0);
const metrics=(sum:Record<string,unknown>,headcount:number)=>({headcount,gross:value(sum.grossSalary),net:value(sum.netSalary),employerCharges:value(sum.cnssEmployer)+value(sum.tusTotal)+value(sum.employerCustomTaxTotal),employerCost:value(sum.totalEmployerCost)});
export function buildCostBreakdowns(groups:{employeeId:string;_sum:Record<string,unknown>}[],employees:{id:string;department:{name:string}|null;professionalCategory:string|null;contractType:string}[],employerCost:number) {
  const index=new Map(employees.map(employee=>[employee.id,employee]));
  const buckets={department:new Map(),category:new Map(),contractType:new Map()};
  for(const group of groups) {
    const employee=index.get(group.employeeId);
    const labels={department:employee?.department?.name??'Département non renseigné',category:employee?.professionalCategory??'Catégorie non renseignée',contractType:employee?.contractType??'Contrat non renseigné'};
    for(const dimension of ['department','category','contractType'] as const) {
      const label=labels[dimension],row=buckets[dimension].get(label)??{label,headcount:0,gross:0,net:0,employerCharges:0,employerCost:0};
      const part=metrics(group._sum,1);for(const key of ['headcount','gross','net','employerCharges','employerCost'] as const)row[key]+=part[key];buckets[dimension].set(label,row);
    }
  }
  const rows=(dimension:keyof typeof buckets)=>[...buckets[dimension].values()].map(row=>({...row,share:employerCost===0?null:row.employerCost/employerCost*100})).sort((a,b)=>b.employerCost-a.employerCost||a.label.localeCompare(b.label));
  return {department:rows('department'),category:rows('category'),contractType:rows('contractType'),site:[],siteAvailable:false,
    siteNote:'Aucun site de travail n’est historisé sur les bulletins : aucune répartition par site n’est inventée.',
    metadataNote:'Montants historiques des bulletins ; regroupement selon le département, la catégorie et le contrat actuels du dossier employé.'};
}
export function buildCostEvolution(month:number,year:number,groups:{month:number;year:number;_sum:Record<string,unknown>;_count:{_all:number}}[]) {
  const periods=comparisonPeriods(month,year),map=new Map(groups.map(row=>[`${row.year}-${row.month}`,{...row,...metrics(row._sum,row._count._all)}]));
  const find=(period:PayrollPeriod)=>map.get(`${period.year}-${period.month}`);
  const current=find(periods[12]),previous=find(periods[11]),previousYear=find(periods[0]);
  const comparison=(reference:typeof previous)=>({hasData:!!reference,month:reference?.month??null,year:reference?.year??null,gross:reference?.gross??null,employerCost:reference?.employerCost??null,
    grossChange:!current||!reference||reference.gross===0?null:(current.gross-reference.gross)/reference.gross*100,
    employerCostChange:!current||!reference||reference.employerCost===0?null:(current.employerCost-reference.employerCost)/reference.employerCost*100});
  const ytd=groups.filter(row=>row.year===year&&row.month<=month).reduce((sum,row)=>{const values=metrics(row._sum,row._count._all);for(const key of ['headcount','gross','net','employerCharges','employerCost'] as const)sum[key]+=values[key];return sum;},metrics({},0));
  return {previousMonth:comparison(previous),previousYear:comparison(previousYear),yearToDate:{...ytd,headcountLabel:'Nombre de bulletins cumulés, pas un effectif unique annuel'},
    trend:periods.slice(1).map(period=>{const row=find(period);return {...period,hasData:!!row,gross:row?.gross??null,employerCost:row?.employerCost??null};})};
}
