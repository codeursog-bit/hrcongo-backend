# Revue globale de sécurité — 25 novembre 2026

## Statut
Revue transversale initiale du front et du back, avec corrections confirmées. Ce document ne certifie pas toutes les routes : les vérifications réelles multi-comptes, la base et l’infrastructure de production restent nécessaires. Aucune donnée client réelle utilisée, aucun paiement déclenché.

## Corrections livrées
- Cache navigateur : suppression du stockage des pages de navigation privées dans le service worker. Nouveau cache v3 pour purger les anciens caches applicatifs à son activation. Les anciens contenus ne sont purgés qu’après déploiement et activation du nouveau worker.
- WebSocket : suppression des exceptions autorisant des domaines Render arbitraires et des domaines de prévisualisation déduits par chaîne. Origines à déclarer explicitement dans CORS_ORIGINS.
- Primes : import des presets protégé par RolesGuard, limité aux rôles ADMIN, SUPER_ADMIN et HR_MANAGER.
- Paiements : retrait des dumps complets des webhooks Moteki/Chariow et des payloads de confirmation/décaissement YabetooPay ; suppression du journal contenant montant et téléphone du bénéficiaire lors de la création du décaissement.

## Périmètres examinés
Authentification/JWT et sessions révoquées, DTO inscription/invitation et rôle, guards admin/support, contrôles d’entreprise communs et portefeuille/cabinet, services utilisateurs, paramètres paie et primes, documents et liens signés, messagerie/support, contrats et templates par inventaire des guards, mécanismes des webhooks de paiement, transport IA et règles de confidentialité, rendu HTML blog/JSON-LD par recherche des points sensibles, cache frontend, CORS HTTP/WebSocket, incidents et source maps privées. Les résultats statiques ne remplacent pas la vérification de chaque méthode avec plusieurs entreprises.

## Résultats des vérifications
- Suite backend complète lancée avant les nouveaux tests transversaux : 34 suites réussies / 35 ; 236 tests réussis / 250. Les 14 échecs sont dans payrolls.service.spec.ts : montage Nest incomplet, PayrollCalculatorService non fourni. Cette suite doit être remise à jour pour retrouver une validation globale.
- Tests ciblés après corrections : 10 réussis (cache hors ligne sans page privée, guard d’import des primes et autorisations websocket).
- Politique assistant et confidentialité quotidienne : scripts réussis.
- Contrôle support connecté : impossible, DATABASE_URL absent ; son script nécessite une base de test et effectue des écritures/nettoyages. Ne pas le lancer sur une base client.

## Points restant à valider / traiter
1. Authentification cryptographique Chariow non implémentée : la présence du header n’en prouve pas l’authenticité. L’activation doit continuer à dépendre exclusivement de la vérification serveur auprès du prestataire ; obtenir son protocole signé avant d’activer un traitement fiable de webhook.
2. Revalidation des changements de rattachement d’entreprise pendant une session : plusieurs routes utilisent encore le companyId du JWT ; tester retrait de portefeuille, transfert utilisateur et suppression d’appartenance avec un token encore valide.
3. Logs des autres modules : des traces détaillées de calcul RH/paie existent encore. Vérifier les niveaux réellement activés en production et purger les journaux historiques sensibles selon la politique de rétention.
4. Fichiers : vérifier en production les ACL du stockage et la validité effective des liens signés ; un contrôle du code ne prouve pas que le bucket est privé.
5. Dépendances : aucun scan de vulnérabilités connecté validé. Réaliser l’audit avec registre accessible, en évitant les mises à niveau majeures automatiques.
6. Compléter les tests HTTP de chaque famille de routes avec deux entreprises, employé, manager, RH, admin, cabinet, portefeuille, support et super admin. Vérifier aussi CSRF cookies cross-site, en-têtes et autorisations des proxies sur le déploiement réel.

La revue globale reste ouverte pour ces points. Les correctifs ne modifient ni les calculs de paie ni les documents officiels.

## Deuxième passe — sessions et paiement
Corrigé : rattachement actif relu en base, rejet des JWT de précédente entreprise, contrôle des liens portefeuille et cabinet à chaque validation, WebSocket utilisant le contexte validé. Refresh : refus des sessions expirées et consommation atomique empêchant deux renouvellements simultanés. Chariow : endpoint public neutralisé (accusé de réception sans traitement), polling existant conservé ; réactivation du webhook uniquement après implémentation vérifiée du protocole signé. 30 tests sessions/refresh/WebSocket/HTTP réussis ; test Chariow ciblé ajouté. Les points 1 et 2 de la liste initiale sont traités dans le code, validation production toujours requise. Après changement d’entreprise, un ancien onglet peut devoir renouveler sa session.
