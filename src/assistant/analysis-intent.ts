import { analysisIntent } from './assistant-analysis.service';
import { normalizeHelp } from './help';
import type { AnalysisTool, ToolIntent } from './analysis-tools';
export function inferToolIntent(message: string): ToolIntent | null {
  const headcount = analysisIntent(message);
  if (headcount) return headcount;
  const q = normalizeHelp(message),
    suffix = q.match(
      / (ce mois ci|ce mois|le mois dernier|le mois precedent|en (?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre) 20\d{2}|20\d{2} (?:0?[1-9]|1[0-2]))$/,
    );
  const core = suffix ? q.slice(0, -suffix[0].length) : q,
    period = analysisIntent('effectif ' + (suffix?.[1] || 'ce mois'));
  if (!period) return null;
  const choices: [RegExp, AnalysisTool][] = [
    [
      /^(?:pourquoi (?:ma|la) masse salariale (?:a augmente|a trop augmente|a change|augmente)|evolution de la masse salariale|comparaison de la paie)$/,
      'explain_payroll_variation',
    ],
    [
      /^(?:qui a le plus gagne|quels employes sont les mieux payes|top des salaires|remunerations les plus elevees)$/,
      'top_paid_employees',
    ],
    [
      /^(?:qui a le plus de permissions|classement des permissions|permissions approuvees)$/,
      'permissions_ranking',
    ],
    [/^(?:qui part en conge|departs en conge)$/, 'leave_departures'],
    [/^(?:qui revient de conge|retours de conge)$/, 'leave_returns'],
    [
      /^(?:planifie les conges|planning des conges propose|propose un planning de conges|suggere un planning de conges|qui devrait partir en conge)$/,
      'leave_planning',
    ],
    [
      /^(?:resume des presences|bilan des presences|presences du mois|combien de presences)$/,
      'attendance_summary',
    ],
    [
      /^(?:qui a le plus d absences|classement des absences|absences les plus nombreuses)$/,
      'absences_ranking',
    ],
    [
      /^(?:qui est le plus en retard|qui a le plus de retards|classement des retards|retards les plus nombreux)$/,
      'lateness_ranking',
    ],
  ];
  const tool = choices.find(([match]) => match.test(core))?.[1];
  return tool ? { ...period, tool } : null;
}