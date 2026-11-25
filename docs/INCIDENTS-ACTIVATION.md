# Activation des incidents — 25 novembre 2026

Implémenté : collecte navigateur et boundaries React, endpoint borné à 16 Ko avec session facultative, regroupement par empreinte et lots de 10 secondes, récidives, alertes privées SUPER_ADMIN, push, mail facultatif et résumé quotidien, écran /admin/errors, rapport Markdown et santé par entreprise. Enveloppe des crons, traces SystemLog en erreur, détection DB lente/indisponible, mail, Cloudinary et transport IA.

## Activation

Appliquer la migration additive `20261125160000_error_groups` avant de démarrer le nouveau backend, puis générer Prisma Client. La migration n'a pas été appliquée sur une base réelle dans cette session.

Backend : `INCIDENTS_ENABLED=true`, `INCIDENTS_ALERTS_ENABLED=true`. `INCIDENTS_EMAIL_ENABLED=false` coupe globalement le mail ; sinon chaque super administrateur doit personnellement activer « Recevoir les alertes par e-mail » dans Incidents. La préférence est désactivée par défaut et couvre aussi le résumé quotidien et les alertes de panne de canal. Les notifications dans l'application restent indépendantes.

Frontend (reconstruction nécessaire) : `NEXT_PUBLIC_INCIDENTS_ENABLED=true`. Renseigner `APP_VERSION` côté serveur et `NEXT_PUBLIC_APP_VERSION` côté front. Les configurations Resend, VAPID et FRONTEND_URL existantes sont réutilisées. Aucun e-mail réel n'a été envoyé lors des tests.

Seuils : `INCIDENTS_SPIKE_THRESHOLD` (50), `INCIDENTS_SPIKE_WINDOW_MS` (300000), `INCIDENTS_SLOW_QUERY_MS` (5000). Dédoublonnage atomique des alertes 15 minutes ; une récidive ouvre un nouveau cycle d'alerte. Résumé à 08 h Brazzaville pour les comptes ayant activé les e-mails.

## Limites et validation de déploiement

Tests locaux avec stockage simulé ; vérifier le parcours navigateur → base réelle → notifications et les canaux externes après migration. La file serveur est volatile et bornée à 500 empreintes, 1000 identités par empreinte/lot ; une extinction brutale ou une surcharge peut perdre des événements. Limites IP/entreprise locales au processus, à compléter par un limiteur partagé en déploiement multi-instance. Les lots stockent un échantillon et un compteur, pas chaque pile individuelle. Les crons qui absorbent leur erreur sans SystemLog ne peuvent pas être détectés par leur enveloppe.

Les source maps publiques de production restent désactivées. Le décodage local est disponible : définir `INCIDENTS_SOURCE_MAPS_DIR`, puis ranger les archives privées sous `<dossier>/<APP_VERSION>/_next/static/…js.map`, avec le même chemin que le fichier JavaScript. Le serveur ne consulte aucune URL distante, refuse les traversées de dossiers et ne retourne jamais le contenu des sources. Sans archive correspondante, la pile reste inchangée. La fabrication et le transfert des archives privées relèvent du déploiement ; aucun fichier de source map n'est publié. Le webhook externe reste optionnel et non activé. Les groupes expirent après 90 jours via le nettoyage existant ; les occurrences suivent ses règles 30/90 jours.

Vérification locale : 31 tests backend/HTTP/JWT/source maps réussis ; TypeScript frontend et backend réussis. Collecte navigateur testée isolément (masquage, file 20, dédoublonnage, hors ligne, chunk unique). La dépendance de décodage est déclarée explicitement ; sa version était déjà disponible localement. Aucune installation réseau ni migration réelle effectuée.
