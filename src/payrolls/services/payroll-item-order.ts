export function payrollItemRank(item: { code: string; label: string; type: string }): number {
  if (item.code === 'SAL_BASE') return 0;
  if (item.code === 'ABS_DEDUCT') return 1;
  if (item.type !== 'GAIN') return 5;
  if (item.code === 'CONGE_SUPP') return 4.1;
  if (item.code === 'INDEM_CONGE' || /cong[eé]/i.test(item.label)) return 4;
  if (/anciennet[eé]/i.test(item.label) || /SENIOR|ANCIEN/i.test(item.code)) return 2;
  return 3;
}
