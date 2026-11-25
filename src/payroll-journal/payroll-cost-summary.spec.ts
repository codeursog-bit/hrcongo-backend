import { PayrollCostSummaryService, summarizePayrollCosts } from './payroll-cost-summary.service';

const example={grossSalary:713388,totalDeductions:98087,netSalary:615301,cnssEmployer:130751,tusTotal:53504,employerCustomTaxTotal:32459,totalEmployerCost:930102};
describe('Synthèse du coût de la paie — montants enregistrés',()=>{
  it('respecte le cas de référence sans additionner les retenues au coût employeur',()=>{
    const result=summarizePayrollCosts(example,0,[{status:'PAID',count:1}]);
    expect(result.employerCharges).toBe(216714);expect(result.chargedGross).toBe(930102);expect(result.employerCost).toBe(930102);
    expect(result.employerChargesRatio).toBeCloseTo(30.378,2);expect(result.reconciliation.netDelta).toBe(0);expect(result.reconciliation.employerCostDelta).toBe(0);
    expect(result.paidHeadcount).toBe(1);
  });
  it('garde la prime non imposable hors brut, dans le net et le coût',()=>{
    const result=summarizePayrollCosts({...example,netSalary:635301,totalEmployerCost:950102},20000,[{status:'VALIDATED',count:1}]);
    expect(result.gross).toBe(713388);expect(result.chargedGross).toBe(930102);expect(result.outsideGross).toBe(20000);expect(result.employerCost).toBe(950102);
    expect(result.reconciliation.netDelta).toBe(0);expect(result.reconciliation.employerCostDelta).toBe(0);expect(result.paidHeadcount).toBe(0);
  });
  it('inclut la taxe patronale configurée sans modifier les montants du bulletin',()=>{
    const result=summarizePayrollCosts({...example,employerCustomTaxTotal:42459,totalEmployerCost:940102},0,[{status:'DRAFT',count:1}]);
    expect(result.employerCharges).toBe(226714);expect(result.draftCount).toBe(1);expect(result.reconciliation.employerCostDelta).toBe(0);
  });
  it('signale un écart provoqué sans le corriger',()=>{
    const result=summarizePayrollCosts({...example,netSalary:615000,totalEmployerCost:900000},0,[{status:'VALIDATED',count:1}]);
    expect(result.net).toBe(615000);expect(result.employerCost).toBe(900000);expect(result.reconciliation.netDelta).toBe(301);expect(result.reconciliation.employerCostDelta).toBe(30102);
  });
  it('ne fabrique aucun ratio pour une période vide',()=>{
    const result=summarizePayrollCosts({},0,[]);expect(result.employerChargesRatio).toBeNull();expect(result.averageEmployerCost).toBeNull();expect(result.headcount).toBe(0);
  });
  it('agrège en base et scope toutes les requêtes sur la même entreprise/période, hors annulations',async()=>{
    const prisma={payroll:{aggregate:jest.fn().mockResolvedValue({_sum:example}),groupBy:jest.fn().mockResolvedValueOnce([{status:'PAID',_count:{_all:1}}]).mockResolvedValueOnce([]).mockResolvedValueOnce([])},payrollItem:{aggregate:jest.fn().mockResolvedValue({_sum:{amount:0}}),groupBy:jest.fn().mockResolvedValue([])},$queryRaw:jest.fn().mockResolvedValueOnce([{checked:1,issues:0}]).mockResolvedValueOnce([]),$transaction:jest.fn()};
    prisma.$transaction.mockImplementation(async callback=>callback(prisma));
    const result=await new PayrollCostSummaryService(prisma as any).get('company-A',11,2026);
    const where={companyId:'company-A',month:11,year:2026,status:{not:'CANCELLED'}};
    expect(prisma.payroll.aggregate.mock.calls[0][0].where).toEqual(where);expect(prisma.payroll.groupBy.mock.calls[0][0].where).toEqual(where);
    expect(prisma.payrollItem.aggregate.mock.calls[0][0].where.payroll).toEqual(where);expect(result.employerCost).toBe(930102);
  });
  it('additionne les salariés sans confondre les montants étrangers',()=>{
    const sums=Object.fromEntries(Object.entries(example).map(([key,value])=>[key,value*2]));
    const result=summarizePayrollCosts(sums,0,[{status:'PAID',count:2}]);expect(result.gross).toBe(1426776);expect(result.employerCost).toBe(1860204);expect(result.averageEmployerCost).toBe(930102);expect(result.scope).toBe('CONGO');
  });
});
