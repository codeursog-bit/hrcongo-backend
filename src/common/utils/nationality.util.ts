// ============================================================================
// 📁 common/utils/nationality.util.ts
// Normalise toute saisie de nationalité (code, accents, casse, variantes FR/EN)
// vers un libellé canonique unique en français, pour que les filtres et
// rapports ne se retrouvent jamais avec deux valeurs différentes ("congo" /
// "Congo" / "CG") qui désignent en réalité le même pays.
// ============================================================================

export interface NationalityEntry {
  code: string; // Code court (proche ISO 3166-1 alpha-2, à usage interne/rapports)
  label: string; // Libellé canonique affiché et stocké en base
  aliases: string[]; // Variantes reconnues (déjà normalisées : minuscules, sans accents)
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normKey(s: string): string {
  return stripAccents(s.trim().toLowerCase())
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ');
}

// Liste volontairement centrée sur le contexte Congo-Brazzaville (CEMAC/Afrique)
// + principaux pays internationaux rencontrés en RH. Extensible sans risque :
// ajouter une entrée ne casse rien, seule la présence dans NATIONALITIES compte.
export const NATIONALITIES: NationalityEntry[] = [
  {
    code: 'CG',
    label: 'Congo',
    aliases: [
      'congo',
      'cg',
      'republique du congo',
      'congo-brazzaville',
      'congo brazzaville',
      'congolais',
      'congolaise',
    ],
  },
  {
    code: 'CD',
    label: 'République Démocratique du Congo',
    aliases: [
      'rdc',
      'cd',
      'congo kinshasa',
      'congo-kinshasa',
      'republique democratique du congo',
      'rd congo',
    ],
  },
  {
    code: 'CM',
    label: 'Cameroun',
    aliases: ['cameroun', 'cm', 'cameroon', 'camerounais', 'camerounaise'],
  },
  {
    code: 'GA',
    label: 'Gabon',
    aliases: ['gabon', 'ga', 'gabonais', 'gabonaise'],
  },
  {
    code: 'TD',
    label: 'Tchad',
    aliases: ['tchad', 'td', 'chad', 'tchadien', 'tchadienne'],
  },
  {
    code: 'CF',
    label: 'République Centrafricaine',
    aliases: [
      'rca',
      'cf',
      'centrafrique',
      'republique centrafricaine',
      'centrafricain',
      'centrafricaine',
    ],
  },
  {
    code: 'GQ',
    label: 'Guinée Équatoriale',
    aliases: ['guinee equatoriale', 'gq', 'equatorial guinea'],
  },
  {
    code: 'AO',
    label: 'Angola',
    aliases: ['angola', 'ao', 'angolais', 'angolaise'],
  },
  {
    code: 'BJ',
    label: 'Bénin',
    aliases: ['benin', 'bj', 'beninois', 'beninoise'],
  },
  {
    code: 'CI',
    label: "Côte d'Ivoire",
    aliases: ["cote d'ivoire", 'cote divoire', 'ci', 'ivoirien', 'ivoirienne'],
  },
  {
    code: 'SN',
    label: 'Sénégal',
    aliases: ['senegal', 'sn', 'senegalais', 'senegalaise'],
  },
  { code: 'ML', label: 'Mali', aliases: ['mali', 'ml', 'malien', 'malienne'] },
  {
    code: 'TG',
    label: 'Togo',
    aliases: ['togo', 'tg', 'togolais', 'togolaise'],
  },
  {
    code: 'BF',
    label: 'Burkina Faso',
    aliases: ['burkina faso', 'bf', 'burkinabe'],
  },
  {
    code: 'NE',
    label: 'Niger',
    aliases: ['niger', 'ne', 'nigerien', 'nigerienne'],
  },
  {
    code: 'GN',
    label: 'Guinée',
    aliases: ['guinee', 'gn', 'guineen', 'guineenne'],
  },
  { code: 'NG', label: 'Nigeria', aliases: ['nigeria', 'ng', 'nigerian'] },
  {
    code: 'MR',
    label: 'Mauritanie',
    aliases: ['mauritanie', 'mr', 'mauritanien', 'mauritanienne'],
  },
  {
    code: 'MA',
    label: 'Maroc',
    aliases: ['maroc', 'ma', 'morocco', 'marocain', 'marocaine'],
  },
  {
    code: 'DZ',
    label: 'Algérie',
    aliases: ['algerie', 'dz', 'algeria', 'algerien', 'algerienne'],
  },
  {
    code: 'TN',
    label: 'Tunisie',
    aliases: ['tunisie', 'tn', 'tunisia', 'tunisien', 'tunisienne'],
  },
  {
    code: 'EG',
    label: 'Égypte',
    aliases: ['egypte', 'eg', 'egypt', 'egyptien', 'egyptienne'],
  },
  {
    code: 'ZA',
    label: 'Afrique du Sud',
    aliases: ['afrique du sud', 'za', 'south africa'],
  },
  {
    code: 'RW',
    label: 'Rwanda',
    aliases: ['rwanda', 'rw', 'rwandais', 'rwandaise'],
  },
  {
    code: 'BI',
    label: 'Burundi',
    aliases: ['burundi', 'bi', 'burundais', 'burundaise'],
  },
  { code: 'KE', label: 'Kenya', aliases: ['kenya', 'ke', 'kenyan'] },
  {
    code: 'GH',
    label: 'Ghana',
    aliases: ['ghana', 'gh', 'ghaneen', 'ghaneenne'],
  },
  {
    code: 'MG',
    label: 'Madagascar',
    aliases: ['madagascar', 'mg', 'malgache'],
  },
  {
    code: 'FR',
    label: 'France',
    aliases: ['france', 'fr', 'francais', 'francaise'],
  },
  {
    code: 'BE',
    label: 'Belgique',
    aliases: ['belgique', 'be', 'belgium', 'belge'],
  },
  {
    code: 'CH',
    label: 'Suisse',
    aliases: ['suisse', 'ch', 'switzerland', 'suisse(sse)'],
  },
  {
    code: 'CA',
    label: 'Canada',
    aliases: ['canada', 'ca', 'canadien', 'canadienne'],
  },
  {
    code: 'US',
    label: 'États-Unis',
    aliases: [
      'etats-unis',
      'etats unis',
      'us',
      'usa',
      'united states',
      'americain',
      'americaine',
    ],
  },
  {
    code: 'GB',
    label: 'Royaume-Uni',
    aliases: [
      'royaume-uni',
      'royaume uni',
      'gb',
      'uk',
      'united kingdom',
      'angleterre',
    ],
  },
  {
    code: 'CN',
    label: 'Chine',
    aliases: ['chine', 'cn', 'china', 'chinois', 'chinoise'],
  },
  {
    code: 'IN',
    label: 'Inde',
    aliases: ['inde', 'in', 'india', 'indien', 'indienne'],
  },
  {
    code: 'LB',
    label: 'Liban',
    aliases: ['liban', 'lb', 'lebanon', 'libanais', 'libanaise'],
  },
  {
    code: 'TR',
    label: 'Turquie',
    aliases: ['turquie', 'tr', 'turkey', 'turc', 'turque'],
  },
  {
    code: 'PT',
    label: 'Portugal',
    aliases: ['portugal', 'pt', 'portugais', 'portugaise'],
  },
  {
    code: 'IT',
    label: 'Italie',
    aliases: ['italie', 'it', 'italy', 'italien', 'italienne'],
  },
];

const ALIAS_INDEX: Map<string, NationalityEntry> = new Map();
for (const entry of NATIONALITIES) {
  for (const alias of entry.aliases) ALIAS_INDEX.set(alias, entry);
  ALIAS_INDEX.set(normKey(entry.label), entry);
}

/**
 * Normalise une saisie de nationalité vers le libellé canonique connu.
 * Si aucune correspondance n'est trouvée, renvoie la saisie nettoyée (trim +
 * majuscule initiale par mot) plutôt que de perdre l'information — pour un
 * pays qui n'est pas encore dans la liste, on garde ce que l'utilisateur a
 * tapé, propre, sans le rejeter.
 */
export function normalizeNationality(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const key = normKey(raw);
  const match = ALIAS_INDEX.get(key);
  if (match) return match.label;

  // Repli : nettoyage simple (capitalise chaque mot), aucune donnée perdue
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Retrouve le code court (ex: "CG") à partir d'un libellé déjà normalisé ou brut. */
export function getNationalityCode(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const match = ALIAS_INDEX.get(normKey(raw));
  return match ? match.code : null;
}
