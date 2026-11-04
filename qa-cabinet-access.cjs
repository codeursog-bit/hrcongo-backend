require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client'),bcrypt=require('bcrypt'),fs=require('node:fs'),assert=require('node:assert/strict');
const db=new PrismaClient(),rows=[],users=[],cabs=[],cookies=[];
const tag='qa-cabinet-'+Date.now(),password='QA_Cabinet!2026_Fictif';
const companyA='2af9684f-bd86-480d-b473-777032fe1f7d';
let doc,payroll,createdJob;
async function req(path,cookie,method='GET',body){const r=await fetch('http://localhost:3001'+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const raw=await r.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}return{status:r.status,data,cookies:r.headers.getSetCookie()};}
async function check(test,fn){try{const extra=await fn();rows.push({test,passed:true,...extra});}catch(e){rows.push({test,passed:false,error:e.message});}console.log(JSON.stringify(rows.at(-1)));}
async function main(){
 const b=await db.user.findUnique({where:{email:'qa.isolation.20261104@example.com'},select:{companyId:true}});assert.ok(b?.companyId);
 const alice=await db.employee.findUnique({where:{id:'889ca63b-3a78-4c34-9b63-0e7a3c58545e'},select:{id:true,companyId:true,departmentId:true}});assert.equal(alice.companyId,companyA);
 for(let i=0;i<2;i++){const cab=await db.cabinet.create({data:{name:'CABINET QA FICTIF '+i,email:`${tag}.${i}@example.com`,subdomain:`${tag}-${i}`}});cabs.push(cab);}
 for(const[i,role]of ['CABINET_ADMIN','CABINET_GESTIONNAIRE','CABINET_ADMIN'].entries()){
  const u=await db.user.create({data:{email:`${tag}.user${i}@example.com`,password:await bcrypt.hash(password,10),firstName:'QA',lastName:'CABINET FICTIF',role,isActive:true,mustChangePassword:false}});users.push(u);
  await db.cabinetUser.create({data:{cabinetId:cabs[i===2?1:0].id,userId:u.id,role:i===1?'GESTIONNAIRE':'CABINET_ADMIN'}});
 }
 for(const[i,companyId]of [companyA,b.companyId].entries())await db.cabinetCompany.create({data:{cabinetId:cabs[i].id,companyId,isActive:true,startDate:new Date()}});
 for(const u of users){const r=await req('/auth/login',null,'POST',{email:u.email,password});assert.equal(r.status,200,'Login fixture');cookies.push(r.cookies.map(x=>x.split(';')[0]).filter(x=>!x.endsWith('=')).join('; '));}
 const[admin,manager,outside]=cookies,cabId=cabs[0].id,base='/cabinet/'+cabId;
 doc=await db.document.create({data:{companyId:companyA,employeeId:alice.id,name:tag+'_PRIVATE_DOCUMENT',type:'CONTRACT',fileUrl:tag+'_DUMMY_PRIVATE_FILE',mimeType:'application/pdf'}});
 payroll=await db.payroll.create({data:{companyId:companyA,employeeId:alice.id,month:2,year:2040,periodStart:new Date('2040-02-01'),periodEnd:new Date('2040-02-29'),workDays:26,workedDays:26,absenceDays:0,baseSalary:100,grossSalary:100,netSalary:100,totalDeductions:0,totalEmployerCost:100,status:'DRAFT'}});
 await check('anonymous cabinet denied',async()=>assert.equal((await req(base+'/access')).status,401));
 for(const[c,name,role]of [[admin,'admin','CABINET_ADMIN'],[manager,'manager','GESTIONNAIRE']])await check(name+' effective cabinet role',async()=>{const r=await req(base+'/access',c);assert.equal(r.status,200);assert.equal(r.data.role,role);assert.equal(r.data.canAdminister,role==='CABINET_ADMIN');});
 for(const suffix of ['/access','/dashboard',`/companies/${companyA}/context`])await check('outside cabinet denied '+suffix,async()=>assert.equal((await req(base+suffix,outside)).status,403));
 for(const suffix of ['', '/profile','/gestionnaires','/subscription','/wallet'])await check('manager administrative read denied '+suffix,async()=>assert.equal((await req(base+suffix,manager)).status,403));
 for(const[method,suffix,body]of [['PATCH','',{name:'MUST_NOT_WRITE'}],['POST','/users',{email:'qa.must-not-invite@example.com',role:'CABINET_ADMIN'}],['PATCH',`/companies/${companyA}/access`,{pmePortalEnabled:true}],['POST','/subscription/confirm-payment',{}]])await check('manager administrative write denied '+suffix,async()=>assert.equal((await req(base+suffix,manager,method,body)).status,403));
 await check('admin can read member administration',async()=>assert.equal((await req(base,admin)).status,200));
 await check('manager dashboard omits cabinet wallet',async()=>{const r=await req(base+'/dashboard',manager);assert.equal(r.status,200);assert.ok(!('wallet'in r.data));assert.ok(r.data.companies.some(c=>c.companyId===companyA));});
 await check('manager enters linked company context',async()=>{const r=await req(`${base}/companies/${companyA}/context`,manager);assert.equal(r.status,200);assert.equal(r.data.company.id,companyA);assert.equal(r.data.canAdminister,false);});
 await check('manager cannot substitute unlinked company',async()=>assert.equal((await req(`${base}/companies/${b.companyId}/context`,manager)).status,404));
 for(const path of ['/employees','/assets','/training/courses','/documents','/recruitment/jobs']){
  await check('linked company read '+path,async()=>{const r=await req(path+'?companyId='+companyA,manager);assert.equal(r.status,200);if(path==='/documents')assert.ok(r.data.some(d=>d.id===doc.id));});
  await check('foreign company read denied '+path,async()=>assert.equal((await req(path+'?companyId='+b.companyId,manager)).status,403));
 }
 await check('linked payroll detail is readable',async()=>{const r=await req('/payrolls/'+payroll.id+'?companyId='+companyA,manager);assert.equal(r.status,200);assert.equal(r.data.id,payroll.id);});
 await check('outside cabinet cannot read payroll',async()=>assert.equal((await req('/payrolls/'+payroll.id,outside)).status,403));
 await check('outside cabinet cannot read private document',async()=>assert.equal((await req('/documents/'+doc.id,outside)).status,403));
 const offer={title:tag+'_JOB',description:'Offre de test fictive',departmentId:alice.departmentId,contractType:'CDI',status:'DRAFT',processingMode:'MANUAL',showOnPortal:false};
 await check('manager can create a draft job for linked company',async()=>{const r=await req('/recruitment/jobs?companyId='+companyA,manager,'POST',offer);if(r.status===201)createdJob=r.data;assert.equal(r.status,201);assert.equal(r.data.companyId,companyA);});
 if(createdJob){
  await check('linked job detail and candidates available',async()=>{assert.equal((await req('/recruitment/jobs/'+createdJob.id,manager)).status,200);assert.equal((await req('/recruitment/jobs/'+createdJob.id+'/candidates',manager)).status,200);});
  await check('outside cabinet cannot open job',async()=>assert.equal((await req('/recruitment/jobs/'+createdJob.id,outside)).status,403));
 }
 await check('cannot create job for foreign company',async()=>assert.equal((await req('/recruitment/jobs?companyId='+b.companyId,manager,'POST',offer)).status,403));
 await check('last administrator cannot demote itself',async()=>assert.equal((await req(base+'/users',admin,'POST',{email:users[0].email,role:'GESTIONNAIRE'})).status,403));
 await check('membership demotion applies to existing session',async()=>{await db.cabinetUser.update({where:{cabinetId_userId:{cabinetId:cabId,userId:users[0].id}},data:{role:'GESTIONNAIRE'}});assert.equal((await req(base+'/access',admin)).data.role,'GESTIONNAIRE');assert.equal((await req(base+'/gestionnaires',admin)).status,403);assert.equal((await req('/auth/verify',admin,'POST',{})).data.user.role,'CABINET_GESTIONNAIRE');});
 await check('inactive link immediately blocks company access',async()=>{await db.cabinetCompany.update({where:{cabinetId_companyId:{cabinetId:cabId,companyId:companyA}},data:{isActive:false}});assert.equal((await req(`${base}/companies/${companyA}/context`,manager)).status,403);assert.equal((await req('/employees?companyId='+companyA,manager)).status,403);});
 await check('removed membership invalidates existing session',async()=>{await db.cabinetUser.delete({where:{cabinetId_userId:{cabinetId:cabId,userId:users[1].id}}});assert.equal((await req(base+'/access',manager)).status,401);});
 await check('inactive cabinet invalidates existing session',async()=>{await db.cabinet.update({where:{id:cabs[1].id},data:{isActive:false}});assert.equal((await req('/auth/me',outside)).status,401);});
}
main().catch(e=>{rows.push({test:'setup/runtime',passed:false,error:e.message});console.error(e.message);}).finally(async()=>{
 try{
  if(createdJob)await db.jobOffer.delete({where:{id:createdJob.id}});
  if(doc)await db.document.delete({where:{id:doc.id}});
  if(payroll)await db.payroll.delete({where:{id:payroll.id}});
  for(const cab of cabs)await db.cabinet.delete({where:{id:cab.id}});
  for(const u of users)await db.user.delete({where:{id:u.id}});
  rows.push({test:'QA fixtures cleaned',passed:true});
 }catch(e){rows.push({test:'cleanup',passed:false,error:e.message});}
 fs.writeFileSync('../qa-cabinet-access-results.json',JSON.stringify({timestamp:new Date().toISOString(),results:rows},null,2));
 console.log(`${rows.filter(r=>r.passed).length}/${rows.length} passed`);if(rows.some(r=>!r.passed))process.exitCode=1;await db.$disconnect();
});
