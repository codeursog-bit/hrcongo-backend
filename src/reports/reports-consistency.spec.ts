import { ReportsService } from './reports.service';
const COMPANY='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const date=(value:string)=>new Date(value);
const worker=(id:string,departmentId='rh',extra:any={})=>({id,companyId:COMPANY,departmentId,department:{id:departmentId,name:departmentId},firstName:id,lastName:'Test',employeeNumber:id,status:'ACTIVE',hireDate:date('2026-01-01'),dateOfBirth:date('1990-01-01'),gender:'FEMALE',contractType:'CDI',isResident:true,recordDeletedAt:null,...extra});

describe('Cohérence des rapports avec les pages métier',()=>{
  let service:ReportsService,prisma:any,records:any[],payrolls:any[];
  beforeEach(()=>{
    jest.useFakeTimers().setSystemTime(date('2026-11-24T12:00:00Z'));
    records=[worker('active'),worker('supplier','sales',{contractType:'PRESTATAIRE'}),worker('deleted','rh',{status:'TERMINATED',recordDeletedAt:date('2026-11-20'),terminationDate:date('2026-11-20')}),worker('left','sales',{status:'TERMINATED'}),worker('unknown','rh',{status:'TERMINATED',terminationDate:date('2026-11-16')})];
    const pay=(id:string,employee:any,grossSalary:number,netSalary:number,totalEmployerCost:number,its:number,status='PAID')=>({id,companyId:COMPANY,employeeId:employee.id,employee,month:11,year:2026,status,grossSalary,netSalary,totalEmployerCost,its,totalDeductions:grossSalary-netSalary,cnssEmployer:20});
    payrolls=[pay('a',records[0],1000,800,1300,100,'VALIDATED'),pay('b',records[1],2000,1800,2100,200),pay('c',records[2],500,450,600,50),pay('x',records[3],900,700,1150,100,'TO_PAY'),pay('draft',records[0],100,80,130,10,'DRAFT'),pay('cancelled',records[0],99999,88888,199999,9999,'CANCELLED')];
    const selected=(where:any)=>payrolls.filter(p=>(!where.companyId||p.companyId===where.companyId)&&(!where.month||p.month===where.month)&&(!where.year||p.year===where.year)&&(!where.status?.not||p.status!==where.status.not));
    const sums=(rows:any[],keys:any)=>Object.fromEntries(Object.keys(keys).map(key=>[key,rows.reduce((sum,row)=>sum+Number(row[key]||0),0)]));
    const selectedWorkers=(where:any)=>records.filter(e=>e.companyId===where.companyId||!where.companyId).filter(e=>where.recordDeletedAt?true:!e.recordDeletedAt).filter(e=>!where.status||e.status===where.status).filter(e=>!where.AND?.find((part:any)=>part.id)?.id?.in||where.AND.find((part:any)=>part.id).id.in.includes(e.id));
    prisma={user:{findUnique:jest.fn(async()=>({id:'admin',companyId:COMPANY,role:'ADMIN',manageMultipleCompanies:false}))},
      employee:{findMany:jest.fn(async({where})=>selectedWorkers(where)),count:jest.fn(async({where})=>selectedWorkers(where).length)},
      contractRupture:{findMany:jest.fn(async()=>[{employeeId:'left',ruptureDate:date('2026-11-12'),ruptureType:'FIN_CDD',status:'VALIDE'},{employeeId:'left',ruptureDate:date('2026-11-12'),ruptureType:'FIN_CDD',status:'PAYE'}])},
      company:{findUnique:jest.fn(async()=>({conventionId:null}))},absenceRequest:{findMany:jest.fn(async()=>[])},
      department:{findMany:jest.fn(async()=>['rh','sales'].map(id=>({id,name:id,color:null,employees:records.filter(e=>e.departmentId===id&&e.status==='ACTIVE'&&!e.recordDeletedAt),_count:{employees:records.filter(e=>e.departmentId===id&&e.status==='ACTIVE'&&!e.recordDeletedAt).length}})))},
      payroll:{findMany:jest.fn(async({where})=>selected(where)),aggregate:jest.fn(async({where,_sum})=>{const rows=selected(where);return {_sum:sums(rows,_sum),_count:rows.length};}),groupBy:jest.fn(async({where,_sum})=>[{month:11,_sum:sums(selected(where),_sum)}])},
      leave:{findMany:jest.fn(async()=>[]),count:jest.fn(async()=>0)},
    };
    service=new ReportsService(prisma,{getCategoriesByConvention:jest.fn(async()=>[])} as any);
  });
  afterEach(()=>jest.useRealTimers());

  it('réconcilie effectif actif, mouvements et suppressions sans transformer une suppression en sortie',async()=>{
    const movement=await service.getWorkforceMovement('admin',undefined,'MOIS',11,2026);
    expect(movement!.totals).toEqual({initial:3,hires:0,departures:1,final:2});
    expect(movement!.deletions).toBe(1);expect(movement!.unconfirmedDepartures).toBe(1);
    const analysis:any=await service.getWorkforceAnalysis('admin');
    expect(analysis.metrics[0].value).toBe('2');expect(analysis.metrics[2].value).toBe('1');
    expect(analysis.turnoverDetail.recordedRuptures).toBe(1);expect(analysis.turnoverDetail.deletions).toBe(1);
    expect(analysis.turnoverDetail.byDepartment).toEqual([{department:'sales',count:1}]);
  });
  it('réconcilie les montants de paie même après suppression ou départ de l’employé',async()=>{
    const departments=await service.getDepartmentAnalysis('admin',undefined,11,2026);
    expect(departments.reduce((n,d)=>n+d.headcount,0)).toBe(2);
    expect(departments.reduce((n,d)=>n+d.totalGross,0)).toBe(4500);
    expect(departments.reduce((n,d)=>n+d.totalNet,0)).toBe(3830);
    expect(departments.reduce((n,d)=>n+d.totalEmployerCost,0)).toBe(5280);
    expect(departments.reduce((n,d)=>n+d.totalDeductions,0)).toBe(670);
    const analysis=await service.getPayrollAnalysis('admin',undefined,11,2026);
    expect((analysis as any).fiscalBreakdown).toEqual({its:260,bnc10:200,bnc20:0});
    expect((analysis as any).departments.reduce((n:number,d:any)=>n+d.mass,0)).toBe(4500);
    expect(prisma.payroll.aggregate.mock.calls[0][0].where.status).toEqual({not:'CANCELLED'});
  });
  it('reprend toutes les retenues enregistrées dans l’évolution annuelle',async()=>{
    const report=await service.getYearlyTrend('admin',2026,2026,11);
    expect(report.years[0]).toMatchObject({brut:4500,net:3830,chargesSalariales:670,coutTotalEmployeur:5280});
  });
  it('applique réellement le mois demandé à la vue d’ensemble',async()=>{
    await service.getOverview('admin',undefined,10,2026);
    expect(prisma.payroll.aggregate.mock.calls[0][0].where).toEqual({companyId:COMPANY,month:10,year:2026,status:{not:'CANCELLED'}});
  });
  it('ne confond pas proposition IA, décision RH et embauche, et inclut le dernier jour du mois',async()=>{
    prisma.jobOffer={findMany:jest.fn(async()=>[{status:'PUBLISHED'}])};
    prisma.candidate={findMany:jest.fn(async()=>[
      {hrDecision:null,aiSuggestion:'RETENU',status:'SCREENING',createdAt:date('2026-11-05')},
      {hrDecision:'RETENU',aiSuggestion:null,status:'OFFER',createdAt:date('2026-11-07')},
      {hrDecision:null,aiSuggestion:null,status:'HIRED',createdAt:date('2026-11-30T23:59:59.999+01:00')},
    ])};
    const report:any=await service.getRecruitmentIndicators('admin',undefined,2026);
    expect(report.totalCandidates).toBe(3);expect(report.hiredCount).toBe(1);
    expect(report.candidatesByDecision.find((r:any)=>r.status==='RETENU').count).toBe(1);
    expect(report.candidatesByDecision.find((r:any)=>r.status==='EN_ATTENTE').count).toBe(2);
    expect(report.candidatesTrend[10].count).toBe(3);
    expect(report.candidatesTrend[10].month).toBe('nov.');
    expect(prisma.jobOffer.findMany.mock.calls[0][0].where.createdAt).toEqual({gte:date('2026-01-01T00:00:00+01:00'),lt:date('2027-01-01T00:00:00+01:00')});
  });
  it('ne change pas d’entreprise en recevant un identifiant non autorisé',async()=>{
    await service.getPayrollAnalysis('admin',OTHER,11,2026);
    expect(prisma.payroll.aggregate.mock.calls.every((call:any)=>call[0].where.companyId===COMPANY)).toBe(true);
  });
});
