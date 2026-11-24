/**
 * Repères anonymes d'une conversation : E1…E30 pour les employés, D1…D30 pour les départements,
 * [[N1]]…[[N30]] pour les valeurs saisies. La limite protège la taille des échanges avec le modèle
 * et du contexte chiffré conservé ; ce n'est pas un quota de facturation (les crédits comptent les
 * demandes, pas la taille d'une demande).
 */
export const MAX_REFS = 30;
/** Numéro de repère valide, de 1 à MAX_REFS (à garder cohérent avec MAX_REFS). */
export const REF_NUM = '(?:[1-9]|[12][0-9]|30)';