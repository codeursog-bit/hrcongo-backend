import { isRenewalRequest, isSubscriptionRestricted, planAllowsRequest } from './subscription-access';
import { SubscriptionAccessInterceptor } from './subscription-access.interceptor';
import { PLANS } from './config/plans.config';

describe('Expiration abonnement', () => {
  const now = new Date('2026-11-19T12:00:00Z').getTime();
  const future = new Date(now + 1000), past = new Date(now - 1000);
  it('bloque à échéance, même avant le cron et après une rétrogradation FREE', () => {
    for (const s of [null, {plan:'PRO',status:'ACTIVE',currentPeriodEnd:past},
      {plan:'PRO',status:'TRIALING',trialEndsAt:past}, {plan:'FREE',status:'ACTIVE',downgradedAt:past},
      {plan:'FREE',status:'PAUSED'}, {plan:'PRO',status:'PAST_DUE'}, {plan:'PRO',status:'ACTIVE',currentPeriodEnd:new Date(now)}]) {
      expect(isSubscriptionRestricted(s,now)).toBe(true);
    }
    expect(isSubscriptionRestricted({plan:'PRO',status:'ACTIVE',currentPeriodEnd:future},now)).toBe(false);
    expect(isSubscriptionRestricted({plan:'PRO',status:'TRIALING',trialEndsAt:future},now)).toBe(false);
    expect(isSubscriptionRestricted({plan:'FREE',status:'ACTIVE'},now)).toBe(false);
  });
  it('garde le paiement et le dashboard, refuse mutations et préfixes ressemblants', () => {
    expect(isRenewalRequest('POST','/subscriptions/upgrade/moteki')).toBe(true);
    expect(isRenewalRequest('POST','/subscriptions/chariow/check-sale/payment')).toBe(true);
    expect(isRenewalRequest('GET','/api/dashboard/summary?month=11')).toBe(true);
    expect(isRenewalRequest('POST','/tasks')).toBe(false);
    expect(isRenewalRequest('PATCH','/employees/one')).toBe(false);
    expect(isRenewalRequest('GET','/employees')).toBe(false);
    expect(isRenewalRequest('POST','/subscriptions/cancel')).toBe(false);
    expect(isRenewalRequest('POST','/subscriptions-unsafe/upgrade')).toBe(false);
  });
  it('ne lance jamais le contrôleur métier d’un compte expiré', async () => {
    const prisma = { company:{findUnique:async()=>({managedByCabinet:false})}, subscription:{findUnique:async()=>({plan:'FREE',status:'ACTIVE',downgradedAt:past})} };
    const interceptor = new SubscriptionAccessInterceptor(prisma as any,{} as any);
    const handle = jest.fn();
    const ctx = (method:string,url:string,role='ADMIN') => ({getType:()=> 'http',switchToHttp:()=>({getRequest:()=>({method,url,user:{companyId:'company',role}})})}) as any;
    await expect(interceptor.intercept(ctx('DELETE','/employees/one'),{handle})).rejects.toMatchObject({response:{error:'SUBSCRIPTION_BLOCKED',reason:'SUBSCRIPTION_EXPIRED'}});
    expect(handle).not.toHaveBeenCalled();
    await interceptor.intercept(ctx('POST','/subscriptions/upgrade'),{handle});
    expect(handle).toHaveBeenCalledTimes(1);
    await interceptor.intercept(ctx('GET','/admin/companies','SUPER_ADMIN'),{handle});
    expect(handle).toHaveBeenCalledTimes(2);
  });
  it('publie les trois paliers convenus sans prix codés en dur', () => {
    expect(PLANS.BASIC.limits.maxEmployees).toBe(50);
    expect(PLANS.PRO.limits).toMatchObject({maxEmployees:100,maxUsers:4,maxJobOffers:2,hasTraining:false,hasLoansAndAdvances:true});
    expect(PLANS.ENTERPRISE.limits).toMatchObject({maxEmployees:-1,maxJobOffers:-1,hasTraining:true});
  });
  it('réserve les modules et les déclarations aux offres correspondantes', () => {
    expect(planAllowsRequest('BASIC','/loans')).toBe(true);
    expect(planAllowsRequest('BASIC','/chat/messages')).toBe(false);
    expect(planAllowsRequest('PRO','/contracts')).toBe(true);
    expect(planAllowsRequest('PRO','/cnss-declaration')).toBe(true);
    expect(planAllowsRequest('PRO','/das-declaration/export')).toBe(true);
    expect(planAllowsRequest('PRO','/training')).toBe(false);
    expect(planAllowsRequest('ENTERPRISE','/training')).toBe(true);
  });
});
