// ============================================================================
// src/invoices/invoice.config.ts
// Identité de l'émetteur (en-tête de la facture) + réglages. Modifiable via .env
// ============================================================================

export const INVOICE_ISSUER = {
  name: process.env.INVOICE_ISSUER_NAME || 'KonzaRH',
  address: process.env.INVOICE_ISSUER_ADDRESS || 'Pointe-Noire, Congo-Brazzaville',
  phone: process.env.INVOICE_ISSUER_PHONE || '',
  email: process.env.INVOICE_ISSUER_EMAIL || '',
  website: process.env.INVOICE_ISSUER_WEBSITE || 'www.konza-rh.cg',
  taxId: process.env.INVOICE_ISSUER_TAX_ID || '', // NIU / RCCM, affiché s'il est renseigné
};

// Taux de TVA appliqué. Les prix des plans sont considérés TTC :
// si le taux est > 0, la facture affiche la TVA incluse. 0 = « TVA (0 %) » comme sur ton modèle.
export const INVOICE_VAT_RATE = Number(process.env.INVOICE_VAT_RATE ?? 0);

// Couleurs tirées du logo KonzaRH
export const INVOICE_COLORS = {
  primary: '#047857', // vert foncé (K + « KONZA »)
  emerald: '#10B981', // vert clair
  accent: '#F59E0B', // orange (« RH »)
  text: '#064E3B', // texte principal
  muted: '#4B6B5F',
};
