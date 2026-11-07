
import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { assertCompanyAccess } from '../common/resolve-verified-company.util';
import { buildPayrollEvent, fcfa, payrollLines, payloadHash, canonicalJson } from './payroll-contract';

const accepted=new Set(['SUCCEEDED','REPLAYED']);
const asJson=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class ComptaConnectorService {
 constructor(private readonly db:PrismaService,private readonly crypto:CryptoService){}
 private base(){
  const configured=process.env.KONZA_COMPTA_API_URL;
  if(!configured)throw new BadRequestException('KONZA_COMPTA_API_URL doit être configurée sur le serveur RH.');
  const url=new URL(configured);
  if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol))throw new BadRequestException('Adresse du serveur Compta invalide.');
  if(url.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new BadRequestException('HTTPS obligatoire hors développement local.');
  return url.toString().replace(/\/$/,'');
 }
 private async request(path:string,method:'GET'|'POST',payload?:unknown,secret?:string){
  const timestamp=String(Math.floor(Date.now()/1000));
  const body=payload===undefined?undefined:canonicalJson(payload);
  const headers:Record<string,string>={'Accept':'application/json','X-Konza-Schema':'1'};
  if(body)headers['Content-Type']='application/json';
  if(secret){headers['X-Timestamp']=timestamp;headers['X-Signature']=createHmac('sha256',secret).update(timestamp+'.'+(body??'GET')).digest('hex');}
  let response:Response;
  try{response=await fetch(this.base()+path,{method,headers,body,signal:AbortSignal.timeout(15000),redirect:'error'});}
  catch{throw new BadGatewayException('Serveur Compta injoignable ; aucune transmission confirmée.');}
  const data=await response.json();
  if(!response.ok)throw new BadGatewayException(typeof data.detail==='string'?data.detail:'Échange refusé par Compta ('+response.status+').');
  return data;
 }
 private secret(link:{secretEnc:string}){if(!this.crypto.isEncrypted(link.secretEnc))throw new BadRequestException('Secret chiffré invalide.');const value=this.crypto.decrypt(link.secretEnc);if(!value)throw new BadRequestException('Secret illisible : une nouvelle liaison est nécessaire.');return value;}
 private async active(userId:string,companyId:string){
  const [user,company]=await Promise.all([this.db.user.findUnique({where:{id:userId},select:{isActive:true}}),this.db.company.findUnique({where:{id:companyId},select:{isActive:true,archivedAt:true}})]);
  if(!user?.isActive||!company?.isActive||company.archivedAt)throw new ForbiddenException('Le responsable ou l’entreprise RH est désactivé.');
 }
 private async scope(userId:string,companyId?:string){
  if(process.env.KONZA_COMPTA_CONNECTOR_ENABLED!=='true')throw new ServiceUnavailableException('Connecteur désactivé : appliquer la migration RH, générer Prisma puis activer KONZA_COMPTA_CONNECTOR_ENABLED.');
  const user=await this.db.user.findUnique({where:{id:userId},select:{companyId:true}});
  const target=companyId??user?.companyId;
  if(!target)throw new BadRequestException('Choisissez une entreprise RH.');
  await assertCompanyAccess(this.db,userId,target,{write:true});
  await this.active(userId,target);
  return target;
 }
 async status(userId:string,companyId?:string){
  const id=await this.scope(userId,companyId);
  const link=await this.db.comptaConnector.findUnique({where:{companyId:id}});
  const payrolls=await this.db.payroll.findMany({where:{companyId:id,status:'TO_PAY',paid:false},include:{items:{orderBy:[{order:'asc'},{id:'asc'}]},employee:{select:{id:true,firstName:true,lastName:true}}},take:500});
  const requirements=new Map<string,{key:string;label:string}>();
  const blocked:{payrollId:string;detail:string}[]=[];
  for(const p of payrolls){try{for(const line of payrollLines(p))requirements.set(line.key,{key:line.key,label:line.label});}catch(e){blocked.push({payrollId:p.id,detail:e instanceof Error?e.message:'Bulletin incohérent.'});}}
  const deliveries=link?await this.db.comptaDelivery.findMany({where:{connectorId:link.id},select:{id:true,externalId:true,payrollId:true,state:true,detail:true,attempts:true,remoteEventId:true,createdAt:true},orderBy:{createdAt:'desc'},take:100}):[];
  return {linked:!!link?.enabled,remoteCompanyName:link?.remoteCompanyName??null,remoteCompanyId:link?.remoteCompanyId??null,lastSyncAt:link?.lastSyncAt??null,lastError:link?.lastError??null,mappings:link?.mappings??{},requirements:[...requirements.values()],blocked,deliveries,pendingPayrolls:payrolls.length,limit:500};
 }
 async pair(userId:string,code:string,companyId?:string){
  const id=await this.scope(userId,companyId);
  const existing=await this.db.comptaConnector.findUnique({where:{companyId:id}});
  if(existing?.enabled)throw new ConflictException('Une liaison existe déjà. Sa révocation doit être effectuée dans les deux produits avant remplacement.');
  const company=await this.db.company.findUniqueOrThrow({where:{id},select:{legalName:true}});
  const paired=await this.request('/v1/connect/pair','POST',{code,counterpartName:'Konza RH · '+company.legalName,expectedProduct:'RH',sourceCompanyId:id,schemaVersion:1});
  const uuid=/^[0-9a-f-]{36}$/i;
  if(paired.product!=='RH'||paired.schemaVersion!==1||!uuid.test(paired.companyId)||!uuid.test(paired.linkId)||typeof paired.secret!=='string'||paired.secret.length<32)throw new BadGatewayException('Le serveur ne fournit pas le contrat Konza Connect RH version 1.');
  if(existing){
   if(existing.remoteCompanyId!==paired.companyId||existing.remoteLinkId!==paired.linkId)throw new ConflictException('La nouvelle liaison doit viser le même dossier Compta pour préserver l’historique.');
   await this.db.comptaConnector.update({where:{id:existing.id},data:{secretEnc:this.crypto.encrypt(paired.secret)!,enabled:true,ownerUserId:userId}});
   return this.status(userId,id);
  }
  await this.db.comptaConnector.create({data:{companyId:id,ownerUserId:userId,remoteCompanyId:paired.companyId,remoteLinkId:paired.linkId,remoteCompanyName:String(paired.companyName??'Entreprise Compta'),secretEnc:this.crypto.encrypt(paired.secret)!}});
  return this.status(userId,id);
 }
 async mappings(userId:string,value:Record<string,string>,companyId?:string){
  const id=await this.scope(userId,companyId);
  const pairs=Object.entries(value);
  if(pairs.length>200||pairs.some(([key,code])=>!/^[-A-Z0-9_]{1,80}$/.test(key)||!/^\d{2,10}$/.test(code)))throw new BadRequestException('Chaque rubrique doit désigner un compte numérique SYSCOHADA de 2 à 10 chiffres.');
  const link=await this.db.comptaConnector.findUnique({where:{companyId:id}});
  if(!link)throw new NotFoundException('Liez d’abord l’entreprise Compta.');
  await this.db.comptaConnector.update({where:{id:link.id},data:{mappings:asJson(value)}});
  return this.status(userId,id);
 }
 private async collect(link:{id:string;companyId:string;mappings:Prisma.JsonValue}){
  const rows=await this.db.payroll.findMany({where:{companyId:link.companyId,status:'TO_PAY',paid:false,comptaDeliveries:{none:{connectorId:link.id,externalId:{startsWith:'rh:payroll:'}}}},include:{items:{orderBy:[{order:'asc'},{id:'asc'}]},employee:{select:{id:true,firstName:true,lastName:true}}},orderBy:{id:'asc'},take:500});
  const errors:string[]=[];
  for(const p of rows){
   const externalId='rh:payroll:'+p.id;
   const prior=await this.db.comptaDelivery.findUnique({where:{connectorId_externalId:{connectorId:link.id,externalId}}});
   try{
    const payload=buildPayrollEvent(p,link.mappings as Record<string,string>);
    const hash=payloadHash(payload);
    if(prior){if(prior.payloadHash!==hash)errors.push('BULLETIN_MODIFIE_APRES_EXPORT : '+p.id+' ; annulation/contre-passation requise.');continue;}
    await this.db.comptaDelivery.upsert({where:{connectorId_externalId:{connectorId:link.id,externalId}},create:{connectorId:link.id,payrollId:p.id,externalId,payload:asJson(payload),payloadHash:hash},update:{}});
   }catch(e){errors.push(p.id+' : '+(e instanceof Error?e.message:'Export bloqué.'));}
  }
  // L'annulation possède son propre identifiant : aucun effacement de l'écriture source.
  const sent=await this.db.comptaDelivery.findMany({where:{connectorId:link.id,state:'SENT',externalId:{startsWith:'rh:payroll:'}},take:500});
  for(const item of sent){
   const p=await this.db.payroll.findFirst({where:{id:item.payrollId,companyId:link.companyId},select:{status:true}});
   if(!p||p.status!=='CANCELLED')continue;
   const externalId='rh:cancel:'+item.payrollId;
   const payload={schemaVersion:1,id:externalId,type:'PAYROLL_CANCELLED',reference:'Annulation bulletin '+item.payrollId.slice(0,8),data:{currency:'XAF',originalId:item.externalId,date:new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Brazzaville'}).format(new Date())}};
   await this.db.comptaDelivery.upsert({where:{connectorId_externalId:{connectorId:link.id,externalId}},create:{connectorId:link.id,payrollId:item.payrollId,externalId,payload:asJson(payload),payloadHash:payloadHash(payload)},update:{}});
  }
  return errors;
 }
 private async outgoing(link:{id:string;companyId:string;remoteCompanyId:string;remoteLinkId:string},secret:string,force:boolean){
  const rows=await this.db.comptaDelivery.findMany({where:{connectorId:link.id,state:{in:['PENDING','FAILED']},...(force?{}:{nextAttemptAt:{lte:new Date()}}),OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},orderBy:{createdAt:'asc'},take:50});
  for(const row of rows){
   const claimed=await this.db.comptaDelivery.updateMany({where:{id:row.id,state:{in:['PENDING','FAILED']},OR:[{leaseUntil:null},{leaseUntil:{lt:new Date()}}]},data:{leaseUntil:new Date(Date.now()+60000)}});
   if(!claimed.count)continue;
   try{
    await this.db.$transaction(async tx=>{
     await tx.$queryRawUnsafe('SELECT id FROM payrolls WHERE id = $1::uuid AND "companyId" = $2::uuid FOR UPDATE',row.payrollId,link.companyId);
     if(row.externalId.startsWith('rh:payroll:')){
      const payroll=await tx.payroll.findFirst({where:{id:row.payrollId,companyId:link.companyId},include:{items:{orderBy:[{order:'asc'},{id:'asc'}]},employee:{select:{id:true,firstName:true,lastName:true}}}});
      const configuration=await tx.comptaConnector.findUniqueOrThrow({where:{id:link.id}});
      if(!configuration.enabled)throw new Error('Liaison suspendue.');
      if(!payroll||payloadHash(buildPayrollEvent(payroll,configuration.mappings as Record<string,string>))!==row.payloadHash)throw new Error('BULLETIN_MODIFIE : transmission bloquée, contrôlez la source.');
     }
     const result=await this.request('/v1/connect/inbound/'+link.remoteCompanyId+'/'+link.remoteLinkId,'POST',row.payload,secret);
     if(!accepted.has(result.status))throw new Error(result.detail??'Événement en échec dans Compta : corrigez puis rejouez-le depuis Compta.');
     await tx.comptaDelivery.update({where:{id:row.id},data:{state:'SENT',remoteEventId:result.eventId,detail:null,attempts:{increment:1},leaseUntil:null}});
    },{timeout:30000});
   }catch(e){
    await this.db.comptaDelivery.update({where:{id:row.id},data:{state:'FAILED',detail:e instanceof Error?e.message:'Transmission non confirmée.',attempts:{increment:1},leaseUntil:null,nextAttemptAt:new Date(Date.now()+Math.min(3600000,60000*2**Math.min(row.attempts,6)))}});
   }
  }
 }
 private async incoming(link:{id:string;companyId:string;remoteCompanyId:string;remoteLinkId:string},secret:string){
  const inbox=await this.request('/v1/connect/outbox/'+link.remoteCompanyId+'/'+link.remoteLinkId,'GET',undefined,secret);
  const timestamp=String(inbox.timestamp??'');
  if(inbox.schemaVersion!==1||!Array.isArray(inbox.events)||Math.abs(Date.now()/1000-Number(timestamp))>300||!Number.isFinite(Number(timestamp))||typeof inbox.signature!=='string'||!/^[0-9a-f]{64}$/i.test(inbox.signature))throw new BadGatewayException('Réponse Compta non signée ou expirée.');
  const expected=createHmac('sha256',secret).update(timestamp+'.'+canonicalJson(inbox.events)).digest();
  if(!timingSafeEqual(expected,Buffer.from(inbox.signature,'hex')))throw new BadGatewayException('Signature de la réponse Compta invalide.');
  for(const event of inbox.events){
   if(event.type!=='PAYMENT_EXECUTED'||typeof event.externalId!=='string')throw new BadGatewayException('Type de notification non supporté.');
   const payload=event.payload;
   const hash=payloadHash(payload);
   await this.db.$transaction(async tx=>{
    // Serialise les réponses simultanées et garde reçu + état PAID atomiques.
    await tx.$queryRawUnsafe('SELECT id FROM compta_connectors WHERE id = $1::uuid FOR UPDATE',link.id);
    const receipt=await tx.comptaReceipt.findUnique({where:{connectorId_externalId:{connectorId:link.id,externalId:event.externalId}}});
    if(receipt){if(receipt.payloadHash!==hash)throw new ConflictException('Une notification a changé de contenu.');return;}
    const delivery=await tx.comptaDelivery.findFirst({where:{connectorId:link.id,remoteEventId:payload.payrollId,externalId:{startsWith:'rh:payroll:'},state:'SENT'}});
    if(!delivery)throw new BadRequestException('Notification sans bulletin RH transmis et confirmé.');
    const sent=delivery.payload as {data:{netToPay:number}};
    if(payload.currency!=='XAF'||fcfa(payload.amount)!==sent.data.netToPay||!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)||new Date(payload.date).toISOString().slice(0,10)!==payload.date)throw new BadRequestException('Montant, devise ou date du paiement incohérent.');
    const payroll=await tx.payroll.findFirst({where:{id:delivery.payrollId,companyId:link.companyId}});
    if(!payroll||!['TO_PAY','VALIDATED','PAID'].includes(payroll.status)||fcfa(payroll.netSalary)!==sent.data.netToPay)throw new ConflictException('Bulletin modifié ou annulé depuis la transmission.');
    if(payroll.status!=='PAID')await tx.payroll.update({where:{id:payroll.id},data:{status:'PAID',paid:true,paidAt:new Date(payload.date),paymentDate:new Date(payload.date),paymentReference:String(payload.entryId).slice(0,100)}});
    await tx.comptaReceipt.create({data:{connectorId:link.id,externalId:event.externalId,payloadHash:hash}});
   });
   const ack={schemaVersion:1,id:'rh:ack:'+event.externalId,type:'ACK',reference:'Réception du paiement dans Konza RH',data:{externalId:event.externalId}};
   const result=await this.request('/v1/connect/inbound/'+link.remoteCompanyId+'/'+link.remoteLinkId,'POST',ack,secret);
   if(!accepted.has(result.status))throw new BadGatewayException('Paiement reçu, accusé Compta encore en attente.');
  }
 }
 private async run(id:string,force=false){
  const link=await this.db.comptaConnector.findUniqueOrThrow({where:{id}});
  if(!link.enabled)return;
  try{
   await assertCompanyAccess(this.db,link.ownerUserId,link.companyId,{write:true});
   await this.active(link.ownerUserId,link.companyId);
   const errors=await this.collect(link);
   const secret=this.secret(link);
   await this.outgoing(link,secret,force);
   await this.incoming(link,secret);
   await this.db.comptaConnector.update({where:{id},data:{lastSyncAt:new Date(),lastError:errors.length?errors.slice(0,10).join('\n'):null}});
  }catch(e){await this.db.comptaConnector.update({where:{id},data:{lastError:e instanceof Error?e.message:'Synchronisation interrompue.'}});}
 }
 async sync(userId:string,companyId?:string){
  const company=await this.scope(userId,companyId);
  const link=await this.db.comptaConnector.findUnique({where:{companyId:company}});
  if(!link?.enabled)throw new BadRequestException('Aucune liaison active.');
  await this.run(link.id,true);
  return this.status(userId,company);
 }
 async suspend(userId:string,companyId?:string){const id=await this.scope(userId,companyId);await this.db.comptaConnector.update({where:{companyId:id},data:{enabled:false}});return this.status(userId,id);}
 @Cron(CronExpression.EVERY_MINUTE)
 async tick(){if(process.env.KONZA_COMPTA_CONNECTOR_ENABLED!=='true')return;const links=await this.db.comptaConnector.findMany({where:{enabled:true},select:{id:true}});for(const link of links)await this.run(link.id);}
}
