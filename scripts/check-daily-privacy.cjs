require('ts-node').register({transpileOnly:true});
require('reflect-metadata');
const assert=require('node:assert/strict');
const {Logger,BadRequestException}=require('@nestjs/common');
const {GlobalExceptionFilter}=require('../src/filters/global-exception.filter');
const {isDailyPrivateRoute}=require('../src/daily-workspace/daily-privacy');
const {anniversaryMessage}=require('../src/daily-workspace/anniversary-message');
Logger.overrideLogger(false);
async function main(){
  for(const path of ['/tasks','/tasks/abc/comments','/api/day-events','/anniversaries/notifications','/appearance/me','/users/me/appearance','/companies/abc/appearance'])assert.ok(isDailyPrivateRoute(path),path);
  assert.equal(isDailyPrivateRoute('/employees'),false);
  const stored=[],responses=[];const filter=new GlobalExceptionFilter({appError:{create:async value=>stored.push(value.data)}});
  const request={path:'/tasks',method:'POST',headers:{},body:{title:'Contenu personnel confidentiel'},query:{q:'Contenu personnel confidentiel'},user:{userId:'fixture',companyId:'fixture'}};
  const response={status(){return this;},json(value){responses.push(value);}};
  const host={switchToHttp:()=>({getRequest:()=>request,getResponse:()=>response})};
  await filter.catch(new Error('Contenu personnel confidentiel'),host);
  assert.ok(!JSON.stringify(stored).includes('Contenu personnel'));assert.deepEqual(stored[0].body,{redacted:true});assert.deepEqual(stored[0].query,{redacted:true});assert.equal(stored[0].stack,null);assert.equal(responses[0].statusCode,500);
  await filter.catch(new BadRequestException('Texte vide ou trop long.'),host);assert.deepEqual(stored[1].body,{redacted:true});
  for(const years of [1,2,3,5,10,20]){const a=anniversaryMessage(years,2026,'Entreprise','Test',true),b=anniversaryMessage(years,2027,'Entreprise','Test',true);assert.notEqual(a,b);assert.ok(a.endsWith('Konza RH, au nom de Entreprise.'));}
  console.log('PASS: contenus privés masqués dans les erreurs, routes ciblées et bibliothèque de messages d’ancienneté.');
}main().catch(e=>{console.error(e);process.exitCode=1;});
