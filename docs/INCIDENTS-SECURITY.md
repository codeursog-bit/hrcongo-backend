# Contrôle sécurité ciblé — incidents — 25 novembre 2026

Périmètre : collecte navigateur, endpoint client-errors, stockage/regroupement, lecture/actions SUPER_ADMIN, alertes, préférence mail, piles et archives privées. Ce contrôle ne constitue pas un audit de toutes les routes du produit ni un test de production.

Corrections : masquage des valeurs sensibles dans les fragments JSON avant émission et stockage ; jetons dans les chemins de récupération/suivi et segments opaques ; identifiants intégrés aux URL de pile ; validation du format des versions de build avant stockage.

Vérifié : identité issue de la session et refus des companyId/userId fournis dans le corps ; session révoquée traitée anonymement ; lectures refusées aux anonymes, employés, administrateurs entreprise et support ; websocket réservé au SUPER_ADMIN avec revalidation ; préférence mail liée au seul compte connecté et désactivée par défaut ; payload 16 Ko, file bornée, dédoublonnage ; source maps locales confinées et contenu des sources non retourné. 35 tests réussis et contrôle isolé de collecte navigateur réussi.

Limites restantes : pas de test sur base réelle ou infrastructure déployée ; limitation de débit locale au processus (prévoir stockage partagé pour plusieurs instances). Le masquage du texte libre réduit les fuites mais ne garantit pas de reconnaître toute information personnelle arbitraire. Les signalements anonymes ne sont pas une preuve authentifiée de la réalité d'un incident et peuvent polluer le suivi ; surveiller leur volume. Aucun scan complet des dépendances ni pentest global effectué. Migration et configuration toujours nécessaires avant activation réelle.
