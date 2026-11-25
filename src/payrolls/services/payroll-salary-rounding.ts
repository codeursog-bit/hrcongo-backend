/** Arrondit le net après les retenues ajoutées hors calculateur (saisie manuelle). */
export function alignSalaryRounding(
  calc: { netSalary: number; totalDeductions?: number; salaryRoundingAmount?: number },
  enabled: boolean,
  laterDeductions: number,
) {
  if (!enabled || !Number.isFinite(laterDeductions)) return;
  const beforeRounding = calc.netSalary - (calc.salaryRoundingAmount ?? 0);
  const payableBeforeRounding = beforeRounding - laterDeductions;
  const adjustment = payableBeforeRounding > 0
    ? Math.floor(payableBeforeRounding / 50) * 50 - payableBeforeRounding
    : 0;
  if (calc.totalDeductions !== undefined) {
    calc.totalDeductions += (calc.salaryRoundingAmount ?? 0) - adjustment;
  }
  calc.salaryRoundingAmount = adjustment;
  calc.netSalary = beforeRounding + adjustment;
}
