// ============================================================================
// 📁 src/contract-templates/contract-variables.catalog.ts
//
// CATALOGUE CENTRAL des variables disponibles dans les modèles de contrat.
// Chaque variable a UNE source :
//   EMPLOYEE : fiche employé            COMPANY : fiche entreprise
//   LEGAL    : paramètres légaux (taux CNSS…)    COMPUTED : calcul de paie (brut, net…)
//   MANUAL   : saisie à la génération (durée, date de début…)
//   CUSTOM   : variable ajoutée par l'entreprise (sigle, NIU, capital…)
//
// Le client ne « configure » rien : il clique la variable dans l'éditeur, la
// source est déjà branchée. Ajouter une variable = ajouter une ligne ici.
// ============================================================================

export type VarSource = 'EMPLOYEE' | 'COMPANY' | 'LEGAL' | 'COMPUTED' | 'MANUAL' | 'CUSTOM';
export type VarType = 'text' | 'date' | 'money' | 'number' | 'percent';

export interface VariableDef {
  key: string;
  label: string;
  group: string; // regroupement dans le panneau de l'éditeur
  source: VarSource;
  type: VarType;
  example: string; // valeur d'exemple pour l'aperçu
  /** MANUAL uniquement : valeur proposée par défaut (ex. nb d'exemplaires) */
  manualDefault?: string;
}

const E = (key: string, label: string, type: VarType, example: string, group = 'Salarié'): VariableDef =>
  ({ key, label, group, source: 'EMPLOYEE', type, example });
const C = (key: string, label: string, type: VarType, example: string, group = 'Employeur'): VariableDef =>
  ({ key, label, group, source: 'COMPANY', type, example });
const M = (key: string, label: string, type: VarType, example: string, manualDefault?: string, group = 'À saisir à la génération'): VariableDef =>
  ({ key, label, group, source: 'MANUAL', type, example, manualDefault });

export const VARIABLE_CATALOG: VariableDef[] = [
  // ── Salarié ───────────────────────────────────────────────────────────────
  E('civilite', 'Civilité (Monsieur/Madame)', 'text', 'Monsieur'),
  E('nom', 'Nom', 'text', 'MOUKOKO'),
  E('prenom', 'Prénom', 'text', 'Jean'),
  E('nom_complet', 'Nom et prénom', 'text', 'MOUKOKO Jean'),
  E('date_naissance', 'Date de naissance', 'date', '12 mars 1990'),
  E('lieu_naissance', 'Lieu de naissance', 'text', 'Brazzaville'),
  E('nationalite', 'Nationalité', 'text', 'congolaise'),
  E('cni', 'N° CNI / pièce d\'identité', 'text', '1234567890'),
  E('situation_matrimoniale', 'Situation matrimoniale', 'text', 'Célibataire'),
  E('nombre_enfants', 'Nombre d\'enfants', 'number', '2'),
  E('nom_pere', 'Nom du père', 'text', 'MOUKOKO Paul'),
  E('nom_mere', 'Nom de la mère', 'text', 'NGOMA Marie'),
  E('adresse_salarie', 'Adresse du salarié', 'text', '12 rue des Palmiers, Brazzaville'),
  E('telephone_salarie', 'Téléphone du salarié', 'text', '06 123 45 67'),
  E('matricule', 'Matricule', 'text', 'EMP-0042'),
  E('date_embauche', 'Date d\'embauche', 'date', '01 janvier 2026', 'Emploi'),
  E('poste', 'Poste / fonction', 'text', 'Comptable', 'Emploi'),
  E('categorie', 'Catégorie professionnelle', 'text', 'Catégorie 5', 'Emploi'),
  E('echelon', 'Échelon', 'text', 'A', 'Emploi'),
  E('departement', 'Service / département', 'text', 'Comptabilité', 'Emploi'),
  E('lieu_travail', 'Lieu de travail (ville)', 'text', 'Brazzaville', 'Emploi'),

  // ── Employeur ─────────────────────────────────────────────────────────────
  C('nom_entreprise', 'Nom de l\'entreprise', 'text', 'ENTREPRISE EXEMPLE SARL'),
  C('raison_sociale', 'Raison sociale', 'text', 'ENTREPRISE EXEMPLE SARL'),
  C('forme_juridique', 'Forme juridique', 'text', 'Société Anonyme'),
  C('sigle', 'Sigle (abréviation)', 'text', 'PCL'),
  C('niu', 'NIU (n° d\'identification unique)', 'text', 'M25000000755109R'),
  C('capital_social', 'Capital social', 'text', '100 000 000 FCFA'),
  C('rccm', 'N° RCCM', 'text', 'CG-BZV-01-2025-B15-00025'),
  C('adresse_entreprise', 'Adresse du siège', 'text', 'Brazzaville, Centre-ville'),
  C('ville_entreprise', 'Ville de l\'entreprise', 'text', 'Brazzaville'),
  C('telephone_entreprise', 'Téléphone de l\'entreprise', 'text', '05 000 00 00'),
  C('representant', 'Représentant légal', 'text', 'DIARRA Moussa'),
  C('fonction_representant', 'Fonction du représentant', 'text', 'Administrateur Général'),
  C('numero_cnss_employeur', 'N° CNSS employeur', 'text', '123456'),
  C('convention_collective', 'Convention collective', 'text', 'Convention collective du commerce'),

  // ── Rémunération (calculée par le moteur de paie) ─────────────────────────
  { key: 'salaire_base', label: 'Salaire de base', group: 'Rémunération', source: 'COMPUTED', type: 'money', example: '350 000' },
  { key: 'sursalaire', label: 'Sursalaire', group: 'Rémunération', source: 'COMPUTED', type: 'money', example: '0' },
  { key: 'primes_total', label: 'Total des primes', group: 'Rémunération', source: 'COMPUTED', type: 'money', example: '25 000' },
  { key: 'indemnite_transport', label: 'Indemnité de transport', group: 'Rémunération', source: 'COMPUTED', type: 'money', example: '15 000' },
  { key: 'salaire_brut', label: 'Salaire brut', group: 'Rémunération', source: 'COMPUTED', type: 'money', example: '375 000' },
  { key: 'cnss_salarie', label: 'Retenue CNSS salarié', group: 'Rémunération', source: 'COMPUTED', type: 'money', example: '15 000' },
  { key: 'its', label: 'ITS', group: 'Rémunération', source: 'COMPUTED', type: 'money', example: '12 000' },
  { key: 'tol', label: 'TOL', group: 'Rémunération', source: 'COMPUTED', type: 'money', example: '5 000' },
  { key: 'autres_taxes', label: 'Autres taxes (CAMU…)', group: 'Rémunération', source: 'COMPUTED', type: 'money', example: '0' },
  { key: 'salaire_net', label: 'Net à payer', group: 'Rémunération', source: 'COMPUTED', type: 'money', example: '343 000' },
  { key: 'salaire_net_lettres', label: 'Net à payer (en lettres)', group: 'Rémunération', source: 'COMPUTED', type: 'text', example: 'trois cent quarante-trois mille' },

  // ── Taux légaux (paramètres légaux de l'application) ──────────────────────
  { key: 'taux_cnss_salarie', label: 'Taux CNSS salarié (%)', group: 'Taux légaux', source: 'LEGAL', type: 'percent', example: '4' },
  { key: 'taux_cnss_employeur', label: 'Taux CNSS employeur (%)', group: 'Taux légaux', source: 'LEGAL', type: 'percent', example: '20,28' },

  // ── À saisir à la génération (n'existent pas en base) ─────────────────────
  M('duree_mois', 'Durée du contrat (mois)', 'number', '12'),
  M('date_debut', 'Date de début', 'date', '01 janvier 2026'),
  M('date_fin', 'Date de fin', 'date', '31 décembre 2026'),
  M('periode_essai', 'Période d\'essai (ex. 3 mois)', 'text', '3 mois'),
  M('lieu_emploi', 'Lieu de l\'emploi', 'text', 'Brazzaville'),
  M('titulaire_de', 'Titulaire de (diplôme)', 'text', 'Licence en comptabilité'),
  M('date_certificat_medical', 'Date du certificat médical', 'date', '10 décembre 2025'),
  M('nombre_exemplaires', 'Nombre d\'exemplaires', 'number', '3', '3'),
  M('nombre_pages', 'Nombre de pages', 'number', '6'),
  M('lieu_signature', 'Fait à (lieu)', 'text', 'Brazzaville'),
  M('date_signature', 'Date de signature', 'date', '02 janvier 2026'),
  // Stage / prestation
  M('etablissement_enseignement', 'Établissement d\'enseignement', 'text', 'Université Marien Ngouabi'),
  M('maitre_de_stage', 'Maître de stage (tuteur)', 'text', 'M. NGOMA Paul'),
  M('gratification_mensuelle', 'Gratification mensuelle (FCFA)', 'text', '50 000'),
  M('objet_mission', 'Objet de la mission', 'text', 'Audit du système d\'information'),
  M('montant_honoraires', 'Montant des honoraires (FCFA)', 'text', '300 000 par mois'),
  M('duree_preavis', 'Durée du préavis', 'text', '30 jours'),
];

export const CATALOG_BY_KEY: Record<string, VariableDef> = Object.fromEntries(
  VARIABLE_CATALOG.map((v) => [v.key, v]),
);

/** Libellé des conventions collectives (code stocké sur l'entreprise → texte). */
export const CONVENTION_LABELS: Record<string, string> = {
  GENERALE: 'Convention collective générale',
  BTP: 'Convention collective du Bâtiment, des Travaux Publics et activités connexes',
  COMMERCE: 'Convention collective du commerce',
  INDUSTRIE: 'Convention collective de l\'industrie et de la métallurgie',
  PETROLE: 'Convention collective des entreprises de services pétroliers',
  TRANSPORT: 'Convention collective des auxiliaires de transport et assimilés',
  MINE: 'Convention collective des mines (prospection, recherche et exploitation)',
  HOTELLERIE: 'Convention collective de l\'hôtellerie et du catering',
  PHARMACIE: 'Convention collective des officines de pharmacie',
  BANQUE: 'Convention collective des banques, assurances et assureur-conseils',
  NTIC: 'Convention collective des NTIC',
};

/** Clé valide pour une variable personnalisée : minuscules, chiffres, underscore. */
export const CUSTOM_KEY_RE = /^[a-z][a-z0-9_]{1,59}$/;

/** Nombre → lettres (français), jusqu'aux milliards — pour « net à payer en lettres ». */
export function numberToFrench(n: number): string {
  n = Math.round(n);
  if (n === 0) return 'zéro';
  const u = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const t = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];
  const below100 = (x: number, plural = true): string => {
    if (x < 20) return u[x];
    const d = Math.floor(x / 10), r = x % 10;
    if (d === 7 || d === 9) {
      const base = t[d];
      const rest = 10 + r;
      return base + (r === 1 && d === 7 ? ' et ' : '-') + u[rest];
    }
    if (r === 0) return t[d] + (d === 8 && plural ? 's' : '');
    return t[d] + (r === 1 && d !== 8 ? ' et ' : '-') + u[r];
  };
  const below1000 = (x: number, plural = true): string => {
    const c = Math.floor(x / 100), r = x % 100;
    let s = '';
    if (c > 0) s += (c > 1 ? u[c] + ' ' : '') + 'cent' + (c > 1 && r === 0 && plural ? 's' : '');
    if (r > 0) s += (s ? ' ' : '') + below100(r, plural);
    return s;
  };
  const parts: string[] = [];
  const billions = Math.floor(n / 1e9);
  const millions = Math.floor((n % 1e9) / 1e6);
  const thousands = Math.floor((n % 1e6) / 1e3);
  const rest = n % 1000;
  if (billions) parts.push(below1000(billions) + ' milliard' + (billions > 1 ? 's' : ''));
  if (millions) parts.push(below1000(millions) + ' million' + (millions > 1 ? 's' : ''));
  if (thousands) parts.push((thousands === 1 ? '' : below1000(thousands, false) + ' ') + 'mille');
  if (rest) parts.push(below1000(rest));
  return parts.join(' ').trim();
}