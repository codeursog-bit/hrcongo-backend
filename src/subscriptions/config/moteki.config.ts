// ============================================================================
// 🛒 CONFIG MOTEKI — Mapping plan interne (BASIC/PRO/ENTERPRISE × mensuel/
// annuel) → produit digital Moteki + index du plan tarifaire.
// ============================================================================
// ⚠️ PRÉ-REQUIS CÔTÉ DASHBOARD MOTEKI (à faire une fois, manuellement) :
//   Créer 3 produits digitaux de type "subscription", un par plan payant :
//     - "Abonnement Basic"      → 2 subscription_plans : [0]=Mensuel, [1]=Annuel
//     - "Abonnement Pro"        → 2 subscription_plans : [0]=Mensuel, [1]=Annuel
//     - "Abonnement Enterprise" → 2 subscription_plans : [0]=Mensuel, [1]=Annuel
//   Copier l'UUID de chaque produit dans les variables d'environnement
//   ci-dessous. L'ORDRE des plans dans le dashboard doit correspondre à
//   planIndex (0 = premier plan créé = mensuel, 1 = second = annuel) —
//   Moteki ne référence les plans que par leur position dans le tableau.
// ============================================================================

export type InternalPlan = 'BASIC' | 'PRO' | 'ENTERPRISE';
export type BillingPeriod = 'monthly' | 'yearly';

export interface MotekiPlanRef {
  digitalProductUuid: string;
  planIndex: number;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // On ne throw pas au chargement du module (éviterait de casser tout le
    // backend si un seul produit n'est pas encore configuré en sandbox) —
    // l'erreur remonte seulement au moment où ce plan précis est utilisé.
    return '';
  }
  return value;
}

export const MOTEKI_PRODUCTS: Record<InternalPlan, string> = {
  BASIC: requiredEnv('MOTEKI_PRODUCT_BASIC_UUID'),
  PRO: requiredEnv('MOTEKI_PRODUCT_PRO_UUID'),
  ENTERPRISE: requiredEnv('MOTEKI_PRODUCT_ENTERPRISE_UUID'),
};

// Index du plan dans subscription_plans pour chaque produit — 0 = mensuel,
// 1 = annuel, en respectant l'ordre de création recommandé ci-dessus.
const PLAN_INDEX: Record<BillingPeriod, number> = {
  monthly: 0,
  yearly: 1,
};

export function getMotekiPlanRef(
  plan: InternalPlan,
  billingPeriod: BillingPeriod,
): MotekiPlanRef {
  const digitalProductUuid = MOTEKI_PRODUCTS[plan];
  if (!digitalProductUuid) {
    throw new Error(
      `MOTEKI_PRODUCT_${plan}_UUID manquant dans l'environnement — le produit digital Moteki pour le plan ${plan} n'est pas configuré.`,
    );
  }
  return { digitalProductUuid, planIndex: PLAN_INDEX[billingPeriod] };
}