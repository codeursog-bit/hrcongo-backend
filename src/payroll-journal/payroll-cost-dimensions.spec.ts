import {buildCostBreakdowns,buildCostEvolution,comparisonPeriods} from './payroll-cost-dimensions';
const sums=(gross:number,cost:number)=>({grossSalary:gross,totalEmployerCost:cost,netSalary:gross-10,cnssEmployer:10,tusTotal:5,employerCustomTaxTotal:5});
describe('Répartition et historique de paie',()=>{
  it('couvre treize mois pour les comparaisons et douze pour la courbe, même au changement d’année',()=>{
    const periods=comparisonPeriods(1,2026);expect(periods).toHaveLength(13);expect(periods[0]).toEqual({month:1,year:2025});expect(periods[11]).toEqual({month:12,year:2025});expect(periods[12]).toEqual({month:1,year:2026});
  });
  it('ne transforme pas les mois manquants en zéro et ne divise pas par zéro',()=>{
    const result=buildCostEvolution(1,2026,[{month:1,year:2026,_sum:sums(100,120),_count:{_all:1}},{month:1,year:2025,_sum:sums(0,0),_count:{_all:1}}]);
    expect(result.trend).toHaveLength(12);expect(result.trend[0].gross).toBeNull();expect(result.previousMonth.hasData).toBe(false);expect(result.previousYear.grossChange).toBeNull();expect(result.yearToDate.gross).toBe(100);expect(result.yearToDate.headcount).toBe(1);
  });
  it('calcule les variations à partir des montants enregistrés et le cumul de l’année seulement',()=>{
    const result=buildCostEvolution(2,2026,[{month:2,year:2025,_sum:sums(50,60),_count:{_all:1}},{month:1,year:2026,_sum:sums(100,120),_count:{_all:1}},{month:2,year:2026,_sum:sums(150,180),_count:{_all:1}}]);
    expect(result.previousMonth.grossChange).toBe(50);expect(result.previousYear.employerCostChange).toBe(200);expect(result.yearToDate.gross).toBe(250);expect(result.yearToDate.employerCost).toBe(300);
  });
  it('retombe sur les totaux et conserve les groupes non renseignés',()=>{
    const result=buildCostBreakdowns([{employeeId:'a',_sum:sums(100,120)},{employeeId:'deleted',_sum:sums(200,240)}],[{id:'a',department:{name:'RH'},professionalCategory:'A1',contractType:'CDI'}],360);
    for(const dimension of ['department','category','contractType'] as const){expect(result[dimension].reduce((sum,row)=>sum+row.employerCost,0)).toBe(360);expect(result[dimension].reduce((sum,row)=>sum+row.headcount,0)).toBe(2);}
    expect(result.siteAvailable).toBe(false);expect(result.site).toEqual([]);
  });
});
