// ============================================================================
// 📁 src/audit-trail/audit-trail.policy.ts
// Politique "ce qu'on a le droit d'écrire dans le journal d'audit".
//
// Principe : REFUS PAR DÉFAUT.
//   - Seuls les champs listés dans AUDIT_TRACKED_FIELDS ont leur valeur
//     enregistrée (avant → après).
//   - Tout autre champ modifié : on garde juste son NOM ("le champ X a changé"),
//     jamais sa valeur.
//   - Les champs sensibles (santé, identité, contact, secrets) ne sont JAMAIS
//     enregistrés en valeur, même si quelqu'un les ajoute à la liste par erreur.
// ============================================================================
import { Prisma } from '@prisma/client';

export type AuditSeverityLevel = 'INFO' | 'WARN' | 'CRITICAL';

/** Champs dont la valeur avant/après est conservée, par entité. */
export const AUDIT_TRACKED_FIELDS: Record<string, readonly string[]> = {
  EMPLOYEE_CONTRACT: [
    'contractType',
    'status',
    'startDate',
    'endDate',
    'duration',
    'position',
    'baseSalary',
    'departmentId',
    'trialPeriodDays',
    'trialEndDate',
    'signedAt',
    'signedByEmp',
    'chainId',
    'rank',
    'kind',
    'previousContractId',
    'cddMotif',
    'renewalReason',
  ],
  PAYROLL: [
    'status', 'validated', 'paid', 'paymentReference', 'month', 'year',
    'baseSalary', 'grossSalary', 'netSalary', 'totalDeductions', 'cnssSalarial', 'its',
  ],
  AUDIT_FINDING: ['status', 'severity', 'blocking', 'ruleCode', 'resolutionNote'],
  AUDIT_CHECKPOINT: ['status', 'evidenceRef', 'note'],
  EMPLOYEE: [
    'position',
    'baseSalary',
    'contractType',
    'contractEndDate',
    'hireDate',
    'status',
    'departmentId',
    'tolZone',
    'isSubjectToCnss',
    'isSubjectToIrpp',
    'isSubjectToTus',
    'trialStatus',
    'terminationDate',
    'terminationReason',
    'maritalStatus',
    'numberOfChildren',
  ],
};

/**
 * Filet de sécurité : tout nom de champ qui ressemble à ceci n'est JAMAIS
 * enregistré en valeur (santé, identité, contact, secrets, banque).
 */
const NEVER_STORE_VALUE =
  /(password|secret|token|backup|iban|rib|bank|pathology|blood|nationalid|licen[sc]e|phone|address|email|emergency|father|mother|birth|signature)/i;

export interface BuiltChanges {
  values: Record<string, { from: unknown; to: unknown }>;
  maskedFields: string[];
}

/** Valeur "stable" comparable et sérialisable en JSON (Date, Decimal, BigInt…). */
export function normalizeValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (Prisma.Decimal.isDecimal(v)) return (v as Prisma.Decimal).toString();
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') return JSON.parse(JSON.stringify(v));
  return v;
}

/**
 * Compare before/after et ne garde que ce qui a réellement changé.
 * before = null → création ; after = null → suppression.
 */
export function buildChanges(
  entity: string,
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null,
): BuiltChanges {
  const tracked = new Set(AUDIT_TRACKED_FIELDS[entity] ?? []);
  const b = before ?? {};
  const a = after ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);

  const values: BuiltChanges['values'] = {};
  const maskedFields: string[] = [];

  for (const key of keys) {
    const from = normalizeValue(b[key]);
    const to = normalizeValue(a[key]);
    if (JSON.stringify(from) === JSON.stringify(to)) continue; // inchangé

    if (tracked.has(key) && !NEVER_STORE_VALUE.test(key)) {
      values[key] = { from, to };
    } else {
      maskedFields.push(key); // on sait QUE ça a changé, pas la valeur
    }
  }
  return { values, maskedFields: maskedFields.sort() };
}

/** Ne garde que les champs suivis d'une ligne Prisma (évite le bruit « id, createdAt… »). */
export function pickTracked(
  entity: string,
  row: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const k of AUDIT_TRACKED_FIELDS[entity] ?? []) {
    if (k in row) out[k] = row[k];
  }
  return out;
}

/** JSON canonique (clés triées, undefined retiré) → hash reproductible. */
export function canonicalJson(value: unknown): string {
  const walk = (v: any): any => {
    if (v === undefined) return undefined;
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => walk(x) ?? null);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const w = walk(v[k]);
      if (w !== undefined) out[k] = w;
    }
    return out;
  };
  return JSON.stringify(walk(value));
}