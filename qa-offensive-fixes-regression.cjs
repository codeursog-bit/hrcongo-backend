require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const fs=require('node:fs'),assert=require('node:assert/strict');
const prisma=new PrismaClient(),rows=[],sessions=[];
const companyA='2af9684f-bd86-480d-b473-777032fe1f7d';
const marker='QA_FIXES_20261104_'+Date.now();
let job,candidate;
async function request(path,cookie,method='GET',body,headers={}){
 const r=await fetch('http://localhost:3001'+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=null;}
 return{status:r.status,data,text,headers:r.headers,cookies:r.headers.getSetCookie()};
}
const cookies=r=>r.cookies.map(x=>x.split(';')[0]).filter(x=>!x.endsWith('=')).join('; ');
async function check(test,run){try{const details=await run();rows.push({test,passed:true,...details});}catch(e){rows.push({test,passed:false,error:e.message});}console.log(JSON.stringify(rows.at(-1)));}
async function state(){return prisma.candidate.findUnique({where:{id:candidate.id},select:{hrDecision:true,hrNotes:true,hrDecidedBy:true,hrDecidedAt:true,testCompletedAt:true,testScore:true,totalScore:true,aiAnalyzedAt:true}});}
async function limited(path,limit,body={}){
 const statuses=[];let header;
 for(let i=0;i<=limit;i++){const r=await request(path,null,'POST',body);statuses.push(r.status);header??=r.headers.get('x-ratelimit-limit-short');}
 assert.equal(header,String(limit));assert.equal(statuses.at(-1),429);assert.ok(statuses.every(s=>s>=400&&s<500));
 return{statuses,limit:header};
}
async function main(){
 for(const [email,password]of [['qa.konza.20261104@example.com','KonzaQA!2026_Test47'],['qa.isolation.20261104@example.com','qa1234']]){
  const r=await request('/auth/login',null,'POST',{email,password});if(r.status===200)sessions.push(cookies(r));assert.equal(r.status,200,'QA login refused');assert.equal(r.headers.get('x-ratelimit-limit-short'),'5');
 }
 const[ca,cb]=sessions;
 const am=(await request('/auth/me',ca)).data,bm=(await request('/auth/me',cb)).data;
 assert.equal(am.companyId,companyA);assert.notEqual(bm.companyId,companyA);
 job=await prisma.jobOffer.findFirst({where:{companyId:companyA,title:'QA_HARDENING_PRIVATE_FICTIF',status:'DRAFT'},select:{id:true}});assert.ok(job);
 candidate=await prisma.candidate.create({data:{jobOfferId:job.id,firstName:'QA',lastName:marker,email:'qa.fixes.20261104@example.com',status:'EN_ATTENTE_TEST',hrNotes:marker+'_PRIVATE_HR',cvAnalysis:{reasoning:marker+'_PRIVATE_CV'},cvScore:10,testScore:0}});
 const initial=await state();
 const question={question:marker+'_FOREIGN',questionType:'MULTIPLE_CHOICE',points:1,order:999,options:['A','B'],correctAnswers:['B']};
 const cases=[['foreign question creation',`/recruitment/jobs/${job.id}/questions`,'POST',question],['foreign HR decision',`/recruitment/candidates/${candidate.id}/hr-decision`,'PATCH',{hrDecision:'REFUS',hrNotes:marker+'_ATTACK'}],['foreign test grading',`/recruitment/candidates/${candidate.id}/grade-test`,'POST',{}],['foreign score calculation',`/recruitment/candidates/${candidate.id}/calculate-score`,'POST',{}]];
 for(const[name,path,method,body]of cases)await check(name,async()=>{const r=await request(path,cb,method,body);assert.ok([403,404].includes(r.status),'expected 403/404, got '+r.status);assert.ok(!r.text.includes(marker+'_PRIVATE'));assert.deepEqual(await state(),initial);assert.equal(await prisma.jobOfferTestQuestion.count({where:{jobOfferId:job.id,question:question.question}}),0);return{status:r.status,noUnauthorizedMutation:true,noPrivateData:true};});
 await check('owner can create a question',async()=>{const r=await request(`/recruitment/jobs/${job.id}/questions`,ca,'POST',{...question,question:marker+'_OWN'});assert.equal(r.status,201);assert.equal(r.data.jobOfferId,job.id);return{status:r.status};});
 await check('owner can decide without returning full private candidate',async()=>{const r=await request(`/recruitment/candidates/${candidate.id}/hr-decision`,ca,'PATCH',{hrDecision:'MOYENNE',hrNotes:marker+'_OWN_NOTES'});assert.equal(r.status,200);assert.equal(r.data.hrDecision,'MOYENNE');assert.equal((await state()).hrDecision,'MOYENNE');assert.ok(!('email'in r.data));assert.ok(!('cvAnalysis'in r.data));assert.ok(!('testAnswers'in r.data));return{status:r.status};});
 await check('owner can grade the test',async()=>{const r=await request(`/recruitment/candidates/${candidate.id}/grade-test`,ca,'POST',{});assert.equal(r.status,201);assert.ok((await state()).testCompletedAt);return{status:r.status};});
 await check('owner can calculate score',async()=>{const r=await request(`/recruitment/candidates/${candidate.id}/calculate-score`,ca,'POST',{});assert.equal(r.status,201);assert.equal(r.data.totalScore,10);return{status:r.status};});
 for(const origin of ['http://attacker.invalid','null','https://qa-attacker.onrender.com'])for(const method of ['GET','OPTIONS'])await check(`CORS rejects ${method} ${origin} with 403`,async()=>{const r=await request('/auth/me',ca,method,undefined,{Origin:origin,...(method==='OPTIONS'?{'Access-Control-Request-Method':'GET'}:{})});assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);return{status:r.status};});
 await check('CORS permits the configured frontend',async()=>{const r=await request('/auth/me',ca,'GET',undefined,{Origin:'http://localhost:3000'});assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'http://localhost:3000');assert.equal(r.headers.get('access-control-allow-credentials'),'true');return{status:r.status};});
 await check('configured frontend preflight succeeds',async()=>{const r=await request('/auth/me',null,'OPTIONS',undefined,{Origin:'http://localhost:3000','Access-Control-Request-Method':'GET'});assert.equal(r.status,204);return{status:r.status};});
 await check('tenant ADMIN still cannot access superadmin',async()=>{const r=await request('/admin/billing-config/plans',cb);assert.equal(r.status,403);return{status:r.status};});
 for(const path of ['/auth/2fa/authenticate','/auth/2fa/validate'])await check('rate limit '+path,()=>limited(path,5));
 for(const path of ['/auth/register','/auth/register-portfolio'])await check('rate limit '+path,()=>limited(path,3,{password:'qa1234'}));
 await check('rate limit forgot password without sending mail',()=>limited('/auth/forgot-password',3));
 await check('rate limit reset password without changing credentials',()=>limited('/auth/reset-password',5));
 await check('login specific limit blocks further attempts',()=>limited('/auth/login',5,{email:'qa.rate-limit-probe.20261104@example.com',password:'QA_INVALID_PASSWORD'}));
 for(const[index,c]of sessions.entries())await check('logout and replay '+index,async()=>{assert.equal((await request('/auth/logout',c,'POST',{})).status,200);assert.equal((await request('/auth/me',c)).status,401);return{replayStatus:401};});
}
main().catch(e=>{rows.push({test:'setup/runtime',passed:false,error:e.message});console.error(e.message);}).finally(async()=>{
 try{
  if(job)await prisma.jobOfferTestQuestion.deleteMany({where:{jobOfferId:job.id,question:{in:[marker+'_FOREIGN',marker+'_OWN']}}});
  if(candidate)await prisma.candidate.delete({where:{id:candidate.id}});
  for(const c of sessions)try{await request('/auth/logout',c,'POST',{});}catch{}
  rows.push({test:'cleanup',passed:!candidate||!await prisma.candidate.findUnique({where:{id:candidate.id}})});
 }catch(e){rows.push({test:'cleanup',passed:false,error:e.message});}
 finally{fs.writeFileSync('../qa-offensive-fixes-results.json',JSON.stringify({timestamp:new Date().toISOString(),results:rows},null,2));console.log(`${rows.filter(r=>r.passed).length}/${rows.length} passed`);if(rows.some(r=>!r.passed))process.exitCode=1;await prisma.$disconnect();}
});
