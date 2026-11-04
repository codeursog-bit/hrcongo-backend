require('dotenv').config();
const {PrismaClient}=require('@prisma/client'),{JwtService}=require('@nestjs/jwt');
const bcrypt=require('bcrypt'),fs=require('node:fs'),assert=require('node:assert/strict');
const prisma=new PrismaClient(),rows=[];
async function request(path,cookie,method='GET',body,token){const r=await fetch('http://localhost:3001'+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});return{status:r.status,data:await r.json(),cookies:r.headers.getSetCookie()};}
const cookies=r=>r.cookies.map(c=>c.split(';')[0]).filter(c=>!c.endsWith('=')).join('; ');
async function check(name,run){try{await run();rows.push({test:name,passed:true});}catch(e){rows.push({test:name,passed:false,error:e.message});}console.log(JSON.stringify(rows.at(-1)));}
async function main(){
 const a=await request('/auth/login',null,'POST',{email:'qa.konza.20261104@example.com',password:'KonzaQA!2026_Test47'}),b=await request('/auth/login',null,'POST',{email:'qa.isolation.20261104@example.com',password:'qa1234'});assert.equal(a.status,200);assert.equal(b.status,200);
 const ca=cookies(a),cb=cookies(b),am=(await request('/auth/me',ca)).data,bm=(await request('/auth/me',cb)).data;
 const alice=JSON.parse(fs.readFileSync('../qa-test-employees.json')).data[0];assert.equal(am.companyId,'2af9684f-bd86-480d-b473-777032fe1f7d');
 const dept=await prisma.department.findUnique({where:{companyId_code:{companyId:am.companyId,code:'QA_DEEP_ROLE'}}});assert.ok(dept);
 const roleUser=await prisma.user.findUnique({where:{email:'qa.deep-role.20261104@example.com'}});assert.equal(roleUser.companyId,am.companyId);
 let assignment,shift,asset;
 const job=await prisma.jobOffer.create({data:{companyId:am.companyId,departmentId:alice.departmentId,title:'QA_HARDENING_PRIVATE_FICTIF',description:'Fixture QA',type:'CDI',status:'DRAFT',processingMode:'AI_ASSISTED',showOnPortal:false}});
 const candidate=await prisma.candidate.create({data:{jobOfferId:job.id,firstName:'QA',lastName:'FICTIF',email:'qa.hardening.20261104@example.com',status:'EN_ATTENTE_TEST',hrNotes:'QA_PRIVATE_HR_MARKER'}});
 const question=await prisma.jobOfferTestQuestion.create({data:{jobOfferId:job.id,question:'QA_PRIVATE_QUESTION',points:1,order:1,options:['A','B'],correctAnswers:['B']}});
 try{
  await check('draft questions are not public',async()=>assert.equal((await request(`/public/jobs/${job.id}/test-questions`)).status,404));
  await check('draft sharing information is not public',async()=>assert.equal((await request(`/public/jobs/${job.id}/share-links`)).status,404));
  await prisma.jobOffer.update({where:{id:job.id},data:{status:'PUBLISHED'}});
  const payload={answers:{[question.id]:'B'},tabSwitchCount:0,testDuration:10};
  await check('anonymous candidate submission cannot mutate state',async()=>{const r=await request(`/public/jobs/${job.id}/candidates/${candidate.id}/submit-test`,null,'POST',{answers:{},tabSwitchCount:999});assert.equal(r.status,401);assert.equal((await prisma.candidate.findUnique({where:{id:candidate.id}})).autoDisqualified,false);});
  const jwt=new JwtService({secret:process.env.JWT_SECRET});const token=jwt.sign({type:'recruitment-test',sub:candidate.id,jobId:job.id,version:null},{expiresIn:'1h'});
  await check('candidate token grants only its own questions without answers',async()=>{const r=await request(`/public/jobs/${job.id}/test-questions`,null,'GET',null,token);assert.equal(r.status,200);assert.equal(r.data.questions[0].id,question.id);assert.ok(!JSON.stringify(r.data).includes('correctAnswers'));});
  await check('candidate token cannot target another candidate',async()=>assert.equal((await request(`/public/jobs/${job.id}/candidates/${alice.id}/submit-test`,null,'POST',payload,token)).status,401));
  await check('foreign questions are rejected',async()=>assert.equal((await request(`/public/jobs/${job.id}/candidates/${candidate.id}/submit-test`,null,'POST',{...payload,answers:{[alice.id]:'B'}},token)).status,400));
  await check('valid candidate submission works and replay is rejected',async()=>{const r=await request(`/public/jobs/${job.id}/candidates/${candidate.id}/submit-test`,null,'POST',payload,token);assert.equal(r.status,201);assert.equal(r.data.success,true);assert.equal((await request(`/public/jobs/${job.id}/candidates/${candidate.id}/submit-test`,null,'POST',payload,token)).status,400);});
  await check('HR retake issues a new link and revokes previous token',async()=>{const r=await request(`/recruitment/candidates/${candidate.id}/allow-retake`,ca,'PUT',{reason:'QA fictif'});assert.equal(r.status,200);assert.ok(r.data.testUrl.includes('#access_token='));assert.equal((await request(`/public/jobs/${job.id}/test-questions`,null,'GET',null,token)).status,401);const fresh=new URLSearchParams(r.data.testUrl.split('#')[1]).get('access_token');assert.equal((await request(`/public/jobs/${job.id}/test-questions`,null,'GET',null,fresh)).status,200);const empty=await request(`/public/jobs/${job.id}/candidates/${candidate.id}/submit-test`,null,'POST',{answers:{},tabSwitchCount:0},fresh);assert.equal(empty.status,201);assert.equal(empty.data.testScore,0);assert.equal((await request(`/recruitment/candidates/${candidate.id}/revoke-retake`,ca,'PUT',{})).status,200);assert.equal((await request(`/public/jobs/${job.id}/test-questions`,null,'GET',null,fresh)).status,401);});
  await prisma.user.update({where:{id:roleUser.id},data:{role:'EMPLOYEE',isActive:true,password:await bcrypt.hash('QArole!2026_Fictif',10),mustChangePassword:false,failedLoginAttempts:0,lockedUntil:null}});
  const login=await request('/auth/login',null,'POST',{email:roleUser.email,password:'QArole!2026_Fictif'});assert.equal(login.status,200);const ce=cookies(login);
  for(const path of ['/recruitment/candidates',`/recruitment/candidates/${candidate.id}`])await check('EMPLOYEE denied '+path,async()=>assert.equal((await request(path,ce)).status,403));
  await check('EMPLOYEE cannot change candidate status',async()=>assert.equal((await request(`/recruitment/candidates/${candidate.id}/status`,ce,'PATCH',{status:'REJECTED'})).status,403));
  await check('HR retains candidate access',async()=>assert.equal((await request(`/recruitment/candidates/${candidate.id}`,ca)).status,200));
  await check('foreign active shift route blocked',async()=>assert.equal((await request(`/attendance/employee-shift/${alice.id}/2030-01-15`,cb)).status,403));
  const shifts=await request('/attendance/shifts',ca);shift=shifts.data.find(s=>s.name==='QA_DEEP_SHIFT_TRANSFER_FICTIF');assert.ok(shift);
  await check('shift tenant cannot be changed',async()=>{assert.equal((await request(`/attendance/shifts/${shift.id}`,ca,'PUT',{companyId:bm.companyId})).status,400);assert.equal((await prisma.workShift.findUnique({where:{id:shift.id}})).companyId,am.companyId);});
  await check('minute-only edit recomputes duration',async()=>{const r=await request(`/attendance/shifts/${shift.id}`,ca,'PUT',{startMinute:30});assert.equal(r.status,200);assert.equal(Number(r.data.durationHours),7.5);});
  await check('invalid shift times are rejected',async()=>assert.equal((await request(`/attendance/shifts/${shift.id}`,ca,'PUT',{startHour:99,endHour:-1})).status,400));
  asset=await prisma.asset.findFirst({where:{companyId:bm.companyId,serialNumber:'QA-DEEP-20261104'}});assert.ok(asset);
  await check('foreign employee cannot receive company asset',async()=>assert.equal((await request(`/assets/${asset.id}/assign`,cb,'PATCH',{employeeId:alice.id})).status,403));
  await check('foreign employee cannot be assigned at asset creation',async()=>assert.equal((await request('/assets',cb,'POST',{name:'QA rejected',category:'IT',purchaseDate:'2026-11-04',employeeId:alice.id})).status,403));
  await prisma.user.update({where:{id:roleUser.id},data:{role:'MANAGER'}});
  await check('MANAGER cannot read another department planning',async()=>assert.equal((await request(`/attendance/shift-assignments/${alice.id}`,ce)).status,403));
  await check('MANAGER planning list excludes other departments',async()=>{const r=await request('/attendance/shift-assignments',ce);assert.equal(r.status,200);assert.ok(!JSON.stringify(r.data).includes(alice.id));});
  assignment=await prisma.employeeShiftAssignment.findUnique({where:{employeeId_specificDate:{employeeId:alice.id,specificDate:'2030-01-15'}}});
  await check('MANAGER cannot write another department planning',async()=>assert.equal((await request('/attendance/shift-assignments',ce,'POST',{employeeId:alice.id,shiftId:assignment.shiftId,specificDate:'2030-01-15',notes:'QA_MUST_NOT_WRITE'})).status,403));
  await check('MANAGER can read own planning',async()=>assert.equal((await request(`/attendance/shift-assignments/${roleUser.employeeId}`,ce)).status,200));
  const pay={employeeId:alice.id,month:11,year:2026,workedDays:26,absentDays:0};
  for(const [name,extra]of Object.entries({badArray:{bonuses:'invalid'},badBoolean:{manualBonuses:[{amount:1000,isTaxable:'false'}]},contradiction:{absentDays:26}}))await check('payroll validation '+name,async()=>assert.equal((await request('/payrolls/simulate',ca,'POST',{...pay,...extra})).status,400));
  await check('allowance contributes to employer cost',async()=>{const before=await request('/payrolls/simulate',ca,'POST',pay),after=await request('/payrolls/simulate',ca,'POST',{...pay,manualBonuses:[{bonusType:'QA',amount:10000,isTaxable:false,isCnss:false,fiscalType:'NON_TAXABLE'}]});assert.equal(before.status,201);assert.equal(after.status,201);assert.equal(after.data.totalEmployerCost-before.data.totalEmployerCost,10000);assert.equal(after.data.netSalary-before.data.netSalary,10000);assert.equal(before.data.cnssEmployer,after.data.cnssEmployer);});
  for(const path of ['/employees?limit=0','/employees?page=abc','/attendance?month=99&year=2026'])await check('invalid period/pagination '+path,async()=>assert.equal((await request(path,ca)).status,400));
 }finally{
  await prisma.user.update({where:{id:roleUser.id},data:{role:'EMPLOYEE',isActive:false}});await prisma.userSession.updateMany({where:{userId:roleUser.id,revokedAt:null},data:{revokedAt:new Date()}});
  if(shift)await prisma.workShift.update({where:{id:shift.id},data:{startHour:shift.startHour,startMinute:shift.startMinute,endHour:shift.endHour,endMinute:shift.endMinute,durationHours:shift.durationHours,crossesMidnight:shift.crossesMidnight}});
  await prisma.jobOffer.update({where:{id:job.id},data:{status:'DRAFT',showOnPortal:false}});
  rows.push({test:'cleanup',passed:true,fixtureUserDisabled:true,testJobUnpublished:true});
 }
}
main().catch(e=>{rows.push({test:'setup',passed:false,error:e.message});console.error(e.message);}).finally(async()=>{fs.writeFileSync('../qa-hardening-results.json',JSON.stringify(rows,null,2));console.log(`${rows.filter(r=>r.passed).length}/${rows.length} passed`);if(rows.some(r=>!r.passed))process.exitCode=1;await prisma.$disconnect();});
