import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isRenewalRequest, isSubscriptionRestricted } from './subscription-access';
import { requestEntitlement, resolveLimits } from './entitlements.config';
import { EntitlementsService } from './entitlements.service';
import { catchError } from 'rxjs/operators';

@Injectable()
export class SubscriptionAccessInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService, private readonly entitlements:EntitlementsService) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const actor = req.user;
    if (!actor?.companyId || ['SUPER_ADMIN', 'SUPPORT', 'CABINET_ADMIN', 'CABINET_GESTIONNAIRE'].includes(actor.role)) return next.handle();
    if (isRenewalRequest(req.method, req.originalUrl || req.url)) return next.handle();
    const company = await this.prisma.company.findUnique({ where: { id: actor.companyId }, select: { managedByCabinet: true } });
    if (company?.managedByCabinet) return next.handle();
    const subscription = await this.prisma.subscription.findUnique({ where: { companyId: actor.companyId } });
    if (isSubscriptionRestricted(subscription)) {
      throw new ForbiddenException({ statusCode: 403, error: 'SUBSCRIPTION_BLOCKED', reason: 'SUBSCRIPTION_EXPIRED',
        audience: ['ADMIN', 'HR_MANAGER'].includes(actor.role) ? 'ADMIN' : 'EMPLOYEE',
        message: 'Abonnement terminé. Renouvelez votre abonnement ou revenez au tableau de bord.' });
    }
    const access=requestEntitlement(req.method,req.originalUrl||req.url,req.body);
    const limits=resolveLimits(subscription!.plan,(subscription as any).featureOverrides);
    if (access.feature && limits[access.feature]!==true) {
      throw new ForbiddenException({ statusCode: 403, error: 'SUBSCRIPTION_BLOCKED', reason: 'PLAN_FEATURE_UNAVAILABLE',
        audience: ['ADMIN', 'HR_MANAGER'].includes(actor.role) ? 'ADMIN' : 'EMPLOYEE',
        message: 'Ce module ne fait pas partie de votre offre. Consultez les offres disponibles.' });
    }
    let amount=1;
    if(access.quota==='maxPayrollGenerations' && /\/generate(-stream)?(?:\?|$)/.test(req.originalUrl||req.url)) {
      amount=Array.isArray(req.body?.employeeIds)&&req.body.employeeIds.length?new Set(req.body.employeeIds).size:await this.prisma.employee.count({where:{companyId:actor.companyId,status:'ACTIVE'}});
      amount=Math.max(1,amount);
    }
    const refund=access.quota ? await this.entitlements.reserve(actor.companyId,access.quota,Number(limits[access.quota]??0),actor.role,amount) : null;
    return next.handle().pipe(catchError(async error=>{if(refund)await refund();throw error;}));
  }
}
