// Jeu de démonstration persistant, limité à l'entreprise QA connue.
require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const fs=require('node:fs'),assert=require('node:assert/strict');
const db=new PrismaClient();
const companyId='2af9684f-bd86-480d-b473-777032fe1f7d';
const marker='QA_DEMO_100_20261105';
const zones=['Administration','Ressources humaines','Finance','Informatique','Opérations','Commercial'];
const positions=['Assistant administratif','Chargé des ressources humaines','Comptable','Développeur','Technicien opérations','Chargé de clientèle'];
const first=['Amina','Jean','Grâce','Patrick','Chantal','Alain','Estelle','Serge','Nadia','Christian','Mireille','David'];
const last=['Makita','Ngoma','Mavoungou','Massamba','Bikindou','Moukoko','Malonga','Bissila','Ngouabi','Mabiala'];
function day(date){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Brazzaville',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
async function main(){
 const company=await db.company.findUnique({where:{id:companyId},select:{id:true,legalName:true}});
 assert.equal(company?.legalName,'KONZA QA TEST — ENTREPRISE FICTIVE','Le script refuse une entreprise non fictive');
 const admin=await db.user.findUnique({where:{email:'qa.konza.20261104@example.com'},select:{id:true,companyId:true,role:true}});
 assert.equal(admin?.companyId,companyId);assert.equal(admin.role,'ADMIN');
 const existing=await db.employee.findMany({where:{companyId},select:{employeeNumber:true}});
 assert.ok(existing.length<=100,'Aucune suppression : l’entreprise contient déjà plus de 100 salariés');
 let required=100-existing.length;
 const result=await db.$transaction(async tx=>{
  const departments=[];
  for(let i=0;i<zones.length;i++)departments.push(await tx.department.upsert({where:{companyId_code:{companyId,code:'QA100_'+i}},update:{},create:{companyId,code:'QA100_'+i,name:zones[i]+' — Démo',description:marker}}));
  const used=new Set(existing.map(e=>e.employeeNumber)),data=[];
  for(let i=1;i<=100&&data.length<required;i++){
   const number='QA100-'+String(i).padStart(3,'0');if(used.has(number))continue;
   const fixed=i%5===0,intern=i%17===0,dept=(i-1)%zones.length;
   data.push({companyId,employeeNumber:number,firstName:first[(i-1)%first.length],lastName:last[(i-1)%last.length]+' (Démo)',email:`qa.demo100.${String(i).padStart(3,'0')}@example.com`,
    dateOfBirth:new Date(Date.UTC(1980+i%20,i%12,1+i%27)),placeOfBirth:i%3?'Brazzaville':'Pointe-Noire',gender:i%2?'FEMALE':'MALE',
    maritalStatus:i%3===0?'MARRIED':'SINGLE',numberOfChildren:i%3===0?i%4:0,address:'Adresse fictive — jeu de démonstration',city:i%3?'Brazzaville':'Pointe-Noire',nationality:'CG',isResident:true,
    departmentId:departments[dept].id,position:positions[dept],hireDate:intern?new Date('2026-09-01'):fixed?new Date('2026-01-01'):new Date(Date.UTC(2018+i%7,i%12,1)),
    contractType:intern?'STAGE':fixed?'CDD':'CDI',contractEndDate:intern?new Date('2027-02-28'):fixed?new Date('2026-12-31'):null,
    baseSalary:intern?100000:[180000,240000,300000,375000,450000,600000,750000,1000000][i%8],paymentMethod:'CASH',status:'ACTIVE',createdById:admin.id});
  }
  if(data.length)await tx.employee.createMany({data});
  return{createdEmployees:data.length,departmentIds:departments.map(d=>d.id)};
 },{timeout:30000});
 const employees=await db.employee.findMany({where:{companyId,employeeNumber:{startsWith:'QA100-'}},select:{id:true,employeeNumber:true,departmentId:true}});
 const settings=await db.payrollSettings.findFirst({where:{companyId},orderBy:{effectiveDate:'desc'},select:{officialStartHour:true,lateToleranceMinutes:true}});
 const startHour=Number(settings?.officialStartHour??8),tolerance=Number(settings?.lateToleranceMinutes??15);
 const today=day(new Date()),dates=[];
 for(let offset=0;dates.length<4;offset++){
  const date=new Date(today+'T12:00:00+01:00');date.setUTCDate(date.getUTCDate()-offset);
  if(date.getUTCDay()!==0)dates.push(day(date));
 }
 dates.sort();
 const attendance=[];
 for(const employee of employees){
  const n=Number(employee.employeeNumber.slice(-3)),onLeave=n%19===0;
  if(onLeave){
   const old=await db.leave.findFirst({where:{companyId,employeeId:employee.id,reason:marker}});
   if(!old)await db.leave.create({data:{companyId,employeeId:employee.id,type:'ANNUAL',startDate:new Date(dates[0]+'T00:00:00Z'),endDate:new Date(today+'T00:00:00Z'),daysCount:dates.length,status:'APPROVED',reason:marker,approvedBy:admin.id,approvedAt:new Date()}});
  }
  for(const date of dates){
   const absent=!onLeave&&n%17===0&&date===dates[0];
   let checkIn=new Date(`${date}T${String(startHour).padStart(2,'0')}:00:00+01:00`);
   if(n%8===0)checkIn=new Date(checkIn.getTime()+(tolerance+10)*60000);
   const inFuture=checkIn>new Date();
   if(inFuture&&!onLeave&&!absent)continue;
   const end=new Date(`${date}T${String(Math.min(startHour+9,23)).padStart(2,'0')}:00:00+01:00`);
   const completed=end<=new Date()&&!onLeave&&!absent;
   const total=completed?Math.max(0,(end-checkIn)/3600000-1):0;
   attendance.push({companyId,employeeId:employee.id,date,status:onLeave?'LEAVE':absent?'ABSENT_UNPAID':n%8===0?'LATE':'PRESENT',
    checkIn:onLeave||absent?null:checkIn,checkOut:completed?end:null,breakMinutes:completed?60:0,totalHours:completed?Number(total.toFixed(2)):null,normalHours:completed?Number(total.toFixed(2)):0,
    checkInMethod:'MANUAL',checkInSource:marker,notes:marker,...(onLeave?{absenceReason:'Congé fictif de démonstration'}:{})});
  }
 }
 const inserted=await db.attendance.createMany({data:attendance,skipDuplicates:true});
 const dept=result.departmentIds[0];
 for(const title of ['Chargé de clientèle — Démonstration','Comptable — Démonstration','Technicien — Démonstration']){
  let job=await db.jobOffer.findFirst({where:{companyId,title,description:marker}});
  if(!job)job=await db.jobOffer.create({data:{companyId,title,description:marker,departmentId:dept,type:'CDI',status:'DRAFT',showOnPortal:false,processingMode:'MANUAL'}});
  for(let i=1;i<=3;i++){
   const email=`qa.candidat.${job.id}.${i}@example.com`;
   if(!await db.candidate.findFirst({where:{jobOfferId:job.id,email}}))await db.candidate.create({data:{jobOfferId:job.id,email,firstName:first[i],lastName:'Candidat fictif '+i,status:i===1?'APPLIED':'EN_ATTENTE_TEST',hrNotes:marker}});
  }
 }
 const total=await db.employee.count({where:{companyId}});assert.equal(total,100);
 const report={timestamp:new Date().toISOString(),companyId,company:company.legalName,adminEmail:'qa.konza.20261104@example.com',totalEmployees:total,createdEmployees:result.createdEmployees,
  demonstrationEmployees:employees.length,createdAttendance:inserted.count,attendanceDates:dates,description:'Données fictives persistantes, aucun utilisateur salarié créé, aucune invitation ni paiement envoyé.'};
 fs.writeFileSync('../qa-demo-100-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
