import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EffectiveLimits, OPTION_LABELS, resolveLimits } from './entitlements.config';

export async function effectiveCompanyLimits(prisma:any, companyId:string, plan?:string):Promise<EffectiveLimits> {
  const subscription=await prisma.subscription.findUnique({where:{companyId}});
  return resolveLimits(plan ?? subscription?.plan ?? 'FREE',subscription?.featureOverrides);
}

export function quotaMonth(now=new Date()) {
  const period=new Date(now.getTime()+3600000).toISOString().slice(0,7);
  const [year,month]=period.split('-').map(Number);
  return {period,start:new Date(Date.UTC(year,month-1,1,-1)),end:new Date(Date.UTC(year,month,1,-1))};
}

@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma:PrismaService) {}

  async get(companyId:string) {
    const sub=await this.prisma.subscription.findUnique({where:{companyId}});
    if(!sub) throw new NotFoundException('Abonnement introuvable.');
    const limits=resolveLimits(sub.plan,(sub as any).featureOverrides);
    const {period}=quotaMonth();
    const usage=await (this.prisma as any).subscriptionUsage.findMany({where:{companyId,period}});
    const counts:Record<string,number>=Object.fromEntries(usage.map((row:any)=>[row.key,row.used]));
    const {start,end}=quotaMonth();
    await Promise.all(['maxLoansAdvances','maxPermissionTickets','maxAbsenceRequests','maxLeaveRequests','maxJobOffers'].map(async key=>{if(counts[key]===undefined)counts[key]=await this.initialUsage(companyId,key,start,end);}));
    return {plan:sub.plan,limits,period,usage:counts,
      overrides:(sub as any).featureOverrides ?? {},options:OPTION_LABELS};
  }

  async setOverride(companyId:string,key:string,dto:{value:boolean|number;expiresAt?:string|null;note?:string},actor:string) {
    if(!Object.prototype.hasOwnProperty.call(OPTION_LABELS,key)) throw new BadRequestException('Option inconnue.');
    if(key.startsWith('has') ? typeof dto.value!=='boolean' :
      typeof dto.value!=='number'||!Number.isInteger(dto.value)||dto.value< -1||dto.value>10000000) throw new BadRequestException('Valeur invalide pour cette option.');
    if(dto.expiresAt && (!Number.isFinite(Date.parse(dto.expiresAt))||Date.parse(dto.expiresAt)<=Date.now())) throw new BadRequestException('La date de fin doit être future.');
    await this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`entitlements:${companyId}`}))`;
      const sub=await tx.subscription.findUnique({where:{companyId}});
      if(!sub) throw new NotFoundException('Abonnement introuvable.');
      const overrides={...((sub as any).featureOverrides||{}),[key]:{value:dto.value,expiresAt:dto.expiresAt||null,note:(dto.note||'').slice(0,500),updatedBy:actor,updatedAt:new Date().toISOString()}};
      await tx.subscription.update({where:{companyId},data:{featureOverrides:overrides} as any});
    });
    return this.get(companyId);
  }

  async removeOverride(companyId:string,key:string) {
    if(!Object.prototype.hasOwnProperty.call(OPTION_LABELS,key)) throw new BadRequestException('Option inconnue.');
    await this.prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`entitlements:${companyId}`}))`;
      const sub=await tx.subscription.findUnique({where:{companyId}});
      if(!sub) throw new NotFoundException('Abonnement introuvable.');
      const overrides={...((sub as any).featureOverrides||{})};delete overrides[key];
      await tx.subscription.update({where:{companyId},data:{featureOverrides:overrides} as any});
    });
    return this.get(companyId);
  }

  private async initialUsage(companyId:string,key:string,start:Date,end:Date):Promise<number> {
    const createdAt={gte:start,lt:end};
    if(key==='maxLoansAdvances') {
      const where={employee:{companyId},createdAt};
      const [loans,advances]=await Promise.all([this.prisma.loan.count({where}),this.prisma.advance.count({where})]);
      return loans+advances;
    }
    const models:Record<string,string>={maxPermissionTickets:'permissionTicket',maxAbsenceRequests:'absenceRequest',maxLeaveRequests:'leave',maxJobOffers:'jobOffer'};
    const model=models[key];
    return model ? (this.prisma as any)[model].count({where:{companyId,createdAt}}):0;
  }

  /** Réservation atomique : deux requêtes concurrentes ne consomment jamais le dernier crédit deux fois. */
  async reserve(companyId:string,key:string,limit:number,role:string,amount=1) {
    if(limit===-1) return async()=>{};
    const {period,start,end}=quotaMonth();
    const existing=await (this.prisma as any).subscriptionUsage.findUnique({where:{companyId_key_period:{companyId,key,period}}});
    const initial=existing ? 0 : await this.initialUsage(companyId,key,start,end);
    if(!Number.isInteger(amount)||amount<1) throw new BadRequestException('Quantité invalide.');
    if(limit<=0||(!existing&&initial+amount>limit)) this.quotaError(key,limit,role);
    const rows=await this.prisma.$queryRaw<any[]>`
      INSERT INTO "subscription_usage" ("companyId","key","period","used","updatedAt")
      VALUES (${companyId}::uuid,${key},${period},${initial+amount},NOW())
      ON CONFLICT ("companyId","key","period") DO UPDATE
      SET "used"="subscription_usage"."used"+${amount},"updatedAt"=NOW()
      WHERE "subscription_usage"."used"+${amount} <= ${limit}
      RETURNING "used"`;
    if(!rows.length) this.quotaError(key,limit,role);
    let refunded=false;
    return async()=>{if(refunded)return;refunded=true;
      await this.prisma.$executeRaw`UPDATE "subscription_usage" SET "used"=GREATEST(0,"used"-${amount}),"updatedAt"=NOW() WHERE "companyId"=${companyId}::uuid AND "key"=${key} AND "period"=${period}`;
    };
  }

  private quotaError(key:string,limit:number,role:string):never {
    throw new ForbiddenException({statusCode:403,error:'SUBSCRIPTION_BLOCKED',reason:'MONTHLY_QUOTA_REACHED',
      audience:['ADMIN','HR_MANAGER'].includes(role)?'ADMIN':'EMPLOYEE',
      message:`Votre limite de ${limit} ${(OPTION_LABELS as any)[key]||'opérations'} est atteinte. Votre administrateur peut demander une option supplémentaire.`});
  }
}
