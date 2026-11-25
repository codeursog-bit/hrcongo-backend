# Incidents — cadrage du 25 novembre 2026

Demande reçue avec le chantier d'enrichissement du journal de paie. Le brief demande une livraison après le chantier des modèles de documents ; aucune modification de ces modèles ne sera faite par le suivi d'incidents.

## Existant inspecté

- `GlobalExceptionFilter` écrit déjà `AppError`, avec contexte et masquage récursif de clés sensibles. La capture ne regroupe pas les occurrences ; son message et sa pile ne bénéficient pas du même assainissement que les objets.
- `ErrorTrackingService` dispose des filtres, résolutions et nettoyages ; les informations entreprise/utilisateur sont encore enrichies ligne par ligne.
- La page `/admin/errors` existe. Elle devra être étendue, pas doublée par une autre boîte d'erreurs.
- `AppError` et `SystemLog` sont présents ; le schéma inspecté ne comporte pas `ErrorGroup`.
- `app/error.tsx` recharge les anciens chunks une fois par session mais ne transmet pas l'erreur. `app/global-error.tsx` n'existe pas.
- Les notifications, le push et le gateway authentifié existent. Réutiliser ces canaux et leurs autorisations ; ne jamais diffuser à toutes les entreprises.
- `main.ts` possède déjà les handlers `uncaughtException` et `unhandledRejection`, avec journal console et arrêt après dix erreurs en une minute. Les enrichir plutôt qu'en ajouter une seconde paire ; ils ne créent pas encore d'incident persistant.

## Lots du brief

- A : collecte navigateur bornée et assainie, endpoint avec identité de session, regroupement et capture processus.
- B : alertes par canaux existants, déduplication atomique, résumé et auto-surveillance.
- C : enrichissement de l'interface erreurs, rapport Markdown pour correctif, santé entreprise.
- D : couverture cron, WebSocket, services tiers, lenteurs et source maps privées.
- E : tests HTTP/charge/récidive/confidentialité et documentation des variables.

Ne pas considérer ce cadrage comme une fonctionnalité livrée. Aucun canal d'alerte, webhook ou prestataire externe n'est activé par cette lecture. L'intégration doit être activable par drapeau, après migration additive et vérifications.

## Alternative externe (décision)

Conserver le suivi interne. Un service tel que Sentry apporte regroupement, source maps et SDK, mais ajoute un sous-traitant et une configuration de filtrage, d'identité multi-entreprises et de rétention. Il ne remplace pas les alertes portant le contexte entreprise/plan. Aucun SDK ni transfert vers ce service n'est nécessaire pour les lots demandés ; aucune donnée de paie ne doit lui être transmise. Cette comparaison est architecturale, sans hypothèse sur les quotas ou tarifs actuels d'une offre externe.
