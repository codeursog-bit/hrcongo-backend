// ============================================================================
// 🛒 CONFIG CHARIOW — Mapping plan interne (BASIC/PRO/ENTERPRISE × mensuel/
// annuel) → produit "license" Chariow.
// ============================================================================
// ⚠️ PRÉ-REQUIS CÔTÉ DASHBOARD CHARIOW (à faire une fois, manuellement) :
//   Créer 6 produits de type "license" (un par plan × période) :
//     - "KonzaRH Basic — Mensuel"      / "KonzaRH Basic — Annuel"
//     - "KonzaRH Pro — Mensuel"        / "KonzaRH Pro — Annuel"
//     - "KonzaRH Enterprise — Mensuel" / "KonzaRH Enterprise — Annuel"
//   Configurer sur chaque produit le prix (XAF, doit matcher plans.config.ts)
//   et la "durée de validité" de la licence (1 mois / 1 an selon le produit
//   — c'est ce qui alimente expires_at côté Chariow, à titre indicatif :
//   voir la note dans chariow.service.ts, ce n'est pas notre source de
//   vérité d'accès app). Copier l'id public (prd_xxx) de chaque produit dans
//   les variables d'environnement ci-dessous.
// ============================================================================

export type InternalPlan = 'BASIC' | 'PRO' | 'ENTERPRISE';
export type BillingPeriod = 'monthly' | 'yearly';

function requiredEnv(name: string): string {
  const value = process.env[name];
  // On ne throw pas au chargement du module (éviterait de casser tout le
  // backend si un seul produit n'est pas encore configuré) — l'erreur
  // remonte seulement au moment où ce plan précis est utilisé.
  return value ?? '';
}

export const CHARIOW_PRODUCTS: Record<InternalPlan, Record<BillingPeriod, string>> = {
  BASIC: {
    monthly: requiredEnv('CHARIOW_PRODUCT_BASIC_MONTHLY_ID'),
    yearly: requiredEnv('CHARIOW_PRODUCT_BASIC_YEARLY_ID'),
  },
  PRO: {
    monthly: requiredEnv('CHARIOW_PRODUCT_PRO_MONTHLY_ID'),
    yearly: requiredEnv('CHARIOW_PRODUCT_PRO_YEARLY_ID'),
  },
  ENTERPRISE: {
    monthly: requiredEnv('CHARIOW_PRODUCT_ENTERPRISE_MONTHLY_ID'),
    yearly: requiredEnv('CHARIOW_PRODUCT_ENTERPRISE_YEARLY_ID'),
  },
};

export function getChariowProductId(
  plan: InternalPlan,
  billingPeriod: BillingPeriod,
): string {
  const productId = CHARIOW_PRODUCTS[plan]?.[billingPeriod];
  if (!productId) {
    throw new Error(
      `CHARIOW_PRODUCT_${plan}_${billingPeriod.toUpperCase()}_ID manquant dans l'environnement — le produit Chariow pour ${plan}/${billingPeriod} n'est pas configuré.`,
    );
  }
  return productId;
}