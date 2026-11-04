require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const fs=require('node:fs');
const prisma=new PrismaClient(),rows=[];
const companyA='2af9684f-bd86-480d-b473-777032fe1f7d';
const marker='QA_ATTACK_RECRUITMENT_20261104_'+Date.now();
let cookie,candidate,questionId;
async function request(path,method='GET',body){
 const r=await fetch('http://localhost:3001'+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
 return{status:r.status,data:await r.json(),cookies:r.headers.getSetCookie()};
}
function log(test,r,extra={}){const row={test,status:r.status,...extra};rows.push(row);console.log(JSON.stringify(row));}
async function main(){
 const login=await request('/auth/login','POST',{email:'qa.isolation.20261104@example.com',password:'qa1234'});
 if(login.status!==200)throw Error('Login QA B '+login.status);
 cookie=login.cookies.map(x=>x.split(';')[0]).filter(x=>!x.endsWith('=')).join('; ');
 const me=(await request('/auth/me')).data;
 if(me.companyId===companyA)throw Error('Mauvais contexte entreprise');
 const job=await prisma.jobOffer.findFirst({where:{companyId:companyA,title:'QA_HARDENING_PRIVATE_FICTIF',status:'DRAFT'},select:{id:true,companyId:true,status:true}});
 if(!job)throw Error('Offre brouillon QA A manquante');
 // Nouveau candidat entièrement fictif, jamais affiché au public, supprimé en finally.
 candidate=await prisma.candidate.create({data:{jobOfferId:job.id,firstName:'QA',lastName:marker,email:'qa.attack.recruitment.20261104@example.com',status:'EN_ATTENTE_TEST',hrNotes:marker+'_PRIVATE_HR',cvAnalysis:{reasoning:marker+'_PRIVATE_CV_REASONING'},cvScore:10,testScore:0}});
 const read=await request('/recruitment/candidates/'+candidate.id);
 log('control: B cannot read A candidate',read,{expected:[403,404]});
 const jr=await request('/recruitment/jobs/'+job.id);
 log('control: B cannot read A draft job',jr,{expected:[403,404]});
 const q=await request(`/recruitment/jobs/${job.id}/questions`,'POST',{question:marker,questionType:'MULTIPLE_CHOICE',points:1,order:999,options:['QA_A','QA_B'],correctAnswers:['QA_B']});
 const inserted=await prisma.jobOfferTestQuestion.findFirst({where:{jobOfferId:job.id,question:marker},select:{id:true}});
 questionId=inserted?.id;
 log('B inserts a question into A draft job',q,{confirmedUnauthorizedWrite:!!inserted,jobOwnedByCompanyA:true});
 const decision=await request(`/recruitment/candidates/${candidate.id}/hr-decision`,'PATCH',{hrDecision:'REFUS',hrNotes:marker+'_ATTACKER_CHANGED_NOTES'});
 const afterDecision=await prisma.candidate.findUnique({where:{id:candidate.id},select:{hrDecision:true,hrNotes:true}});
 log('B changes HR decision and reads returned private fields',decision,{confirmedUnauthorizedWrite:afterDecision.hrDecision==='REFUS'&&afterDecision.hrNotes===marker+'_ATTACKER_CHANGED_NOTES',exposesPrivateCV:JSON.stringify(decision.data).includes(marker+'_PRIVATE_CV_REASONING'),returnsCandidateEmail:decision.data?.email===candidate.email});
 const graded=await request(`/recruitment/candidates/${candidate.id}/grade-test`,'POST',{});
 const afterGrade=await prisma.candidate.findUnique({where:{id:candidate.id},select:{testCompletedAt:true}});
 log('B marks another company test completed',graded,{confirmedUnauthorizedWrite:!!afterGrade.testCompletedAt});
 const scored=await request(`/recruitment/candidates/${candidate.id}/calculate-score`,'POST',{});
 log('B recalculates score and reads private CV analysis',scored,{exposesPrivateCV:JSON.stringify(scored.data).includes(marker+'_PRIVATE_CV_REASONING')});
}
main().catch(e=>{rows.push({test:'runtime',error:e.message});console.error(e.message);process.exitCode=1;}).finally(async()=>{
 try{
  if(questionId)await prisma.jobOfferTestQuestion.delete({where:{id:questionId}});
  if(candidate)await prisma.candidate.delete({where:{id:candidate.id}});
  rows.push({test:'cleanup',questionRemoved:questionId?!await prisma.jobOfferTestQuestion.findUnique({where:{id:questionId}}):true,candidateRemoved:candidate?!await prisma.candidate.findUnique({where:{id:candidate.id}}):true});
  if(cookie)await request('/auth/logout','POST',{});
 }finally{fs.writeFileSync('../qa-recruitment-idor-live-results.json',JSON.stringify({timestamp:new Date().toISOString(),scope:'API localhost, candidat et question jetables dans une offre QA brouillon existante',results:rows},null,2));await prisma.$disconnect();}
});
