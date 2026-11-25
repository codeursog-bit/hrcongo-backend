# Rapport de paie — audit du 25 novembre 2026

## Étape 0 — constats avant implémentation

1. **Brut** : `payroll-calculator.service.ts` additionne la base ajustée, les heures supplémentaires, les primes imposables avec ou sans CNSS, et l'indemnité de congé payé. L'ancienneté imposable passe par les primes. Les indemnités non imposables sont exclues du brut. `totalBonuses` inclut cependant ces indemnités : ce champ ne peut donc pas être présenté tel quel comme une composante du brut.
2. **Coût employeur** : le calculateur enregistre `grossSalary + nonTaxableBonuses + cnssEmployer + tusTotal + employerCustomTaxTotal`. CAMU patronale et taxe patronale configurée passent par `computeCustomTaxes`, puis `employerCustomTaxTotal`. Elles sont incluses lorsqu'elles sont effectivement configurées et appliquées ; ne pas ajouter une nouvelle CAMU au rapport. CNSS et TUS disposent aussi de leurs montants détaillés stockés.
3. **Hors brut** : pas de champ scalaire `Payroll.nonTaxableBonuses`. Les primes/indemnités sont conservées dans les `PayrollItem` de type `GAIN`, non imposables et non soumises à CNSS. Les taxes patronales sont des lignes `EMPLOYER_COST`, notamment `CTAX_EMP_*`. Aucun autre poste hors brut n'est ajouté par la formule du calculateur examinée. Les paiements à l'étranger sont une source séparée (`PayrollForeignPay`), pas une prime Congo.
4. **Périmètre** : le journal exclut `CANCELLED` et inclut les autres statuts, donc les brouillons. La synthèse doit le signaler et distinguer « effectif avec bulletin » de « effectif payé ». Un bulletin reste compté après une sortie ou suppression de fiche, par sa période ; le journal n'exige pas un salarié encore actif. Le calculateur tient déjà compte des jours et absences : ne pas les proratiser une seconde fois. Pas de modèle autonome de régularisation trouvé : les montants suivent le mois/année du bulletin qui les contient. L'étranger est saisi en FCFA, conservé séparément ; l'ancien indicateur combiné ajoute le brut étranger au coût Congo et n'est pas un coût patronal étranger complet.
5. **Autres retenues** : les codes `LOAN`, `ADVANCE`, les taxes `CTAX_*` (dont TOL configurée), `COMPANY_DEDUCTION`/`MANUAL_DEDUCTION` et les autres lignes permettent la distinction. `totalDeductions` reste la référence pour le total retenu. Les déductions d'absence ont déjà une incidence sur le brut : ne pas les additionner à nouveau aux retenues nettes.

## Décisions de mise en œuvre

- Conserver le calculateur et les bulletins sans modification. La synthèse additionne les montants enregistrés ; les ratios et identités sont des indicateurs du rapport, jamais un nouveau moteur de paie.
- Ajouter une synthèse Congo au journal existant, avec définitions et compteurs de statuts. Les agrégats de cette synthèse sont calculés en base. Aucun filtre sur le statut actuel de l'employé.
- Conserver la paie étrangère dans son bloc distinct. Ne pas présenter l'ancien `totalCompanyCost` comme une nouvelle charge patronale Congo.
- Signaler les écarts, pas les corriger. La tolérance des contrôles par bulletin sera d'un FCFA ; un contrôle uniquement agrégé ne prouve pas l'absence d'écarts individuels qui se compensent.
- `PayrollItem` stocke base, taux et montant, mais pas un champ explicite « plafond appliqué ». Un plafond historique non enregistré devra être indiqué « non historisé », jamais remplacé silencieusement par le plafond légal actuel.
- Le journal historique charge aujourd'hui toutes les lignes : conserver son rendu pendant le premier lot ; le détail paginé et les agrégats supplémentaires doivent être ajoutés sans prétendre que ce chargement historique a déjà été supprimé.
- Les rapports Portefeuille agrègent les montants enregistrés mais une requête examinée n'exclut pas encore les annulations. Le cabinet calcule déjà charges patronales = CNSS + TUS + taxes patronales. Ces périmètres devront être alignés dans le lot associé.
- Les exports officiels et modèles existants ne sont pas modifiés dans le premier lot. Les nouvelles feuilles et définitions seront livrées dans le lot Export expressément demandé.

## Ordre et suivi

1. Audit ; synthèse Congo et définitions.
2. Détail des charges avec métadonnées historiques disponibles et contrôles par bulletin.
3. Répartition, évolution, périmètres associés.
4. Détail individuel paginé, permissions et cache invalidé par les modifications de bulletins.
5. Exports Excel/PDF, validation des cas de référence et tests de cloisonnement.

Les valeurs réelles en base et les canaux externes ne sont pas présumés validés par les tests locaux.

## Premier lot livré

`PayrollCostSummaryService` fournit les agrégats Congo au journal existant après résolution de l’entreprise autorisée. La synthèse front affiche les définitions, signale les brouillons, sépare l’étranger et expose les écarts globaux. Sept tests ciblés couvrent les cas de référence, les primes hors brut, taxes configurées, annulations dans les requêtes et écarts provoqués ; types front/back et rendu contrôlés. Pas de connexion de base réelle disponible dans ce checkout. Les lots 2 à 5 et les contrôles par bulletin restent à livrer ; le contrôle agrégé ne les remplace pas.
