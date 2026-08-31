// ============================================================================
// 📁 src/bonus-templates/convention-bonus-presets.ts  (FICHIER COMPLET)
//
// Registre des primes suggérées à l'activation d'une convention collective.
// Ce sont des SUGGESTIONS de départ uniquement : une fois créées comme
// BonusTemplate, l'admin les modifie, supprime ou en ajoute librement, sans
// aucun verrou ni avertissement système — il reste seul responsable de la
// rémunération réelle de ses employés.
// ============================================================================

import { BonusCategory } from './bonus-templates.service';

export interface ConventionBonusPreset {
  name: string;
  bonusCategory: BonusCategory;
  defaultAmount: number | null;
  defaultPercentage: number | null;
  baseCalculation: 'BASE_SALARY' | 'GROSS_SALARY' | null;
  isRecurring: boolean;
  isTaxable: boolean;
  isCnss: boolean;
  isProratized: boolean;
  isInLeaveBase: boolean;
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 🚌 TRANSPORT — Art.61 à 69.
// ─────────────────────────────────────────────────────────────────────────
const TRANSPORT_PRESETS: ConventionBonusPreset[] = [
  { name: 'Indemnité de transport (Exécution)', bonusCategory: 'FRAIS', defaultAmount: 60000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.63 — 60 000 FCFA/mois pour le collège Exécution. Non cumulable avec l'indemnité de véhicule (Art.64) ni de vélomoteur." },
  { name: 'Indemnité de transport (Maîtrise/Cadre)', bonusCategory: 'FRAIS', defaultAmount: 75000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.63 — 75 000 FCFA/mois pour Maîtrise et Cadre. Non cumulable avec l'indemnité de véhicule (Art.64) ni de vélomoteur." },
  { name: 'Indemnité de logement (Exécution)', bonusCategory: 'FRAIS', defaultAmount: 10000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: false, isProratized: false, isInLeaveBase: true, description: 'Art.65 — 10 000 FCFA/mois, collège Exécution.' },
  { name: 'Indemnité de logement (Maîtrise)', bonusCategory: 'FRAIS', defaultAmount: 15000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: false, isProratized: false, isInLeaveBase: true, description: 'Art.65 — 15 000 FCFA/mois, collège Maîtrise.' },
  { name: 'Indemnité de logement (Cadre Cat.12)', bonusCategory: 'FRAIS', defaultAmount: 100000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: false, isProratized: false, isInLeaveBase: true, description: 'Art.65 — 100 000 FCFA/mois, Cadre catégorie 12.' },
  { name: 'Indemnité de logement (Cadre Cat.13)', bonusCategory: 'FRAIS', defaultAmount: 150000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: false, isProratized: false, isInLeaveBase: true, description: 'Art.65 — 150 000 FCFA/mois, Cadre catégorie 13.' },
  { name: 'Indemnité de logement (Cadre Cat.14)', bonusCategory: 'FRAIS', defaultAmount: 200000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: false, isProratized: false, isInLeaveBase: true, description: 'Art.65 — 200 000 FCFA/mois, Cadre catégorie 14.' },
  { name: 'Indemnité de logement (Cadre Cat.15)', bonusCategory: 'FRAIS', defaultAmount: 250000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: false, isProratized: false, isInLeaveBase: true, description: 'Art.65 — 250 000 FCFA/mois, Cadre catégorie 15.' },
  { name: 'Prime de panier', bonusCategory: 'FRAIS', defaultAmount: 3000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: 'Art.68 — 3 000 FCFA par repas, plafond 2 repas/jour en cas de prolongation exceptionnelle du travail.' },
  { name: 'Prime de diplôme (CEP.A adulte)', bonusCategory: 'POSTE', defaultAmount: 4000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.61 — 4 000 FCFA/mois. Non cumulable — seul le plus élevé est payé.' },
  { name: 'Prime de diplôme (Brevet élémentaire/BEMT/BEPC…)', bonusCategory: 'POSTE', defaultAmount: 10000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.61 — 10 000 FCFA/mois. Non cumulable — seul le plus élevé est payé.' },
  { name: 'Prime de diplôme (Baccalauréat/BTS…)', bonusCategory: 'POSTE', defaultAmount: 15000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.61 — 15 000 FCFA/mois. Non cumulable — seul le plus élevé est payé.' },
  { name: "Prime de diplôme (Certificat/diplôme d'études supérieures)", bonusCategory: 'POSTE', defaultAmount: 30000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.61 — 30 000 FCFA/mois. Non cumulable — seul le plus élevé est payé.' },
  { name: 'Prime de langue', bonusCategory: 'POSTE', defaultAmount: 40000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: "Art.62 — 40 000 FCFA/mois si l'emploi exige une langue lue/écrite/parlée couramment." },
  { name: "Prime d'usage d'ordinateur", bonusCategory: 'POSTE', defaultAmount: 8000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: "Art.67 — 8 000 FCFA/mois pour tout travailleur utilisant l'ordinateur." },
  { name: 'Prime de caisse', bonusCategory: 'POSTE', defaultAmount: null, defaultPercentage: 30, baseCalculation: 'BASE_SALARY', isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.66 — 30% du salaire de base pour tout travailleur manipulant des espèces.' },
  { name: 'Prime de solde', bonusCategory: 'POSTE', defaultAmount: null, defaultPercentage: 30, baseCalculation: 'BASE_SALARY', isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.66 — 30% du salaire de base pour la responsabilité de caisse — cumulable avec la prime de caisse si les deux rôles sont cumulés.' },
  { name: 'Prime de responsabilité (Cat.8)', bonusCategory: 'POSTE', defaultAmount: 29000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.69.K — 29 000 FCFA/mois, catégorie 8.' },
  { name: 'Prime de responsabilité (Cat.9)', bonusCategory: 'POSTE', defaultAmount: 32500, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.69.K — 32 500 FCFA/mois, catégorie 9.' },
  { name: 'Prime de responsabilité (Cat.10)', bonusCategory: 'POSTE', defaultAmount: 41000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.69.K — 41 000 FCFA/mois, catégorie 10.' },
  { name: 'Prime de responsabilité (Cat.11)', bonusCategory: 'POSTE', defaultAmount: 46000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.69.K — 46 000 FCFA/mois, catégorie 11.' },
  { name: 'Prime de responsabilité (agent de maîtrise, chef de section)', bonusCategory: 'POSTE', defaultAmount: 12500, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: "Art.69.K — 12 500 FCFA/mois pour un agent de maîtrise ayant la responsabilité d'une section." },
];

// ─────────────────────────────────────────────────────────────────────────
// 🛒 COMMERCE — Art.42 à 47.
// ─────────────────────────────────────────────────────────────────────────
const COMMERCE_PRESETS: ConventionBonusPreset[] = [
  { name: 'Prime de panier', bonusCategory: 'FRAIS', defaultAmount: 2000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.42 — 2 000 FCFA par repas. Peut être remplacée par un repas gratuit." },
  { name: "Prime d'entretien de la tenue", bonusCategory: 'FRAIS', defaultAmount: 1500, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: false, isInLeaveBase: false, description: "Art.43 — 1 500 FCFA/mois pour tout salarié bénéficiaire d'une tenue de travail obligatoire." },
  { name: 'Prime de responsabilité — caisse principale', bonusCategory: 'POSTE', defaultAmount: 30000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.45.a — 30 000 FCFA/mois.' },
  { name: 'Prime de responsabilité — caisse secondaire', bonusCategory: 'POSTE', defaultAmount: 15000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.45.a — 15 000 FCFA/mois.' },
  { name: "Prime de fin d'année", bonusCategory: 'EXCEPTIONNELLE', defaultAmount: null, defaultPercentage: 100, baseCalculation: 'BASE_SALARY', isRecurring: false, isTaxable: true, isCnss: true, isProratized: true, isInLeaveBase: false, description: "Art.45.a — égale à un mois de salaire de base, versée une fois par an après 1 an de présence continue. Cadence annuelle à paramétrer manuellement." },
  { name: 'Indemnité de vélo ordinaire', bonusCategory: 'FRAIS', defaultAmount: 4000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.45.b — 4 000 FCFA/mois. Non cumulable avec l'indemnité de vélomoteur." },
  { name: 'Indemnité de vélomoteur', bonusCategory: 'FRAIS', defaultAmount: 10000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.45.b — 10 000 FCFA/mois. Non cumulable avec l'indemnité de vélo ordinaire." },
  { name: 'Indemnité de véhicule personnel', bonusCategory: 'FRAIS', defaultAmount: 100000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.45.b — 100 000 FCFA/mois pour usage permanent du véhicule personnel à la demande de l'employeur." },
  { name: 'Participation aux frais de transport', bonusCategory: 'FRAIS', defaultAmount: 25000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.45.b — 25 000 FCFA/mois minimum." },
  { name: 'Majoration diplôme (Brevet élémentaire → 1ère partie Bac / BEMT-BEP-BEPC-BET)', bonusCategory: 'POSTE', defaultAmount: 3000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.46 — 3 000 FCFA/mois. Non cumulable — seul le plus élevé est payé.' },
  { name: 'Majoration diplôme (BAC)', bonusCategory: 'POSTE', defaultAmount: 4500, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.46 — 4 500 FCFA/mois. Non cumulable — seul le plus élevé est payé.' },
  { name: 'Majoration diplôme (DUT/BTS)', bonusCategory: 'POSTE', defaultAmount: 8000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.46 — 8 000 FCFA/mois. Non cumulable — seul le plus élevé est payé.' },
  { name: 'Majoration langue étrangère — traduction', bonusCategory: 'POSTE', defaultAmount: 5000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: "Art.47 — 5 000 FCFA/mois par langue. Cumulable entre langues différentes." },
  { name: 'Majoration langue étrangère — rédaction', bonusCategory: 'POSTE', defaultAmount: 7000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: "Art.47 — 7 000 FCFA/mois par langue. Cumulable entre langues différentes." },
];

// ─────────────────────────────────────────────────────────────────────────
// 🛢️ PETROLE — Art.60, 61 et 65.
// ─────────────────────────────────────────────────────────────────────────
const PETROLE_PRESETS: ConventionBonusPreset[] = [
  { name: "Prime de fin d'année", bonusCategory: 'EXCEPTIONNELLE', defaultAmount: null, defaultPercentage: 100, baseCalculation: 'BASE_SALARY', isRecurring: false, isTaxable: true, isCnss: true, isProratized: true, isInLeaveBase: false, description: "Art.60 — un mois de salaire de base + prime d'ancienneté, versée une fois par an. Le pourcentage ci-dessus ne couvre que le salaire de base — ajouter manuellement la prime d'ancienneté si besoin. Cadence annuelle à paramétrer manuellement." },
  { name: 'Majoration diplôme (cycle secondaire 1er degré)', bonusCategory: 'POSTE', defaultAmount: 4000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.61.a — 4 000 FCFA/mois. Non cumulable — seul le plus élevé est payé.' },
  { name: 'Majoration diplôme (BAC / BESEC)', bonusCategory: 'POSTE', defaultAmount: 7000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.61.a — 7 000 FCFA/mois. Non cumulable — seul le plus élevé est payé.' },
  { name: 'Majoration diplôme (cycle supérieur)', bonusCategory: 'POSTE', defaultAmount: 10000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.61.a — 10 000 FCFA/mois. Non cumulable — seul le plus élevé est payé.' },
  { name: 'Majoration langue étrangère', bonusCategory: 'POSTE', defaultAmount: 5000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: "Art.61.b — 5 000 FCFA/mois si la connaissance d'une langue étrangère est une exigence de l'emploi." },
  { name: 'Prime de panier', bonusCategory: 'FRAIS', defaultAmount: 2261, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.65 — 3× le salaire horaire de la catégorie 1, échelon 1 (calculé sur le barème 01/07/2023) — À recalculer à chaque révision de grille." },
];

// ─────────────────────────────────────────────────────────────────────────
// 🏭 INDUSTRIE — Art.42, 43, 45, 46.
// ─────────────────────────────────────────────────────────────────────────
const INDUSTRIE_PRESETS: ConventionBonusPreset[] = [
  { name: 'Majoration diplôme (petits diplômes — BEMT/BEP/BEPC/BEI)', bonusCategory: 'POSTE', defaultAmount: 3800, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.42 — 3 800 FCFA/mois. Non cumulable — seul le plus élevé est payé.' },
  { name: "Majoration diplôme (études secondaires/diplômes spéciaux)", bonusCategory: 'POSTE', defaultAmount: 5600, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.42 — 5 600 FCFA/mois. Non cumulable — seul le plus élevé est payé.' },
  { name: 'Majoration diplôme (enseignement supérieur)', bonusCategory: 'POSTE', defaultAmount: 10000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.42 — 10 000 FCFA/mois. Non cumulable — seul le plus élevé est payé.' },
  { name: 'Majoration langue étrangère — traduction', bonusCategory: 'POSTE', defaultAmount: 5000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: "Art.43 — 5 000 FCFA/mois par langue." },
  { name: 'Majoration langue étrangère — rédaction', bonusCategory: 'POSTE', defaultAmount: 7000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: "Art.43 — 7 000 FCFA/mois par langue." },
  { name: 'Prime de panier', bonusCategory: 'FRAIS', defaultAmount: 1750, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.45 — 1 750 FCFA/jour minimum, révisable annuellement." },
  { name: "Prime de fin d'année", bonusCategory: 'EXCEPTIONNELLE', defaultAmount: null, defaultPercentage: 100, baseCalculation: 'BASE_SALARY', isRecurring: false, isTaxable: true, isCnss: true, isProratized: true, isInLeaveBase: false, description: "Art.46 — un mois de salaire de base + 20% de la prime d'ancienneté, versée une fois par an. Cadence annuelle à paramétrer manuellement." },
];

// ─────────────────────────────────────────────────────────────────────────
// 💊 PHARMACIE — Art.38 à 44 et 46.
// ─────────────────────────────────────────────────────────────────────────
const PHARMACIE_PRESETS: ConventionBonusPreset[] = [
  { name: 'Prime de responsabilité', bonusCategory: 'POSTE', defaultAmount: 20000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.38 — 20 000 FCFA/mois.' },
  { name: 'Prime de caisse principale', bonusCategory: 'POSTE', defaultAmount: 20000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.38 — 20 000 FCFA/mois.' },
  { name: 'Prime de caisse secondaire', bonusCategory: 'POSTE', defaultAmount: 10000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.38 — 10 000 FCFA/mois.' },
  { name: 'Prime de vélomoteur', bonusCategory: 'FRAIS', defaultAmount: 5000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.38 — 5 000 FCFA/mois." },
  { name: 'Prime de vélo ordinaire', bonusCategory: 'FRAIS', defaultAmount: 5000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.38 — 5 000 FCFA/mois." },
  { name: 'Prime de salissure', bonusCategory: 'FRAIS', defaultAmount: 2000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: 'Art.38 — 2 000 FCFA/mois.' },
  { name: 'Prime de produits dangereux', bonusCategory: 'POSTE', defaultAmount: 10000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.38 — 10 000 FCFA/mois.' },
  { name: 'Prime de garde', bonusCategory: 'POSTE', defaultAmount: 5000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.38 — 5 000 FCFA/mois.' },
  { name: 'Prime de risque (pharmacies de nuit)', bonusCategory: 'POSTE', defaultAmount: 10000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.38 — 10 000 FCFA/mois, pharmacies de nuit uniquement.' },
  { name: 'Majoration diplôme (petits diplômes)', bonusCategory: 'POSTE', defaultAmount: 5000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.39 — 5 000 FCFA/mois. Non cumulable.' },
  { name: 'Majoration diplôme (études secondaires/spéciaux)', bonusCategory: 'POSTE', defaultAmount: 7500, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.39 — 7 500 FCFA/mois. Non cumulable.' },
  { name: 'Majoration diplôme (enseignement supérieur)', bonusCategory: 'POSTE', defaultAmount: 10000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.39 — 10 000 FCFA/mois. Non cumulable.' },
  { name: "Majoration diplôme (Docteur d'état en pharmacie)", bonusCategory: 'POSTE', defaultAmount: 20000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.39 — 20 000 FCFA/mois. Non cumulable.' },
  { name: 'Majoration langue étrangère — traduction', bonusCategory: 'POSTE', defaultAmount: 7000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: "Art.40 — 7 000 FCFA/mois par langue." },
  { name: 'Majoration langue étrangère — rédaction', bonusCategory: 'POSTE', defaultAmount: 10000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: "Art.40 — 10 000 FCFA/mois par langue." },
  { name: 'Majoration langue étrangère — sténographie (secrétaires)', bonusCategory: 'POSTE', defaultAmount: 8000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: "Art.40 — 8 000 FCFA/mois par langue." },
  { name: 'Indemnité de panier', bonusCategory: 'FRAIS', defaultAmount: 2000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.41 — 2 000 FCFA." },
  { name: "Indemnité d'inventaire", bonusCategory: 'EXCEPTIONNELLE', defaultAmount: 5000, defaultPercentage: null, baseCalculation: null, isRecurring: false, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: false, description: "Art.42 — 5 000 FCFA minimum, occasionnelle." },
  { name: 'Indemnité de transport', bonusCategory: 'FRAIS', defaultAmount: 15000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: 'Art.44 — 15 000 FCFA/mois.' },
  { name: "Prime de fin d'année", bonusCategory: 'EXCEPTIONNELLE', defaultAmount: null, defaultPercentage: null, baseCalculation: 'BASE_SALARY', isRecurring: false, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: false, description: "Art.46 — 1/3 du salaire de base par année de présence, max 100% (plafond à 3 ans). Formule progressive — à configurer manuellement." },
];

// ─────────────────────────────────────────────────────────────────────────
// 🏗️ BTP — Art.52 à 61. Grille de 1990 (voir btp-grille.ts). Indemnité de
// déplacement (Art.59, basée sur le SMIG horaire) et véhicule automobile
// (Art.56, forfait contractuel) exclues — pas de montant fixe donné.
// ─────────────────────────────────────────────────────────────────────────
const BTP_PRESETS: ConventionBonusPreset[] = [
  { name: 'Prime de panier', bonusCategory: 'FRAIS', defaultAmount: 650, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.52 — 650 FCFA/jour." },
  { name: 'Indemnité de caisse (0 à 500 000 F)', bonusCategory: 'POSTE', defaultAmount: 3000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.53 — 3 000 FCFA/mois, caisse moyenne mensuelle 0-500 000 FCFA.' },
  { name: 'Indemnité de caisse (500 000 à 1 000 000 F)', bonusCategory: 'POSTE', defaultAmount: 6500, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.53 — 6 500 FCFA/mois, caisse moyenne 500 000-1 000 000 FCFA.' },
  { name: 'Indemnité de caisse (1 000 000 à 5 000 000 F)', bonusCategory: 'POSTE', defaultAmount: 12000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.53 — 12 000 FCFA/mois, caisse moyenne 1 000 000-5 000 000 FCFA.' },
  { name: 'Indemnité de caisse (au-dessus de 5 000 000 F)', bonusCategory: 'POSTE', defaultAmount: 15000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.53 — 15 000 FCFA/mois, caisse moyenne au-dessus de 5 000 000 FCFA.' },
  { name: "Prime d'insalubrité", bonusCategory: 'POSTE', defaultAmount: 450, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: true, isInLeaveBase: true, description: 'Art.54 — 450 FCFA/jour, réparations/vidanges de puisards ou fosses septiques.' },
  { name: 'Prime de risque', bonusCategory: 'POSTE', defaultAmount: 500, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: true, isInLeaveBase: true, description: "Art.55 — 500 FCFA/jour, échafaudages >7m, marteaux-piqueurs, vitres/miroirs >6m², puits >4m." },
  { name: 'Indemnité de vélo', bonusCategory: 'FRAIS', defaultAmount: 3000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.56 — 3 000 FCFA/mois." },
  { name: 'Indemnité de vélomoteur', bonusCategory: 'FRAIS', defaultAmount: 5000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: "Art.56 — 5 000 FCFA/mois (texte source ambigu, écrit \"cinq mille\" mais chiffré \"5.600\" — à vérifier)." },
  { name: 'Prime de transport', bonusCategory: 'FRAIS', defaultAmount: 5200, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: false, isCnss: false, isProratized: true, isInLeaveBase: false, description: 'Art.58 — 5 200 FCFA/mois (50% de 400 FCFA/jour aller-retour), pour 160h de travail minimum/mois.' },
  { name: 'Majoration diplôme (CEPE)', bonusCategory: 'POSTE', defaultAmount: 1500, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.60 — 1 500 FCFA/mois. Non cumulable.' },
  { name: 'Majoration diplôme (petits diplômes)', bonusCategory: 'POSTE', defaultAmount: 4000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.60 — 4 000 FCFA/mois. Non cumulable.' },
  { name: 'Majoration diplôme (enseignement secondaire/spéciaux)', bonusCategory: 'POSTE', defaultAmount: 6000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.60 — 6 000 FCFA/mois. Non cumulable.' },
  { name: 'Majoration diplôme (enseignement supérieur)', bonusCategory: 'POSTE', defaultAmount: 10000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: 'Art.60 — 10 000 FCFA/mois. Non cumulable.' },
  { name: 'Majoration langue étrangère — traduction', bonusCategory: 'POSTE', defaultAmount: 5000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: "Art.61 — 5 000 FCFA/mois par langue." },
  { name: 'Majoration langue étrangère — rédaction', bonusCategory: 'POSTE', defaultAmount: 8000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: "Art.61 — 8 000 FCFA/mois par langue." },
  { name: 'Majoration langue étrangère — sténodactylographie', bonusCategory: 'POSTE', defaultAmount: 6000, defaultPercentage: null, baseCalculation: null, isRecurring: true, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: true, description: "Art.61 — 6 000 FCFA/mois par langue." },
  { name: "Prime de fin d'année", bonusCategory: 'EXCEPTIONNELLE', defaultAmount: null, defaultPercentage: null, baseCalculation: 'BASE_SALARY', isRecurring: false, isTaxable: true, isCnss: true, isProratized: false, isInLeaveBase: false, description: "Art.57 — 1/3 du salaire de base par année de présence, max 100% (plafond à 3 ans). Formule progressive — à configurer manuellement." },
];

// ─────────────────────────────────────────────────────────────────────────
// Registre — une entrée par convention déjà traitée.
// ─────────────────────────────────────────────────────────────────────────
export const CONVENTION_BONUS_PRESETS: Record<string, ConventionBonusPreset[]> = {
  TRANSPORT: TRANSPORT_PRESETS,
  COMMERCE: COMMERCE_PRESETS,
  PETROLE: PETROLE_PRESETS,
  INDUSTRIE: INDUSTRIE_PRESETS,
  PHARMACIE: PHARMACIE_PRESETS,
  BTP: BTP_PRESETS,
};

export function getConventionBonusPresets(
  conventionCode: string | null | undefined,
): ConventionBonusPreset[] {
  if (!conventionCode) return [];
  return CONVENTION_BONUS_PRESETS[conventionCode.toUpperCase()] ?? [];
}