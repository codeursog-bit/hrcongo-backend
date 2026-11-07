
import {buildPayrollEvent,canonicalJson,payrollLines,PayrollSnapshot} from './payroll-contract';
const snapshot=():PayrollSnapshot=>({id:'10000000-0000-4000-8000-000000000001',companyId:'20000000-0000-4000-8000-000000000001',employee:{id:'30000000-0000-4000-8000-000000000001',firstName:'Test',lastName:'Contrat'},status:'TO_PAY',paid:false,month:11,year:2026,periodEnd:new Date('2026-11-30T00:00:00Z'),grossSalary:100000,netSalary:90000,totalDeductions:10000,cnssSalarial:4000,its:6000,cnssEmployer:16000,tusDgiAmount:0,tusCnssAmount:0,employeeCustomTaxTotal:0,employerCustomTaxTotal:0,items:[]});
const mapping={GROSS:'661',NET:'422',CNSS_SAL:'431',ITS:'447',CNSS_EMP_EXPENSE:'664',CNSS_EMP_LIABILITY:'431'};
describe('contrat RH vers Compta',()=>{
 test('transmet les montants enregistrés, avec identité stable et équilibre',()=>{
  const p=snapshot();const event=buildPayrollEvent(p,mapping);
  expect(event.type).toBe('PAYROLL_TO_PAY');expect(event.data.status).toBe('TO_PAY');expect(event.data.netToPay).toBe(90000);
  expect(event.data.lines.reduce((n,l)=>n+l.debit-l.credit,0)).toBe(0);
  expect(buildPayrollEvent(p,mapping)).toEqual(event);
 });
 test('ne transmet ni brouillon ni paie déjà payée',()=>{
  expect(()=>payrollLines({...snapshot(),status:'DRAFT'})).toThrow();
  expect(()=>payrollLines({...snapshot(),status:'VALIDATED'})).toThrow();
  expect(()=>payrollLines({...snapshot(),status:'PAID',paid:true})).toThrow();
 });
 test('refuse les centimes et les écritures déséquilibrées sans compensation',()=>{
  expect(()=>payrollLines({...snapshot(),netSalary:89999.5})).toThrow();
  expect(()=>payrollLines({...snapshot(),netSalary:89999})).toThrow('PAIE_DESEQUILIBREE');
 });
 test('préserve les indemnités non imposables enregistrées',()=>{
  const p={...snapshot(),netSalary:95000,items:[{code:'BONUS_TR',label:'Transport',type:'GAIN',amount:5000,isTaxable:false}]};
  expect(payrollLines(p).find(l=>l.key==='NON_TAXABLE')?.debit).toBe(5000);
 });
 test('ne confond pas retenue BNC et ITS',()=>{
  const p={...snapshot(),items:[{code:'BNC_SOURCE',label:'BNC',type:'DEDUCTION',amount:6000,isTaxable:false}]};
  expect(payrollLines(p).some(l=>l.key==='BNC')).toBe(true);
  expect(payrollLines(p).some(l=>l.key==='ITS')).toBe(false);
 });
 test('exige une affectation pour toutes les rubriques',()=>{
  expect(()=>buildPayrollEvent(snapshot(),{})).toThrow('AFFECTATION_ABSENTE');
 });
 test('JSON canonique indépendant de l’ordre des propriétés',()=>{
  expect(canonicalJson({b:1,a:{z:2,c:3}})).toBe(canonicalJson({a:{c:3,z:2},b:1}));
 });
});
