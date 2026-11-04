require('dotenv').config();
const {PrismaClient}=require('@prisma/client');
const bcrypt=require('bcrypt');const fs=require('node:fs');const assert=require('node:assert/strict');
const {req,cookie}=require('../qa-security-audit.cjs');const prisma=new PrismaClient();const rows=[];
function record(test,r,extra={}){const row={test,status:r.status,...extra};rows.push(row);console.log(JSON.stringify(row));}
async function main(){
 const companyId='2af9684f-bd86-480d-b473-777032fe1f7d',email='qa.deep-role.20261104@example.com';
 const company=await prisma.company.findUnique({where:{id:companyId},select:{legalName:true}});assert.ok(company.legalName.includes('KONZA QA TEST'));
 const alice=JSON.parse(fs.readFileSync('../qa-test-employees.json')).data[0];
 const dept=await prisma.department.upsert({where:{companyId_code:{companyId,code:'QA_DEEP_ROLE'}},create:{companyId,code:'QA_DEEP_ROLE',name:'QA DEEP ROLE — FICTIF'},update:{}});
 let emp=await prisma.employee.findFirst({where:{companyId,email}});
 if(!emp)emp=await prisma.employee.create({data:{companyId,departmentId:dept.id,employeeNumber:'QA-DEEP-ROLE',firstName:'Role QA',lastName:'FICTIF',email,address:'Fixture QA',dateOfBirth:new Date('1990-01-01'),placeOfBirth:'Fixture QA',gender:'MALE',hireDate:new Date('2026-11-04'),contractType:'CDI',position:'Fixture QA',baseSalary:100000}});
 const password='QArole!2026_Fictif';const hash=await bcrypt.hash(password,10);
 const user=await prisma.user.upsert({where:{email},create:{email,password:hash,firstName:'Role QA',lastName:'FICTIF',role:'EMPLOYEE',companyId,employeeId:emp.id,mustChangePassword:false},update:{role:'EMPLOYEE',isActive:true,password:hash,mustChangePassword:false,failedLoginAttempts:0,lockedUntil:null}});
 let candidate,job,assignment;
 try {
  job=await prisma.jobOffer.create({data:{companyId,departmentId:alice.departmentId,title:'QA_CONFIDENTIEL_RECRUTEMENT_FICTIF',description:'Fixture privée',type:'CDI',status:'DRAFT',showOnPortal:false}});
  candidate=await prisma.candidate.create({data:{jobOfferId:job.id,firstName:'Candidat QA',lastName:'FICTIF',email:'qa.deep-candidate.20261104@example.com',coverLetter:'QA_LETTRE_CONFIDENTIELLE_FICTIVE',hrNotes:'QA_NOTE_RH_CONFIDENTIELLE_FICTIVE'}});
  const login=await req('/auth/login',null,'POST',{email,password});assert.equal(login.status,200);assert.ok(login.cookies.some(c=>c.startsWith('access_token=')));const ce=cookie(login);
  const paths=['/employees','/employees/simple',`/employees/${alice.id}`,'/payrolls','/users','/audit/logs','/dashboard/summary','/recruitment/candidates',`/recruitment/candidates/${candidate.id}`,'/assets',`/assets/employee/${alice.id}`,'/performance/stats',`/performance/reviews/employee/${alice.id}`,`/training/passeport/${alice.id}`,'/subscriptions/current'];
  for(const path of paths){const r=await req(path,ce);record('EMPLOYEE '+path,r,{containsOtherSalary:JSON.stringify(r.data).includes('250000'),containsPrivateHrNote:JSON.stringify(r.data).includes('QA_NOTE_RH_CONFIDENTIELLE_FICTIVE'),containsPrivateCoverLetter:JSON.stringify(r.data).includes('QA_LETTRE_CONFIDENTIELLE_FICTIVE'),shape:Array.isArray(r.data)?`array:${r.data.length}`:Object.keys(r.data||{})});}
  const edited=await req(`/recruitment/candidates/${candidate.id}/status`,ce,'PATCH',{status:'REJECTED',notes:'QA_EMPLOYEE_MODIFICATION_FICTIVE'});
  record('EMPLOYEE edits candidate status',edited,{statusChanged:edited.data?.status==='REJECTED'});
  await prisma.user.update({where:{id:user.id},data:{role:'MANAGER'}});await prisma.department.update({where:{id:dept.id},data:{managerId:user.id}});
  for(const path of [`/employees/${alice.id}`,`/attendance/shift-assignments/${alice.id}`,'/attendance/shift-assignments',`/training/passeport/${alice.id}`,`/performance/reviews/employee/${alice.id}`]){const r=await req(path,ce);record('MANAGER other department '+path,r,{containsAlice:JSON.stringify(r.data).includes(alice.id),shape:Array.isArray(r.data)?`array:${r.data.length}`:Object.keys(r.data||{})});}
  assignment=await prisma.employeeShiftAssignment.findUnique({where:{employeeId_specificDate:{employeeId:alice.id,specificDate:'2030-01-15'}}});assert.ok(assignment);
  const changed=await req('/attendance/shift-assignments',ce,'POST',{employeeId:alice.id,shiftId:assignment.shiftId,specificDate:'2030-01-15',notes:'QA_MANAGER_HORS_DEPARTEMENT_FICTIF'});
  record('MANAGER changes other department schedule',changed,{modified:changed.data?.notes==='QA_MANAGER_HORS_DEPARTEMENT_FICTIF'});
 }finally {
  await prisma.user.update({where:{id:user.id},data:{role:'EMPLOYEE',isActive:false}});
  await prisma.userSession.updateMany({where:{userId:user.id,revokedAt:null},data:{revokedAt:new Date()}});
  if(assignment)await prisma.employeeShiftAssignment.update({where:{id:assignment.id},data:{shiftId:assignment.shiftId,notes:assignment.notes}});
  if(candidate)await prisma.candidate.update({where:{id:candidate.id},data:{status:candidate.status,hrNotes:'QA_NOTE_RH_CONFIDENTIELLE_FICTIVE'}});
  rows.push({test:'cleanup',fixtureUserDisabled:true,fixtureRoleRestored:'EMPLOYEE',aliceAssignmentRestored:!!assignment});
 }
}
main().catch(e=>{console.error(e.message);rows.push({test:'setup-or-cleanup',error:e.message});process.exitCode=1;}).finally(async()=>{fs.writeFileSync('../qa-role-results.json',JSON.stringify(rows,null,2));await prisma.$disconnect();});
