require('dotenv').config();
const {PrismaClient}=require('@prisma/client'),fs=require('node:fs'),assert=require('node:assert/strict');
const {req,cookie}=require('../qa-security-audit.cjs');const prisma=new PrismaClient(),rows=[];
function record(test,r,extra={}){const row={test,status:r.status,...extra};rows.push(row);console.log(JSON.stringify(row));}
async function main(){
 const companyId='2af9684f-bd86-480d-b473-777032fe1f7d';
 const candidate=await prisma.candidate.findFirst({where:{email:'qa.deep-candidate.20261104@example.com',jobOffer:{companyId}}});assert.ok(candidate);
 const question=await prisma.jobOfferTestQuestion.create({data:{jobOfferId:candidate.jobOfferId,question:'QA_QUESTION_BROUILLON_FICTIVE',points:1,order:1,options:['A','B'],correctAnswers:['B']}});
 const r=await req('/public/jobs/'+candidate.jobOfferId);record('anonymous-draft-job-details',r,{privateDraftExposed:JSON.stringify(r.data).includes('QA_CONFIDENTIEL_RECRUTEMENT_FICTIF')});
 const q=await req('/public/jobs/'+candidate.jobOfferId+'/test-questions');record('anonymous-draft-job-questions',q,{draftQuestionExposed:JSON.stringify(q.data).includes('QA_QUESTION_BROUILLON_FICTIVE'),correctAnswersExposed:JSON.stringify(q.data).includes('correctAnswers')});
 try {
  const submitted=await req(`/public/jobs/${candidate.jobOfferId}/candidates/${candidate.id}/submit-test`,null,'POST',{answers:{},tabSwitchCount:999});
  const saved=await prisma.candidate.findUnique({where:{id:candidate.id},select:{status:true,testCompletedAt:true,autoDisqualified:true}});
  record('anonymous-candidate-disqualification',submitted,{disqualified:submitted.data?.disqualified,persistedStatus:saved.status,persistedAutoDisqualified:saved.autoDisqualified});
 }finally{
  const keys=['status','tabSwitchCount','suspiciousActivity','autoDisqualified','autoDisqualifiedAt','testCompletedAt'];
  await prisma.candidate.update({where:{id:candidate.id},data:Object.fromEntries(keys.map(key=>[key,candidate[key]]))});
  rows.push({test:'restore-fake-candidate',restored:true});
 }
 const a=await req('/auth/login',null,'POST',{email:'qa.konza.20261104@example.com',password:'KonzaQA!2026_Test47'});record('pricing-login',a);
 if(a.status===200){
  const plans=await req('/subscriptions/plans',cookie(a));record('actual-subscription-plans',plans,{plans:plans.data});
  const c=await req('/companies/'+companyId,cookie(a));record('configured-company-cnss',c,{cnssEmployerRate:c.data?.cnssEmployerRate});
  const sim=await req('/payrolls/simulate',cookie(a),'POST',{employeeId:'889ca63b-3a78-4c34-9b63-0e7a3c58545e',month:11,year:2026,workedDays:26});
  record('actual-payroll-cnss-rate',sim,{grossSalary:sim.data?.grossSalary,cnssEmployer:sim.data?.cnssEmployer,returnedCnssRate:sim.data?.settings?.cnssEmployerRate});
 }
}
main().catch(e=>{console.error(e.message);rows.push({test:'setup-or-cleanup',error:e.message});process.exitCode=1;}).finally(async()=>{fs.writeFileSync('../qa-public-results.json',JSON.stringify(rows,null,2));await prisma.$disconnect();});
