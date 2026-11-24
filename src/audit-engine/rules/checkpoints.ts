// ============================================================================
// 📁 src/audit-engine/rules/checkpoints.ts
// Les contrôles « humains » : le logiciel calcule l'échéance et relance, la
// personne atteste avec sa preuve. Échéances issues d'une checklist de blog :
// À FAIRE VALIDER (CGI art. 461 bis ; Code de sécurité sociale art. 22).
// ============================================================================
export interface CheckpointDef {
  code: string;
  label: string;
  evidenceHint: string;
  legalRef: string;
  /** Date limite pour la paie du mois `month`/`year`, ou null si rien n'est dû ce mois-là. */
  dueDate: (month: number, year: number, headcount: number) => Date | null;
}

const utc = (y: number, m1: number, d: number) => new Date(Date.UTC(y, m1 - 1, d));

/** Le 15 du mois suivant (le 20 si ce mois suivant est août). */
const nextMonth15 = (month: number, year: number, augustDay = 15): Date => {
  const m = month === 12 ? 1 : month + 1;
  const y = month === 12 ? year + 1 : year;
  return utc(y, m, m === 8 ? augustDay : 15);
};

export const CHECKPOINTS: CheckpointDef[] = [
  {
    code: 'DGI_DECLARATION',
    label: 'Déclaration ITS / TOL / TUS déposée (DGI, e-Tax)',
    evidenceHint: "N° d'accusé de dépôt e-Tax",
    legalRef: 'CGI, art. 461 bis (échéance à confirmer)',
    dueDate: (m, y) => nextMonth15(m, y, 20),
  },
  {
    code: 'CNSS_BORDEREAU',
    label: 'Bordereau CNSS déposé et réglé',
    evidenceHint: 'N° de reçu CNSS',
    legalRef: 'Code de sécurité sociale, art. 22 (échéance à confirmer)',
    // > 20 travailleurs : chaque mois ; sinon : une fois par trimestre (paie de mars, juin, septembre, décembre).
    dueDate: (m, y, headcount) => (headcount > 20 || m % 3 === 0 ? nextMonth15(m, y) : null),
  },
];

export const CHECKPOINT_BY_CODE: Record<string, CheckpointDef> = Object.fromEntries(CHECKPOINTS.map((c) => [c.code, c]));