/** Arrondir le cumul, jamais le taux mensuel avant multiplication. */
export function accruedLeaveDays(months: number, annualDays: number): number {
  return Math.round((Math.min(12, Math.max(0, months)) * annualDays / 12 + Number.EPSILON) * 100) / 100;
}
