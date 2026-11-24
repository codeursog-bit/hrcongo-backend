// ============================================================================
// 📁 src/common/escape-html.util.ts
// ✅ Correctif de la faille XSS CRITIQUE (audit sécurité) :
//    loans-orca-export.service.ts insérait la valeur brute de chaque cellule
//    du document (motif de prêt/avance, nom employé, etc.) dans du HTML sans
//    échapper &, <, >, ", ' — un motif contenant du HTML/JS s'exécutait dans
//    le navigateur du RH/Admin qui ouvrait le document pour le valider.
// ============================================================================

/**
 * Échappe les caractères HTML dangereux. À appliquer à TOUTE valeur brute
 * insérée dans un fragment HTML construit à la main côté serveur.
 */
export function escapeHtml(value: unknown): string {
  const str = String(value ?? '');
  return str
    .replace(/&/g, '&amp;') // doit être fait EN PREMIER
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}