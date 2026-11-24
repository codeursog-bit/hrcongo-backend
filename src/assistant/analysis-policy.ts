import { atCongoTime, congoDateString } from '../common/utils/congo-time';
export const DEFAULT_LIMITS = {
  TRIAL: { maxMode: 'INTEGRE', monthlyAnalyses: 20 },
  FREE: { maxMode: 'INTEGRE', monthlyAnalyses: 3 },
  STARTER: { maxMode:'INTEGRE',monthlyAnalyses:10 },
  BASIC: { maxMode: 'INTEGRE', monthlyAnalyses: 30 },
  PRO: { maxMode: 'INTEGRE', monthlyAnalyses: 150 },
  ENTERPRISE: { maxMode: 'INTEGRE', monthlyAnalyses: 1000 },
};
function monthAt(anchor: Date, offset: number) {
  const d = new Date(anchor);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
export function analysisWindow(
  subscription: {
    plan: string;
    status: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    trialEndsAt: Date | null;
  } | null,
  now = new Date(),
) {
  if (
    subscription?.status === 'TRIALING' &&
    subscription.trialEndsAt &&
    subscription.trialEndsAt > now &&
    subscription.currentPeriodStart <= now
  )
    return {
      plan: 'TRIAL',
      start: subscription.currentPeriodStart,
      end: subscription.trialEndsAt,
    };
  if (
    subscription?.status === 'ACTIVE' &&
    subscription.currentPeriodStart <= now &&
    subscription.currentPeriodEnd > now &&
    subscription.plan !== 'FREE'
  ) {
    const anchor = subscription.currentPeriodStart;
    let n =
      (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      now.getUTCMonth() -
      anchor.getUTCMonth();
    while (n > 0 && monthAt(anchor, n) > now) n--;
    const start = monthAt(anchor, n),
      next = monthAt(anchor, n + 1);
    return {
      plan: subscription.plan,
      start,
      end:
        next < subscription.currentPeriodEnd
          ? next
          : subscription.currentPeriodEnd,
    };
  }
  const day = congoDateString(now),
    start = atCongoTime(day.slice(0, 7) + '-01', 0),
    next = new Date(start.getTime() + 3600000);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { plan: 'FREE', start, end: new Date(next.getTime() - 3600000) };
}
