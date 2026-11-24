import type { ToolCard, AnalysisTool } from './analysis-tools';
import { externalReady, selectSentences } from './model-provider';

/** Model chooses approved clauses only. Values and period are rendered locally.
 * No free text, names, IDs, salary values, departments or tool objects leave Konza.
 * This deliberately constrained first connector is not an autonomous agent.
 */
export async function advancedAnswer(
  settings: any,
  tool: AnalysisTool,
  card: ToolCard,
) {
  if (!externalReady(settings)) return null;
  const clauses: Record<string, string> = {
    overview: `Voici les résultats vérifiés pour ${card.period}.`,
    consult:
      'Consultez le détail dans la carte ci-dessous avant toute décision.',
  };
  if (tool === 'explain_payroll_variation') {
    const delta = card.metrics.find((m) => m.label === 'Écart brut');
    if (delta && Number.isFinite(delta.value)) {
      // Even the sign is not sent externally, including for small teams.
      clauses.payroll_review =
        delta.value > 0
          ? 'La masse salariale brute a augmenté par rapport au mois précédent. Consultez les composantes vérifiées de cet écart dans la carte.'
          : delta.value < 0
            ? 'La masse salariale brute a diminué par rapport au mois précédent. Consultez les composantes vérifiées de cet écart dans la carte.'
            : 'La masse salariale brute est identique à celle du mois précédent.';
    }
  }
  if (tool === 'leave_returns')
    clauses.planning =
      'Un retour prévu n’est pas une présence confirmée. Vérifiez le pointage avant de conclure à une absence.';
  if (tool === 'leave_departures')
    clauses.planning =
      'Utilisez les départs approuvés pour préparer la continuité du service. Les demandes en attente ne figurent pas dans ce résultat.';
  if (tool === 'leave_allowance')
    clauses.engine =
      'L’allocation affichée provient du moteur de congé de Konza. Vérifiez le dossier et la période avant de préparer le versement.';
  if (tool === 'explain_employee_pay')
    clauses.payroll_review =
      'Comparez les éléments de paie et les retenues de la carte avec le bulletin de la période.';
  if (tool === 'headcount_summary')
    clauses.workforce =
      'Consultez les entrées et sorties du rapport pour comprendre les mouvements d’effectif sur cette période.';
  // All candidates refer to statements established by the selected server tool.
  try {
    const ids = await selectSentences(Object.keys(clauses));
    return ids.map((id) => clauses[id]).join('\n\n');
  } catch {
    return null;
  } // No provider body/error is logged or exposed.
}
