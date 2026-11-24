import { requestEntitlement, resolveLimits } from './entitlements.config';
/** Expiration indépendante du cron : une rétrogradation FREE ne réouvre pas l'accès. */
export function isSubscriptionRestricted(subscription: {
  plan: string; status: string; trialEndsAt?: Date | string | null;
  currentPeriodEnd?: Date | string | null; downgradedAt?: Date | string | null;
} | null, now = Date.now()): boolean {
  if (!subscription) return true;
  if (subscription.downgradedAt) return true;
  if (!['ACTIVE', 'TRIALING'].includes(subscription.status)) return true;
  const end = subscription.status === 'TRIALING'
    ? subscription.trialEndsAt : subscription.plan !== 'FREE' ? subscription.currentPeriodEnd : null;
  return (subscription.status === 'TRIALING' || subscription.plan !== 'FREE') &&
    (!end || !Number.isFinite(new Date(end).getTime()) || new Date(end).getTime() <= now);
}

export function isRenewalRequest(method: string, pathname: string): boolean {
  const path = pathname.split('?')[0].replace(/\/+$/, '').replace(/^\/api(?=\/)/, '');
  if (['/auth/verify', '/auth/refresh', '/auth/logout', '/auth/me', '/auth/switch-company', '/auth/my-companies'].includes(path)) return true;
  if (path.startsWith('/subscriptions/') && path !== '/subscriptions/cancel') return true;
  if (method !== 'GET' && method !== 'HEAD') return false;
  // Lecture nécessaire à la coquille et au tableau de bord ; aucune écriture.
  return /^\/dashboard\/(summary|charts|manager|pending-requests-count)$/.test(path) ||
    /^\/(notifications(\/.*)?|approvals\/(me|inbox\/all)|finance\/status|reviews\/pending-count)$/.test(path) ||
    /^\/companies\/(mine|[^/]+)$/.test(path) ||
    /^\/(day-overview|day-events|anniversaries|announcements|tasks)(\/|$)/.test(path) ||
    /^\/employees\/me$/.test(path) ||
    /^\/leaves\/(me(\/.*)?|balance\/[^/]+)$/.test(path) ||
    /^\/attendance\/(today|employee\/[^/]+)$/.test(path) ||
    /^\/loans\/(me|advances\/me)$/.test(path) || path === '/payrolls';
}

export function planAllowsRequest(plan: string, pathname: string): boolean {
  const rule=requestEntitlement('GET',pathname);
  return !rule.feature || resolveLimits(plan,null)[rule.feature]===true;
}
