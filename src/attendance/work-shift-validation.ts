import { BadRequestException } from '@nestjs/common';

export function buildShiftUpdate(input: any, previous?: any) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Planning invalide.');
  const editable = ['name', 'startHour', 'startMinute', 'endHour', 'endMinute', 'isNightShift', 'nightPremiumRate', 'color', 'isDefault'];
  // These two derived fields were sent by older clients. Always recompute them.
  const accepted = [...editable, 'durationHours', 'crossesMidnight'];
  if (Object.keys(input).some(key => !accepted.includes(key))) throw new BadRequestException('Champ de planning non autorisé.');
  const data = Object.fromEntries(editable.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
  const value = { startMinute: 0, endMinute: 0, ...previous, ...data };
  for (const [key, max] of [['startHour', 23], ['endHour', 23], ['startMinute', 59], ['endMinute', 59]] as const) {
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > max) throw new BadRequestException('Heure de planning invalide.');
  }
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new BadRequestException('Nom de planning invalide.');
  for (const key of ['isNightShift', 'isDefault']) {
    if (data[key] !== undefined && typeof data[key] !== 'boolean') throw new BadRequestException('Option de planning invalide.');
  }
  if (data.nightPremiumRate !== undefined && (typeof data.nightPremiumRate !== 'number' || !Number.isFinite(data.nightPremiumRate) || data.nightPremiumRate < 0 || data.nightPremiumRate > 100)) throw new BadRequestException('Majoration de nuit invalide.');
  if (data.color !== undefined && (typeof data.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(data.color))) throw new BadRequestException('Couleur invalide.');
  const start = value.startHour * 60 + value.startMinute;
  let end = value.endHour * 60 + value.endMinute;
  const crossesMidnight = end <= start;
  if (crossesMidnight) end += 1440;
  return { ...data, name: value.name.trim(), startHour: value.startHour, startMinute: value.startMinute,
    endHour: value.endHour, endMinute: value.endMinute, crossesMidnight, durationHours: Number(((end - start) / 60).toFixed(2)) };
}
