// ============================================================================
// 📁 src/audit-engine/rules/rule-catalog.ts
// Catalogue des contrôles : une source de vérité pour le moteur ET pour l'écran
// (GET /audit-engine/rules). Un code de règle absent d'ici n'est jamais masqué
// côté front : il s'affiche tel quel.
// ============================================================================
export type Severity = 'INFO' | 'WARN' | 'CRITICAL';
export type Category = 'CONTRATS' | 'PAIE' | 'CNSS' | 'FISCAL' | 'DOSSIER' | 'DECLARATIONS';
/** AUTO = le logiciel tranche seul ; SEMI = il détecte, un humain décide ou atteste. */
export type Automation = 'AUTO' | 'SEMI';

export interface RuleDef {
  code: string;
  label: string;
  description: string;
  category: Category;
  severity: Severity;
  /** Bloque la validation de la paie (si AUDIT_GATE_MODE=enforce). */
  blocking: boolean;
  automation: Automation;
  legalRef?: string;
  /** Point de la checklist « audit paie PME » dont la règle est issue. */
  checklistRef?: string;
}

export const RULES: RuleDef[] = [
  { code: 'CONTRACT_COVERAGE', label: 'Contrat couvrant la période', category: 'CONTRATS', severity: 'CRITICAL', blocking: true, automation: 'AUTO',
    description: "Un bulletin est émis pour un employé qui n'a aucun contrat couvrant la période de paie.", checklistRef: 'Bloc 1 — points 1 à 5' },
  { code: 'CDD_TERM_PASSED', label: 'CDD arrivé à terme sans suite', category: 'CONTRATS', severity: 'CRITICAL', blocking: true, automation: 'AUTO',
    description: "Le CDD est arrivé à terme sans renouvellement ni conversion enregistré : la relation est présumée à durée indéterminée. Régularisez dans le module Contrats ou justifiez (administrateur).",
    legalRef: 'Code du travail, art. 32', checklistRef: 'Bloc 1 — point 3' },
  { code: 'CDD_LEGAL_LIMITS', label: 'Limites légales du CDD', category: 'CONTRATS', severity: 'CRITICAL', blocking: false, automation: 'AUTO',
    description: 'Renouvellements, durée du renouvellement, 24 mois au total, 6 mois selon le motif.',
    legalRef: 'Code du travail, art. 32-5', checklistRef: 'Bloc 1 — point 3' },
  { code: 'SMIG_MINIMUM', label: 'Salaire de base au moins égal au SMIG', category: 'PAIE', severity: 'CRITICAL', blocking: true, automation: 'AUTO',
    description: "Le salaire de base est inférieur au SMIG en vigueur. Un temps partiel légitime se justifie par un administrateur.",
    legalRef: 'Décret n°2024-2762 (SMIG)', checklistRef: 'Bloc 2 — point 8' },
  { code: 'CNSS_SALARIAL', label: 'Cotisation CNSS salariale', category: 'CNSS', severity: 'CRITICAL', blocking: true, automation: 'AUTO',
    description: 'Taux de 4 % sur une base plafonnée à 1 200 000 FCFA ; absente, indue ou supérieure au plafond.', checklistRef: 'Bloc 3 — point 13' },
  { code: 'CNSS_EMPLOYER', label: 'Cotisations CNSS patronales', category: 'CNSS', severity: 'CRITICAL', blocking: true, automation: 'AUTO',
    description: 'Pension 8 % (plafond 1 200 000), prestations familiales 10,03 % et accidents du travail 2,25 % (plafond 600 000).', checklistRef: 'Bloc 3 — points 14 à 16' },
  { code: 'TUS_RATES', label: 'TUS patronale', category: 'FISCAL', severity: 'CRITICAL', blocking: true, automation: 'AUTO',
    description: '7,5 % du brut sans plafond : 2,025 % DGI et 5,475 % CNSS.', checklistRef: 'Bloc 4 — point 22' },
  { code: 'TOL_AMOUNT', label: 'TOL selon la zone', category: 'FISCAL', severity: 'CRITICAL', blocking: true, automation: 'AUTO',
    description: "5 000 FCFA en ville, 1 000 FCFA en périphérie, pour les CDI et CDD uniquement. Le montant du bulletin doit correspondre à la zone de l'employé.", checklistRef: 'Bloc 4 — point 23' },
  { code: 'FISCAL_PARTS_RANGE', label: 'Quotient familial', category: 'FISCAL', severity: 'CRITICAL', blocking: true, automation: 'AUTO',
    description: 'Le nombre de parts fiscales doit être compris entre 1 et 6,5.', checklistRef: 'Bloc 4 — point 20' },
  { code: 'NET_COHERENCE', label: 'Cohérence du net à payer', category: 'PAIE', severity: 'CRITICAL', blocking: false, automation: 'AUTO',
    description: 'Net = brut − retenues + primes non imposables, à 1 FCFA près.', checklistRef: 'Bloc 2 — point 7' },
  { code: 'SALARY_VARIATION', label: 'Variation anormale du brut', category: 'PAIE', severity: 'WARN', blocking: false, automation: 'SEMI',
    description: "Le brut varie de plus de 20 % par rapport au mois précédent : une augmentation, une prime ou une erreur ? Un humain doit trancher et justifier." },
  { code: 'CNSS_NUMBER_MISSING', label: 'Numéro CNSS manquant', category: 'DOSSIER', severity: 'WARN', blocking: false, automation: 'AUTO',
    description: "L'employé est soumis à la CNSS mais son numéro d'affiliation n'est pas renseigné.", checklistRef: 'Bloc 1 — point 4' },
  { code: 'CHECKPOINT_OVERDUE', label: 'Déclaration non attestée', category: 'DECLARATIONS', severity: 'WARN', blocking: false, automation: 'SEMI',
    description: "L'échéance est dépassée et personne n'a attesté le dépôt avec sa preuve (reçu CNSS, accusé e-Tax).", checklistRef: 'Blocs 3 et 5' },
];

export const RULE_BY_CODE: Record<string, RuleDef> = Object.fromEntries(RULES.map((r) => [r.code, r]));