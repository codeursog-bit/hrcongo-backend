
import { PayrollItemsService } from './payroll-items.service';

describe('Payslip bonus ordering',()=>{
 it('persists seniority first and the two leave gains last without losing amounts',async()=>{
  const tx={payrollItem:{createMany:jest.fn().mockResolvedValue({})}};
  const items=await new PayrollItemsService().create(tx,'pay',{contractType:'CDI',baseSalary:300000},{absenceDeduction:0,cnssSalarial:0,cnssEmployer:0,its:0},{daysToPay:26},[],[],{workDaysPerMonth:26},[
   {id:'other',bonusType:'Prime de rendement',amount:10000,isTaxable:true,isCnss:true},
   {id:'senior',bonusType:"Prime d'anciennete",amount:18000,isTaxable:true,isCnss:true},
  ],{leaveIndemnity:31000,leaveIndemnityBase:26000,leaveIndemnitySeniority:5000,absenceDeduction:0,isPaidLeave:true,leaveDays:0,leaveLabel:'Indemnite de conge',indemnifiedDays:31,indemnifiedSeniorityDays:5});
  const gains=items.filter(i=>i.type==='GAIN');
  expect(gains.map(i=>i.code)).toEqual(['SAL_BASE','BONUS_senior','BONUS_other','INDEM_CONGE','CONGE_SUPP']);
  expect(gains.reduce((n,i)=>n+Number(i.amount),0)).toBe(359000);
  expect(tx.payrollItem.createMany).toHaveBeenCalledWith({data:items});
 });
});
