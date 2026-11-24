/**
 * Parcours de démarrage : l'ordre recommandé pour bien configurer une entreprise, du compte au
 * premier bulletin. Les libellés cités viennent des écrans réels (voir screens.ts).
 */
export interface JourneyStep {
  step: number;
  action: string;
  page: string;
  details: string;
}
export const START_JOURNEY: JourneyStep[] = [
  { step: 1, action: 'Vérifier les informations de l’entreprise', page: '/parametres/entreprise', details: 'Elles sont déjà renseignées à l’inscription ; on peut les vérifier ou les modifier à tout moment (informations légales et bancaires, jour de clôture des bulletins, jour de paiement des salaires, jours ouvrés par mois).' },
  { step: 2, action: 'Créer le catalogue des primes et indemnités', page: '/parametres/primes', details: 'Bouton « Nouvelle prime » (ou « Créer ma première prime ») : nom, nature fiscale (imposable + CNSS, imposable uniquement, indemnité nette), mode de calcul (montant fixe ou %, quantité libre), montant par défaut, fréquence (récurrente ou ponctuelle). La nature fiscale décide de ce qui est imposé : à choisir avec soin.' },
  { step: 3, action: 'Configurer les taxes de l’entreprise', page: '/parametres/taxes', details: 'Les taxes légales (CNSS, TUS, ITS) sont affichées et non modifiables. Pour une taxe propre à l’entreprise (par exemple la CAMU ou une taxe régionale), bouton « Nouvelle taxe » : nom, code, base de calcul (salaire brut, SBT, RNI ou montant fixe), taux ou montant salarié et patronal, plafond éventuel, types de contrat concernés, et si elle est récurrente ou ponctuelle (dans ce cas, le mois et l’année).' },
  { step: 4, action: 'Ajouter les employés', page: '/employes/nouveau', details: 'Soit « Créer un dossier » pour un employé à la fois, soit « Importer une équipe » avec « Choisir un fichier Excel » : étapes Fichier, Colonnes (correspondance des colonnes), Validation, Résultat.' },
  { step: 5, action: 'Attribuer les primes à chaque employé', page: '/primes/attribuer', details: 'Nécessaire si les primes ne figuraient pas déjà dans le fichier importé. Choisir un employé puis « Attribuer une prime » : prime du catalogue, mois et année de versement, fréquence. Possible aussi depuis la fiche de l’employé.' },
  { step: 6, action: 'Créer un premier bulletin de test', page: '/paie/nouveau', details: 'Choisir la période de paie (mois et année), rechercher l’employé, vérifier les gains et les retenues, puis enregistrer. Pour plusieurs employés d’un coup : /paie/masse. Le simulateur /paie/simulateur permet de tester sans créer de bulletin.' },
];
const strip = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
const TRIGGERS = ['commencer', 'demarrer', 'debuter', 'premiere etape', 'premiers pas', 'par ou', 'apres avoir cree', 'apres la creation', 'configurer', 'configuration', 'parcours', 'mise en place', 'premier bulletin', 'que dois je faire', 'quoi faire', 'onboarding', 'nouveau compte', 'tout premier'];
export function journeyFor(message: string): JourneyStep[] | null {
  const q = ` ${strip(message)} `;
  return TRIGGERS.some((t) => q.includes(` ${t} `) || q.includes(t + ' ')) ? START_JOURNEY : null;
}