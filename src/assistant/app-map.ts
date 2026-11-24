/**
 * Plan de l'application pour Sofia : où se trouve chaque fonction, décrit à partir des vraies
 * routes. Texte volontairement prudent : on dit où aller, jamais le détail exact des boutons.
 */
export interface AppPage {
  path: string;
  title: string;
  about: string;
  keywords: string[];
}
const P = (path: string, title: string, about: string, keywords: string[]): AppPage => ({
  path,
  title,
  about,
  keywords,
});
export const APP_MAP: AppPage[] = [
  P('/employes', 'Liste des employés', 'Consulter, rechercher et ouvrir la fiche des employés de l’entreprise.', ['employe', 'employes', 'salarie', 'personnel', 'fiche', 'liste']),
  P('/employes/nouveau', 'Ajouter un employé', 'Créer la fiche d’un nouvel employé (identité, contrat, salaire).', ['ajouter', 'creer', 'nouvel', 'nouveau', 'embauche', 'employe', 'recruter']),
  P('/employes/import', 'Importer des employés', 'Ajouter plusieurs employés d’un coup à partir d’un fichier.', ['importer', 'import', 'fichier', 'excel', 'masse', 'employes']),
  P('/paie', 'Bulletins de paie', 'Liste des paies de l’entreprise avec leur statut.', ['paie', 'bulletin', 'bulletins', 'salaire', 'fiche de paie']),
  P('/paie/nouveau', 'Créer un bulletin de paie', 'Calculer et enregistrer la paie d’un employé pour un mois.', ['paie', 'bulletin', 'creer', 'calculer', 'faire la paie', 'salaire']),
  P('/paie/masse', 'Paie en masse', 'Générer la paie de plusieurs employés en une seule opération.', ['paie', 'masse', 'tous', 'plusieurs', 'generer']),
  P('/paie/manuel', 'Paie manuelle', 'Saisir une paie à la main lorsque le calcul automatique ne convient pas.', ['paie', 'manuelle', 'manuel', 'saisir']),
  P('/paie/simulateur', 'Simulateur de paie', 'Tester un salaire et voir les retenues et le net sans créer de bulletin.', ['simulateur', 'simuler', 'simulation', 'net', 'brut', 'retenues']),
  P('/paie/comptabilite', 'Comptabilité de la paie', 'Écritures comptables issues des paies.', ['comptabilite', 'ecritures', 'compta', 'journal']),
  P('/paie/impayes', 'Paies impayées', 'Suivre les bulletins calculés mais pas encore payés.', ['impaye', 'impayes', 'payer', 'paiement', 'virement']),
  P('/ma-paie', 'Ma paie', 'Espace de l’employé pour consulter ses propres bulletins.', ['ma paie', 'mes bulletins', 'mon bulletin', 'employe']),
  P('/primes/attribuer', 'Attribuer des primes', 'Donner une prime à un ou plusieurs employés.', ['prime', 'primes', 'attribuer', 'bonus', 'indemnite']),
  P('/conges/nouveau', 'Demander un congé', 'Déposer une demande de congé.', ['conge', 'demander', 'demande', 'poser', 'vacances']),
  P('/conges/gestion', 'Gérer les congés', 'Valider ou refuser les demandes de congé.', ['conge', 'valider', 'approuver', 'refuser', 'gestion']),
  P('/conges/planning', 'Planning des congés', 'Vue d’ensemble des congés pour organiser les absences de l’équipe.', ['planning', 'planifier', 'organiser', 'conge', 'equipe', 'chevauchement']),
  P('/conges/calendrier', 'Calendrier des congés', 'Calendrier des congés de l’entreprise.', ['calendrier', 'conge', 'date', 'jour ferie']),
  P('/conges/programme', 'Programme de congés', 'Programmer à l’avance les congés annuels.', ['programme', 'programmer', 'annuel', 'conge']),
  P('/conges/soldes', 'Soldes de congé', 'Jours de congé acquis, pris et restants par employé.', ['solde', 'soldes', 'jours restants', 'acquis', 'conge']),
  P('/conges/provision', 'Provision de congés', 'Suivi financier de ce que l’entreprise doit pour les congés non pris.', ['provision', 'conges payes', 'indemnite de conge', 'dette']),
  P('/conges/historique', 'Historique des congés', 'Congés passés.', ['historique', 'passe', 'conge']),
  P('/conges/analyse', 'Analyse des congés', 'Statistiques sur les congés.', ['analyse', 'statistiques', 'conge']),
  P('/conges/mon-espace', 'Mes congés', 'Espace de l’employé : ses soldes et ses demandes.', ['mes conges', 'mon solde', 'employe']),
  P('/presences', 'Présences', 'Accueil du suivi des présences.', ['presence', 'presences', 'pointage']),
  P('/presences/dashboard', 'Tableau de bord des présences', 'Vue du jour : présents, absents, retards.', ['presence', 'tableau de bord', 'aujourd hui', 'retard']),
  P('/presences/pointage', 'Pointage', 'Pointer l’arrivée et le départ.', ['pointage', 'pointer', 'arrivee', 'depart', 'badge']),
  P('/presences/pointage-manuel', 'Pointage manuel', 'Corriger ou saisir un pointage à la main.', ['pointage', 'manuel', 'corriger', 'oubli']),
  P('/presences/resume', 'Résumés de présence', 'Résumé mensuel par employé : jours présents, absences, retards, heures.', ['resume', 'mensuel', 'presence', 'retard', 'heures', 'absences']),
  P('/presences/shifts', 'Horaires de travail', 'Définir les horaires et équipes.', ['shift', 'shifts', 'horaire', 'horaires', 'equipe', 'planning']),
  P('/presences/tablettes', 'Tablettes de pointage', 'Gérer les tablettes utilisées pour pointer.', ['tablette', 'tablettes', 'kiosque', 'pointage']),
  P('/presences/synchronisation', 'Synchronisation des pointeuses', 'Relier et synchroniser les appareils de pointage.', ['synchronisation', 'pointeuse', 'appareil']),
  P('/presences/absences', 'Absences', 'Déclarer et suivre les absences des employés.', ['absence', 'absences', 'absent', 'justifier']),
  P('/presences/absences/nouveau', 'Déclarer une absence', 'Enregistrer une demande d’absence.', ['absence', 'declarer', 'nouvelle']),
  P('/presences/absences/rapport', 'Rapport des absences', 'Rapport des absences de la période.', ['rapport', 'absences']),
  P('/presences/permissions', 'Permissions', 'Sorties et autorisations ponctuelles pendant le travail.', ['permission', 'permissions', 'sortie', 'autorisation']),
  P('/presences/permissions/nouveau', 'Demander une permission', 'Déposer une demande de permission.', ['permission', 'demander']),
  P('/presences/permissions/validations', 'Valider les permissions', 'Approuver ou refuser les permissions.', ['permission', 'valider', 'approuver']),
  P('/loans', 'Prêts et avances', 'Gérer les prêts et avances sur salaire.', ['pret', 'prets', 'avance', 'avances', 'credit', 'remboursement']),
  P('/loans/nouveau', 'Nouveau prêt', 'Enregistrer un prêt ou une avance pour un employé.', ['pret', 'avance', 'nouveau', 'creer']),
  P('/loans/validations', 'Valider les prêts', 'Approuver ou refuser les demandes de prêt et d’avance.', ['pret', 'valider', 'approuver']),
  P('/loans/suivi-dettes', 'Suivi des dettes', 'Suivre ce que chaque employé reste devoir.', ['dette', 'dettes', 'suivi', 'remboursement', 'solde']),
  P('/contrats', 'Contrats', 'Contrats de travail des employés.', ['contrat', 'contrats', 'cdi', 'cdd']),
  P('/contrats/modeles/generer', 'Générer un contrat', 'Choisir un modèle et un employé pour produire le contrat en PDF ; les informations se remplissent seules.', ['contrat', 'generer', 'creer contrat', 'faire contrat', 'produire']),
  P('/contrats/modeles', 'Modèles de contrat', 'Copier une base proposée par Konza RH, importer ou adapter ses propres modèles de contrat.', ['modele', 'modele contrat', 'dupliquer', 'importer contrat', 'base konza']),
  P('/contrats/employe/:employeeId', 'Historique des contrats d’un employé', 'Chaîne de contrats, renouvellements, avenants, exports PDF et Word et historique d’audit.', ['historique contrat', 'avenant', 'renouvellement', 'chaine contrat', 'tracabilite']),
  P('/contrats/rupture', 'Rupture de contrat', 'Gérer une fin de contrat (licenciement, démission, fin de CDD…).', ['rupture', 'licenciement', 'demission', 'fin de contrat', 'preavis', 'solde de tout compte']),
  P('/documents', 'Documents', 'Documents de l’entreprise et des employés.', ['document', 'documents', 'attestation']),
  P('/documents/generate', 'Générer un document', 'Produire une attestation ou un autre document.', ['attestation', 'generer', 'document', 'certificat']),
  P('/cnss-declaration', 'Déclaration CNSS', 'Préparer la déclaration CNSS de la période.', ['cnss', 'declaration', 'cotisations', 'caisse']),
  P('/recrutement', 'Recrutement', 'Offres d’emploi et candidats.', ['recrutement', 'offre', 'candidat', 'embauche', 'emploi']),
  P('/recrutement/pipeline', 'Pipeline de recrutement', 'Suivre les candidats par étape.', ['pipeline', 'candidat', 'etape']),
  P('/recrutement/entretiens', 'Entretiens', 'Planifier et suivre les entretiens.', ['entretien', 'entretiens', 'candidat']),
  P('/performance', 'Performance', 'Évaluation et suivi de la performance.', ['performance', 'evaluation', 'objectif']),
  P('/performance/objectifs', 'Objectifs', 'Définir et suivre les objectifs.', ['objectif', 'objectifs']),
  P('/performance/cycles', 'Cycles d’évaluation', 'Organiser les campagnes d’évaluation.', ['cycle', 'evaluation', 'campagne']),
  P('/formation', 'Formation', 'Suivi des formations.', ['formation', 'formations', 'stage']),
  P('/materiel', 'Matériel', 'Matériel remis aux employés.', ['materiel', 'equipement', 'ordinateur', 'telephone']),
  P('/rapports', 'Rapports', 'Tous les rapports RH et de paie.', ['rapport', 'rapports', 'statistiques', 'export']),
  P('/rapports/effectifs', 'Rapport des effectifs', 'Effectif et répartition.', ['effectif', 'effectifs', 'rapport']),
  P('/rapports/analyse-paie', 'Analyse de la paie', 'Évolution et analyse de la masse salariale.', ['analyse', 'masse salariale', 'paie', 'rapport']),
  P('/rapports/journal-paie', 'Journal de paie', 'Journal détaillé des paies.', ['journal', 'paie', 'rapport']),
  P('/rapports/das-declaration', 'Déclaration DAS', 'Données pour la déclaration annuelle des salaires.', ['das', 'declaration', 'annuelle']),
  P('/rapports/its-bnc', 'ITS et BNC', 'État de l’impôt sur les traitements et salaires.', ['its', 'impot', 'bnc', 'taxe']),
  P('/parametres/entreprise', 'Paramètres de l’entreprise', 'Informations de l’entreprise, convention collective et règles de congé.', ['entreprise', 'parametres', 'convention', 'societe', 'anciennete']),
  P('/parametres/paie', 'Paramètres de paie', 'Règles de calcul de la paie.', ['parametres', 'paie', 'regles']),
  P('/parametres/primes', 'Catalogue des primes', 'Créer et gérer les primes et indemnités proposées par l’entreprise, avant de les attribuer.', ['prime', 'indemnite', 'catalogue', 'creer prime', 'nouvelle prime', 'imposable', 'parametres']),
  P('/parametres/taxes', 'Taxes de l’entreprise', 'Voir les taxes légales et créer les taxes propres à l’entreprise (par exemple CAMU ou taxe régionale).', ['taxe', 'cotisation', 'camu', 'regionale', 'regional', 'taxe regionale', 'parametres', 'configurer taxe']),
  P('/parametres/users', 'Utilisateurs', 'Inviter et gérer les utilisateurs et leurs rôles.', ['utilisateur', 'utilisateurs', 'inviter', 'role', 'acces', 'droits']),
  P('/parametres/departements', 'Départements', 'Organiser les départements.', ['departement', 'departements', 'service']),
  P('/parametres/circuits', 'Circuits de validation', 'Définir qui valide les demandes.', ['circuit', 'validation', 'workflow', 'approbation']),
  P('/parametres/bulletin', 'Modèle de bulletin', 'Personnaliser l’aspect du bulletin de paie.', ['bulletin', 'modele', 'logo', 'personnaliser']),
  P('/parametres/subscription', 'Abonnement', 'Abonnement et facturation de l’entreprise.', ['abonnement', 'facture', 'plan', 'paiement']),
  P('/outils/calcul-cnss-congo', 'Calculateur CNSS', 'Outil public pour estimer les cotisations CNSS.', ['calcul', 'cnss', 'outil']),
  P('/outils/calcul-its-congo', 'Calculateur ITS', 'Outil public pour estimer l’ITS.', ['calcul', 'its', 'impot', 'outil']),
  P('/outils/calcul-heures-supplementaires-congo', 'Calculateur d’heures supplémentaires', 'Outil public pour estimer la rémunération des heures supplémentaires.', ['heures supplementaires', 'calcul', 'outil']),
  P('/demandes', 'Demandes', 'Demandes à traiter.', ['demande', 'demandes', 'validation']),
  P('/messages', 'Messages et support', 'Contacter le support.', ['message', 'support', 'aide', 'contact']),
];

import { score, tokenSet } from './match';
/** Les pages les plus proches de la question (3 au plus). */
export function pagesFor(message: string, max = 3): AppPage[] {
  const q = tokenSet(message);
  return APP_MAP.map((p) => ({
    p,
    score: score(q, p.keywords),
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.p);
}