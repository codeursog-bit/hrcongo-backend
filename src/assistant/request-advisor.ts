/**
 * Conseiller de décision pour les demandes de congé, d'absence et de permission de sortie.
 *
 * Fonction PURE : ni base, ni réseau, ni modèle d'IA. Le serveur lit les données de l'entreprise,
 * les passe ici sous forme de simples nombres/dates, et obtient un « dossier de décision » :
 * un verdict, des constats codés (code + valeurs) et, si utile, une date alternative.
 *
 * Pourquoi c'est la bonne place pour la logique : le modèle d'IA ne connaît jamais la base. Il ne
 * reçoit que le verdict et les codes (avec des repères E1, D1 et des marqueurs [[n]], comme pour
 * les autres outils de l'assistant) et ne fait que reformuler et dialoguer ; le serveur remet les
 * vrais noms et chiffres. Le verdict ne dépend donc jamais de ce que le modèle « pense ».
 *
 * Règle d'or : un motif urgent ou un droit légal (décès, naissance, maladie, maternité…) n'est
 * jamais repoussé. L'assistant informe sur la couverture du service, il ne bloque pas.
 */

export type RequestKind = 'LEAVE' | 'ABSENCE' | 'PERMISSION';
export type Verdict = 'FAVORABLE' | 'RESERVE' | 'DEFER' | 'URGENT';
export type Severity = 'info' | 'warn' | 'block';

export type FindingCode =
  | 'URGENT_REASON'
  | 'LEGAL_RIGHT'
  | 'SOLE_MEMBER'
  | 'TEAM_COVERAGE'
  | 'PENDING_OVERLAP'
  | 'BALANCE_LOW'
  | 'RECENT_RETURN'
  | 'FREQUENT_ABSENCES'
  | 'UNJUSTIFIED_ABSENCES'
  | 'FREQUENT_PERMISSIONS'
  | 'LONG_PERMISSION'
  | 'CLEAR_PERIOD';

export interface Finding {
  code: FindingCode;
  severity: Severity;
  /** Valeurs numériques du constat ; le serveur les habille en texte (ou en marqueurs pour le modèle). */
  values: Record<string, number>;
}

export interface Alternative {
  start: Date;
  end: Date;
  /** Nombre de collègues absents au plus fort de la période alternative (hors le demandeur). */
  peakAbsent: number;
}

export interface AdvisorRequest {
  kind: RequestKind;
  start: Date; // inclus (jour, ou instant de sortie pour une permission)
  end: Date; // inclus (jour, ou instant de retour prévu pour une permission)
  /** Jours ouvrés demandés (congé/absence). Ignoré pour une permission. */
  days: number;
  /** Motif urgent ou droit légal : jamais repoussé. */
  urgent?: boolean;
  legalRight?: boolean;
  leaveType?: string; // ANNUAL, ANNUAL_ANTICIPATED, …
}

export interface AdvisorContext {
  /** Effectif ACTIF du département du demandeur, demandeur inclus. */
  deptSize: number;
  /** Collègues du même département déjà absents (congés/absences APPROUVÉS), hors demandeur. */
  colleagueAbsences: { start: Date; end: Date }[];
  /** Demandes en attente du même département qui se chevauchent (information seulement). */
  pendingOverlaps: number;
  /** Permissions de sortie approuvées de collègues du département (intervalles horaires). */
  colleaguePermissions?: { start: Date; end: Date }[];
  /** Solde de congé restant (jours), pour un congé. */
  balanceRemaining?: number | null;
  /** Nombre de jours depuis le dernier retour de congé, null si inconnu/jamais. */
  daysSinceLastReturn?: number | null;
  history: {
    absenceRequests90d: number;
    absenceDays90d: number;
    unjustifiedDays90d: number;
    permissions30d: number;
  };
  isWorkingDay: (d: Date) => boolean;
}

export interface AdvisorPolicy {
  /** Part maximale d'un département absente en même temps (défaut 25 %, au moins 1 personne). */
  maxAbsentRatio: number;
  recentReturnDays: number;
  frequentAbsenceRequests: number;
  frequentAbsenceDays: number;
  unjustifiedDays: number;
  frequentPermissions: number;
  longPermissionHours: number;
  /** Fenêtre de recherche d'une date alternative (jours calendaires). */
  alternativeSearchDays: number;
}

export const DEFAULT_POLICY: AdvisorPolicy = {
  maxAbsentRatio: 0.25,
  recentReturnDays: 45,
  frequentAbsenceRequests: 3,
  frequentAbsenceDays: 6,
  unjustifiedDays: 2,
  frequentPermissions: 4,
  longPermissionHours: 4,
  alternativeSearchDays: 60,
};

export interface AdvisorResult {
  verdict: Verdict;
  findings: Finding[];
  alternative: Alternative | null;
  /** Plafond d'absents simultanés calculé pour le département (hors demandeur inclus). */
  cap: number;
}

const DAY = 86400000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Jours ouvrés de [start, end] (bornes incluses). */
function workingDaysBetween(start: Date, end: Date, isWorking: (d: Date) => boolean): Date[] {
  const out: Date[] = [];
  for (let d = new Date(start); d.getTime() <= end.getTime(); d = addDays(d, 1))
    if (isWorking(d)) out.push(d);
  return out;
}

/** Pic de collègues absents sur les jours donnés. */
function peakAbsent(days: Date[], absences: { start: Date; end: Date }[]): number {
  let peak = 0;
  for (const d of days) {
    const t = d.getTime();
    let n = 0;
    for (const a of absences) if (a.start.getTime() <= t + DAY - 1 && a.end.getTime() >= t) n++;
    if (n > peak) peak = n;
  }
  return peak;
}

/** Plafond d'absents simultanés (demandeur compris) pour un département. */
export function absenceCap(deptSize: number, ratio: number): number {
  return Math.max(1, Math.floor(deptSize * ratio));
}

export function adviseRequest(
  req: AdvisorRequest,
  ctx: AdvisorContext,
  policy: AdvisorPolicy = DEFAULT_POLICY,
): AdvisorResult {
  const findings: Finding[] = [];
  const cap = absenceCap(ctx.deptSize, policy.maxAbsentRatio);
  const protectedReason = !!(req.urgent || req.legalRight);

  if (req.urgent) findings.push({ code: 'URGENT_REASON', severity: 'info', values: {} });
  if (req.legalRight) findings.push({ code: 'LEGAL_RIGHT', severity: 'info', values: {} });

  // ---- Couverture du service ------------------------------------------------------------------
  let coverageBlocked = false;
  if (ctx.deptSize <= 1) {
    findings.push({
      code: 'SOLE_MEMBER',
      severity: protectedReason ? 'info' : 'warn',
      values: {},
    });
  } else if (req.kind === 'PERMISSION') {
    const overlapping = (ctx.colleaguePermissions || []).filter(
      (p) => p.start < req.end && p.end > req.start,
    ).length;
    const sameDayAbsent = peakAbsent([req.start], ctx.colleagueAbsences);
    const away = overlapping + sameDayAbsent + 1;
    if (away > cap) {
      coverageBlocked = true;
      findings.push({
        code: 'TEAM_COVERAGE',
        severity: protectedReason ? 'warn' : 'block',
        values: { absent: away - 1, size: ctx.deptSize, cap },
      });
    }
  } else {
    const days = workingDaysBetween(req.start, req.end, ctx.isWorkingDay);
    const peak = peakAbsent(days, ctx.colleagueAbsences);
    if (peak + 1 > cap) {
      coverageBlocked = true;
      findings.push({
        code: 'TEAM_COVERAGE',
        severity: protectedReason ? 'warn' : 'block',
        values: { absent: peak, size: ctx.deptSize, cap },
      });
    }
  }
  if (ctx.pendingOverlaps > 0)
    findings.push({
      code: 'PENDING_OVERLAP',
      severity: 'info',
      values: { count: ctx.pendingOverlaps },
    });

  // ---- Congé : solde et retour récent ---------------------------------------------------------
  if (req.kind === 'LEAVE') {
    if (
      req.leaveType === 'ANNUAL' &&
      typeof ctx.balanceRemaining === 'number' &&
      req.days > ctx.balanceRemaining
    )
      findings.push({
        code: 'BALANCE_LOW',
        severity: 'warn',
        values: { requested: round1(req.days), remaining: round1(ctx.balanceRemaining) },
      });
    if (
      !protectedReason &&
      typeof ctx.daysSinceLastReturn === 'number' &&
      ctx.daysSinceLastReturn >= 0 &&
      ctx.daysSinceLastReturn < policy.recentReturnDays
    )
      findings.push({
        code: 'RECENT_RETURN',
        severity: 'warn',
        values: { daysSince: ctx.daysSinceLastReturn },
      });
  }

  // ---- Historique (jamais utilisé contre un motif urgent ou un droit légal) -------------------
  if (!protectedReason) {
    const h = ctx.history;
    if (
      req.kind !== 'LEAVE' &&
      (h.absenceRequests90d >= policy.frequentAbsenceRequests ||
        h.absenceDays90d >= policy.frequentAbsenceDays)
    )
      findings.push({
        code: 'FREQUENT_ABSENCES',
        severity: 'warn',
        values: { requests: h.absenceRequests90d, days: round1(h.absenceDays90d), windowDays: 90 },
      });
    if (req.kind !== 'LEAVE' && h.unjustifiedDays90d >= policy.unjustifiedDays)
      findings.push({
        code: 'UNJUSTIFIED_ABSENCES',
        severity: 'warn',
        values: { days: round1(h.unjustifiedDays90d), windowDays: 90 },
      });
    if (req.kind === 'PERMISSION') {
      if (h.permissions30d >= policy.frequentPermissions)
        findings.push({
          code: 'FREQUENT_PERMISSIONS',
          severity: 'warn',
          values: { count: h.permissions30d, windowDays: 30 },
        });
      const hours = (req.end.getTime() - req.start.getTime()) / 3600000;
      if (hours > policy.longPermissionHours)
        findings.push({
          code: 'LONG_PERMISSION',
          severity: 'warn',
          values: { hours: round1(hours), limit: policy.longPermissionHours },
        });
    }
  }

  // ---- Date alternative (congés et absences non urgents, couverture insuffisante) -------------
  let alternative: Alternative | null = null;
  if (coverageBlocked && !protectedReason && req.kind !== 'PERMISSION' && ctx.deptSize > 1) {
    const span = Math.max(0, Math.round((req.end.getTime() - req.start.getTime()) / DAY));
    for (let shift = 1; shift <= policy.alternativeSearchDays; shift++) {
      const s = addDays(req.start, shift);
      if (!ctx.isWorkingDay(s)) continue;
      const e = addDays(s, span);
      const days = workingDaysBetween(s, e, ctx.isWorkingDay);
      if (!days.length) continue;
      const peak = peakAbsent(days, ctx.colleagueAbsences);
      if (peak + 1 <= cap) {
        alternative = { start: s, end: e, peakAbsent: peak };
        break;
      }
    }
  }

  // ---- Verdict ---------------------------------------------------------------------------------
  let verdict: Verdict;
  if (protectedReason) verdict = 'URGENT';
  else if (findings.some((f) => f.severity === 'block')) verdict = 'DEFER';
  else if (findings.some((f) => f.severity === 'warn')) verdict = 'RESERVE';
  else verdict = 'FAVORABLE';

  if (!findings.some((f) => f.severity !== 'info') && !protectedReason)
    findings.push({ code: 'CLEAR_PERIOD', severity: 'info', values: { size: ctx.deptSize, cap } });

  return { verdict, findings, alternative, cap };
}