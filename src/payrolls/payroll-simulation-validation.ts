import { BadRequestException } from '@nestjs/common';

export function validateSimulationInput(month: number, year: number, overrides: any = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new BadRequestException('Paramètres de simulation invalides.');
  if (!Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new BadRequestException('Période de paie invalide.');
  }
  const bounds: Record<string, [number, number]> = {
    workedDays: [0, 31], absentDays: [0, 31], workDays: [1, 31],
    baseSalary: [0, Number.MAX_SAFE_INTEGER],
    overtimeHours10: [0, 744], overtimeHours25: [0, 744],
    overtimeHours50: [0, 744], overtimeHours100: [0, 744],
    advanceAmount: [0, Number.MAX_SAFE_INTEGER], loanDeduction: [0, Number.MAX_SAFE_INTEGER],
  };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const value = overrides[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)) {
      throw new BadRequestException(`Valeur invalide pour ${key}.`);
    }
  }
  for (const key of ['manualBonuses', 'manualDeductions']) {
    validateSimulationItems(overrides[key], key);
  }
}

export function validateSimulationItems(items: any, key: string) {
  if (items === undefined) return;
  if (!Array.isArray(items) || items.length > 200 || items.some(item => !item ||
      typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount < 0 ||
      ['isTaxable', 'isCnss'].some(flag => item[flag] !== undefined && typeof item[flag] !== 'boolean') ||
      (item.fiscalType !== undefined && !['TAXABLE_CNSS', 'TAXABLE_NO_CNSS', 'NON_TAXABLE'].includes(item.fiscalType)))) {
    throw new BadRequestException(`Valeur invalide pour ${key}.`);
  }
}
