import {
  asArray, asBody, asDate, asNumber, asText, asUuid, asUuidArray, isUuid,
} from './performance-validation.util';

const UUID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

describe('performance-validation.util (anti-injection / anti-bourrage)', () => {
  it('accepte un UUID, refuse tout le reste — y compris les objets Prisma', () => {
    expect(asUuid(UUID)).toBe(UUID);
    expect(isUuid({ not: UUID })).toBe(false);
    expect(() => asUuid({ not: UUID })).toThrow();
    expect(() => asUuid({ contains: '' })).toThrow();
    expect(() => asUuid([UUID])).toThrow();
    expect(() => asUuid("x' OR '1'='1")).toThrow();
    expect(() => asUuid(undefined)).toThrow();
  });

  it('listes : refuse un objet à la place d\'un tableau, borne la taille', () => {
    expect(asUuidArray(undefined, 'ids')).toEqual([]);
    expect(asUuidArray([UUID], 'ids')).toEqual([UUID]);
    expect(() => asUuidArray({ in: [UUID] }, 'ids')).toThrow();
    expect(() => asUuidArray([{ not: UUID }], 'ids')).toThrow();
    expect(() => asArray(Array(101).fill(1), 'x', 100)).toThrow();
  });

  it('textes : types stricts, longueur bornée, caractères de contrôle retirés', () => {
    expect(asText(undefined, 't', 10)).toBeUndefined();
    expect(asText('a\u0000b', 't', 10)).toBe('ab');
    expect(() => asText({ a: 1 }, 't', 10)).toThrow();
    expect(() => asText('x'.repeat(11), 't', 10)).toThrow();
  });

  it('nombres et dates dans des fenêtres raisonnables', () => {
    expect(asNumber('42', 'n', 0, 100)).toBe(42);
    expect(() => asNumber('abc', 'n', 0, 100)).toThrow();
    expect(() => asNumber(NaN, 'n', 0, 100)).toThrow();
    expect(() => asNumber(101, 'n', 0, 100)).toThrow();
    expect(() => asDate('0001-01-01', 'd')).toThrow();
    expect(() => asDate('9999-12-31', 'd')).toThrow();
    expect(asDate('2026-10-03', 'd').getFullYear()).toBe(2026);
  });

  it('corps de requête : objet simple uniquement', () => {
    expect(asBody(undefined)).toEqual({});
    expect(() => asBody([1])).toThrow();
    expect(() => asBody('x')).toThrow();
  });
});