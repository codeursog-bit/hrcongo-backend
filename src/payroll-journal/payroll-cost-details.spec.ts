import { buildCostDetails, checkedPayrollSql, StoredItemGroup } from './payroll-cost-details';
const item=(code:string,type:string,value:number,options:Partial<StoredItemGroup>={}):StoredItemGroup=>({code,label:code,type,rate:null,isTaxable:type==='GAIN',isCnss:type==='GAIN',_sum:{amount:value,base:null},...options});
describe('Détail enregistré du rapport de paie',()=>{
  it('sépare hors brut, absences et retenues sans déduire deux fois les absences',()=>{
    const result=buildCostDetails([item('SAL_BASE','GAIN',700000),item('HS_10','GAIN',10000),item('PRIME','GAIN',20000),item('TRANSPORT','GAIN',20000,{isTaxable:false,isCnss:false}),item('ABS_DEDUCT','DEDUCTION',16612),item('CNSS_SAL','DEDUCTION',28000),item('LOAN','DEDUCTION',10000)],{gross:713388,deductions:38000,employerCharges:0});
    expect(result.composition.find(row=>row.key==='grossDeductions')?.amount).toBe(-16612);expect(result.reconciliation.grossItemsDelta).toBe(0);expect(result.reconciliation.employeeItemsDelta).toBe(0);expect(result.employeeCharges).toHaveLength(2);expect(result.employeeCharges.find(row=>row.code==='LOAN')?.kind).toBe('LOAN');
  });
  it('reproduit CNSS, CAMU et TUS patronales du cas de référence',()=>{
    const result=buildCostDetails([item('CNSS_EMP_PENSION','EMPLOYER_COST',57071),item('CNSS_EMP_FAM','EMPLOYER_COST',60180),item('CNSS_EMP_AT','EMPLOYER_COST',13500),item('CTAX_EMP_CAMU','EMPLOYER_COST',32459),item('TUS_DGI','EMPLOYER_COST',14446),item('TUS_CNSS','EMPLOYER_COST',39058)],{gross:713388,deductions:0,employerCharges:216714});
    expect(result.reconciliation.employerItemsDelta).toBe(0);expect(result.employerCharges).toHaveLength(6);
  });
  it('conserve taux différents et signale le plafond non historisé',()=>{
    const result=buildCostDetails([item('CTAX_CAMU','DEDUCTION',2270,{rate:0.0227,_sum:{amount:2270,base:100000}}),item('CTAX_CAMU','DEDUCTION',3000,{rate:0.03,_sum:{amount:3000,base:100000}})],{gross:200000,deductions:5270,employerCharges:0});
    expect(result.employeeCharges.map(row=>row.ratePercent)).toEqual([2.27,3]);expect(result.employeeCharges[0].appliedCeiling).toBeNull();expect(result.employeeCharges[0].base).toBe(100000);
  });
  it('rend visibles les détails incomplets au lieu de fabriquer une rubrique',()=>{
    const result=buildCostDetails([],{gross:100,deductions:20,employerCharges:30});expect(result.reconciliation).toEqual({grossItemsDelta:-100,employeeItemsDelta:-20,employerItemsDelta:-30});expect(result.employerCharges).toEqual([]);
  });
  it('paramètre le SQL et conserve les bulletins historiques hors annulations',()=>{
    const sql=checkedPayrollSql('company-A',11,2026);expect(sql.values).toContain('company-A');expect(sql.values).toContain(11);expect(sql.values).toContain(2026);expect(sql.sql).toContain("p.status<>'CANCELLED'");expect(sql.sql).toContain('code IS NULL');expect(sql.sql).not.toContain('recordDeletedAt');expect(sql.sql).not.toContain("status='ACTIVE'");expect(sql.sql).toContain('"totalDeductions"');expect(sql.sql).toContain('"tusTotal"');
  });
});
