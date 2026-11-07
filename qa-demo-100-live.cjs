// Tests API locaux sur l'entreprise fictive uniquement. Aucun jeton n'est enregistré.
require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const assert=require('node:assert/strict'),fs=require('node:fs');
const db=new PrismaClient(),companyId='2af9684f-bd86-480d-b473-777032fe1f7d';
const rows=[];let session,outsiderSession;
function check(test,ok,details={}){rows.push({test,passed:!!ok,...details});console.log(JSON.stringify(rows.at(-1)));}
async function api(path,cookie=session,method='GET',body){
 const start=Date.now(),r=await fetch('http://localhost:3001'+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});
 const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data=raw.slice(0,120)}
 return{status:r.status,data,ms:Date.now()-start,cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ')};
}
async function main(){
 assert.ok(process.env.KONZA_QA_PASSWORD,'KONZA_QA_PASSWORD requis');
 assert.equal((await db.company.findUnique({where:{id:companyId},select:{legalName:true}}))?.legalName,'KONZA QA TEST — ENTREPRISE FICTIVE');
 const employees=await db.employee.findMany({where:{companyId},select:{id:true,employeeNumber:true,department:{select:{name:true}}},orderBy:{employeeNumber:'asc'}});
 assert.equal(employees.length,100);
 const health=await api('/health',null);check('backend-health',health.status===200,{status:health.status});
 const front=await fetch('http://localhost:3000/auth/login');check('frontend-login-http',front.status===200,{status:front.status});
 const login=await api('/auth/login',null,'POST',{email:'qa.konza.20261104@example.com',password:process.env.KONZA_QA_PASSWORD});
 assert.equal(login.status,200,'Connexion QA');session=login.cookie;
 const me=await api('/auth/me');assert.equal(me.data.companyId,companyId);check('authenticated-demo-company',true);
 const pages=await Promise.all([1,2,3,4].map(page=>api('/employees?page='+page+'&limit=25')));
 const ids=pages.flatMap(p=>p.data?.data?.map(e=>e.id)||[]);
 check('100-employees-four-pages',pages.every(p=>p.status===200&&p.data.total===100&&p.data.totalPages===4&&p.data.data.length===25)&&new Set(ids).size===100,{uniqueEmployees:new Set(ids).size});
 const sample=employees.find(e=>e.employeeNumber==='QA100-098');assert.ok(sample);
 const search=await api('/employees?search=QA100-098');check('search-last-demo-employee',search.status===200&&search.data.total===1&&search.data.data[0].id===sample.id);
 const name=sample.department.name,expected=employees.filter(e=>e.department.name===name).length;
 const dept=await api('/employees?limit=100&department='+encodeURIComponent(name));check('department-filter-total',dept.status===200&&dept.data.total===expected&&dept.data.data.every(e=>e.department.name===name),{expected,actual:dept.data.total});
 for(const path of ['/dashboard/summary','/dashboard/charts','/leaves','/recruitment/jobs','/recruitment/candidates']){
  const r=await api(path);check('module '+path,r.status===200,{status:r.status,ms:r.ms});
 }
 const daily=await api('/attendance/today'),monthly=await api('/attendance?month=11&year=2026');
 check('attendance-month-100-employees',monthly.status===200&&monthly.data.employees?.length===100,{status:monthly.status,employeeCount:monthly.data.employees?.length});
 const monthRows=monthly.data.attendances||[],dailyRows=Array.isArray(daily.data)?daily.data:[];
 check('attendance-daily-monthly-records',daily.status===200&&dailyRows.length>0&&dailyRows.every(d=>monthRows.some(m=>m.employeeId===d.employeeId&&m.date===d.date&&m.status===d.status)),{dailyCount:dailyRows.length,monthlyCount:monthRows.length});
 const batch=await api('/payrolls/simulate-batch',session,'POST',{employeeIds:employees.map(e=>e.id),month:11,year:2026});
 const results=batch.data.results||[],success=results.filter(r=>r.success),failures=results.filter(r=>!r.success);
 check('payroll-simulation-100',batch.status===201&&success.length===100&&failures.length===0,{status:batch.status,success:success.length,failed:failures.length,ms:batch.ms,errors:failures.map(r=>r.error).slice(0,3)});
 check('payroll-net-arithmetic',success.length===100&&success.every(r=>Math.abs(Number(r.data.netSalary)-(Number(r.data.grossSalary)-Number(r.data.totalDeductions)))<0.01));
 const gross=success.reduce((s,r)=>s+Number(r.data.grossSalary),0),net=success.reduce((s,r)=>s+Number(r.data.netSalary),0);
 check('payroll-batch-totals',success.length===100&&Math.abs(gross-Number(batch.data.summary?.totalGross))<0.01&&Math.abs(net-Number(batch.data.summary?.totalNet))<0.01,{totalGross:gross,totalNet:net});
 const picks=employees.filter(e=>e.employeeNumber.startsWith('QA100-')).slice(0,12);
 for(const e of picks){
  const exists=await db.payroll.findFirst({where:{companyId,employeeId:e.id,month:11,year:2026},select:{id:true,status:true}});
  if(exists){check('draft-payroll '+e.employeeNumber,exists.status==='DRAFT',{existing:true});continue;}
  const r=await api('/payrolls',session,'POST',{employeeId:e.id,month:'Novembre',year:2026});
  const saved=await db.payroll.findFirst({where:{companyId,employeeId:e.id,month:11,year:2026},select:{status:true}});
  check('draft-payroll '+e.employeeNumber,r.status===201&&saved?.status==='DRAFT',{status:r.status,payrollStatus:saved?.status,...(r.status>=400?{message:r.data.message}:{})});
 }
 const payrolls=await api('/payrolls?month=11&year=2026');check('payrolls-list',payrolls.status===200&&Array.isArray(payrolls.data)&&payrolls.data.length>=12,{status:payrolls.status,count:payrolls.data.length});
 const anon=await api('/employees?limit=100',null);check('anonymous-employees-blocked',anon.status===401,{status:anon.status});
 assert.ok(process.env.KONZA_QA_ISOLATION_PASSWORD,'KONZA_QA_ISOLATION_PASSWORD requis');
 const other=await api('/auth/login',null,'POST',{email:'qa.isolation.20261104@example.com',password:process.env.KONZA_QA_ISOLATION_PASSWORD});
 assert.equal(other.status,200,'Connexion QA isolation');outsiderSession=other.cookie;
 const forbidden=await api('/employees/'+sample.id,outsiderSession);
 check('other-company-employee-blocked',[403,404].includes(forbidden.status),{status:forbidden.status});
 const scoped=await api('/employees?limit=100&companyId='+companyId,outsiderSession);
 check('other-company-list-no-demo-data',[403,404].includes(scoped.status)||(scoped.status===200&&Array.isArray(scoped.data.data)&&!scoped.data.data.some(e=>ids.includes(e.id))),{status:scoped.status});
 const counts={employees:await db.employee.count({where:{companyId}}),attendance:await db.attendance.count({where:{companyId}}),draftPayrolls:await db.payroll.count({where:{companyId,status:'DRAFT'}}),leaves:await db.leave.count({where:{companyId}}),jobs:await db.jobOffer.count({where:{companyId,description:'QA_DEMO_100_20261105'}})};
 fs.writeFileSync('../qa-demo-100-live-results.json',JSON.stringify({timestamp:new Date().toISOString(),scope:'API locale et données fictives ; aucune validation visuelle du navigateur',counts,passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>!r.passed).length,checks:rows},null,2));
 console.log(JSON.stringify({counts,passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>!r.passed).length}));
 if(rows.some(r=>!r.passed))process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;fs.writeFileSync('../qa-demo-100-live-results.json',JSON.stringify({error:e.message,checks:rows},null,2));}).finally(async()=>{for(const cookie of [session,outsiderSession])if(cookie)await api('/auth/logout',cookie,'POST').catch(()=>{});await db.$disconnect();});
