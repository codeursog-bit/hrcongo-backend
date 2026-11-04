require('ts-node/register/transpile-only');
const fs=require('node:fs'),{Logger}=require('@nestjs/common');Logger.overrideLogger([]);
const {PayrollCalculatorService}=require('./src/payrolls/services/payroll-calculator.service');
const calculator=new PayrollCalculatorService({});
const settings={cnssSalarialRate:4,cnssEmployerRate:20.28,overtimeRate10:10,overtimeRate25:25,overtimeRate50:50,overtimeRate100:100};
const employee={isSubjectToIrpp:false,isSubjectToCnss:true,isSubjectToTus:true,contractType:'CDI',tolZone:'VILLE'};
function calc(rate,bonus=[]){return calculator.calculate(250000,0,0,0,0,bonus,[],{...settings,cnssEmployerRate:rate},26,26,employee,{appliesCnssEmployer:true,cnssEmployerRate:rate,isSubjectToTus:true},[]);}
const standard=calc(20.28),custom=calc(16),withAllowance=calc(20.28,[{amount:10000,fiscalType:'NON_TAXABLE',isTaxable:false,isCnss:false}]);
const rows=[{test:'backend-company-cnss-override',configuredRateA:20.28,configuredRateB:16,cnssEmployerA:standard.cnssEmployer,cnssEmployerB:custom.cnssEmployer,rateIgnored:standard.cnssEmployer===custom.cnssEmployer},
{test:'backend-allowance-employer-cost',allowance:10000,netBefore:standard.netSalary,netAfter:withAllowance.netSalary,employerCostBefore:standard.totalEmployerCost,employerCostAfter:withAllowance.totalEmployerCost}];
rows.forEach(x=>console.log(JSON.stringify(x)));fs.writeFileSync('../qa-calculation-results.json',JSON.stringify(rows,null,2));
