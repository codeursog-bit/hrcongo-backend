// ============================================================================
// export-cnss-template.ts
// Remplit les templates officiels CNSS Congo sans modifier leur structure.
// Les fichiers templates sont stockés dans : src/cnss-declaration/templates/
//   - Model_Declaration_Mensuelle_CNSS.xlsx
//   - Model_Declaration_Mensuelle_CNSS_TUS.xlsx
//   - Model_Declaration_Globale_Cotisation.docx
//
// RÈGLE ABSOLUE : on ne touche à rien dans le template (colonnes, lignes,
// formatage, couleurs, feuilles annexes, réglages d'impression). On insère
// uniquement les valeurs, à partir de la ligne 2, dans la feuille de données.
//
// ⚠️ HISTORIQUE — pourquoi pas ExcelJS pour le xlsx (DNMS/TUS) :
// La version précédente ouvrait le classeur avec ExcelJS (`wb.xlsx.readFile`
// puis `wb.xlsx.writeBuffer`). Problème constaté : ExcelJS ne fait pas un
// vrai patch du fichier — il le parse entièrement dans son propre modèle
// objet puis RÉGÉNÈRE un .xlsx neuf à partir de ce modèle. Tout ce que ce
// modèle ne représente pas est perdu silencieusement à la régénération
// (constaté ici : xl/printerSettings/printerSettings1.bin et son
// xl/worksheets/_rels/sheet2.xml.rels disparaissaient à chaque export).
// Résultat : le fichier de sortie n'était plus le fichier fourni par la
// CNSS, mais une reconstruction — exactement ce qu'on veut éviter.
//
// Nouvelle approche : on ouvre le .xlsx comme une simple archive zip
// (PizZip, déjà une dépendance du projet pour le DGC en .docx) et on
// modifie directement le XML de la feuille de données
// (xl/worksheets/sheet1.xml) pour y insérer les lignes. Tous les autres
// fichiers de l'archive (styles, printerSettings, feuilles annexes,
// docProps...) ne sont jamais touchés : ils ressortent identiques à
// l'octet près à ceux du fichier fourni.
//
// NB (docx) : le template DGC a été préparé une fois pour toutes en
// remplaçant chaque zone de saisie (└┴┴┴┴┴┘) par un jeton {{NOM_DU_CHAMP}}
// dans word/document.xml, sans toucher au reste de la mise en page.
// fillDgcTemplate se contente d'injecter les valeurs via docxtemplater
// (même logique de "patch minimal", donc inchangé ici).
// ============================================================================

import * as path from 'path';
import * as fs from 'fs';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

// Chemin vers les templates stockés dans le projet
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// ─── UTILITAIRES XML BAS NIVEAU ───────────────────────────────────────────

// Échappe les caractères spéciaux XML (obligatoire : noms/prénoms peuvent
// contenir des apostrophes, des "&", etc.)
function xmlEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type CellSpec = { col: string; kind: 'str' | 'num'; value: unknown };

// Cellule texte — écrite en "inline string" pour ne jamais avoir à toucher
// xl/sharedStrings.xml (un autre fichier de l'archive qu'on ne veut pas
// modifier).
function cellStr(ref: string, value: unknown): string {
  const v = value === null || value === undefined ? '' : String(value);
  if (v === '') return `<c r="${ref}" t="inlineStr"><is><t/></is></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
}

// Cellule numérique
function cellNum(ref: string, value: unknown): string {
  const n = Number(value ?? 0);
  return `<c r="${ref}"><v>${Number.isFinite(n) ? n : 0}</v></c>`;
}

function buildRowXml(rowNum: number, cells: CellSpec[]): string {
  const cellsXml = cells
    .map((c) => {
      const ref = `${c.col}${rowNum}`;
      return c.kind === 'num' ? cellNum(ref, c.value) : cellStr(ref, c.value);
    })
    .join('');
  return `<row r="${rowNum}" spans="1:${cells.length}">${cellsXml}</row>`;
}

// Insère les lignes de données dans le XML de la feuille, juste avant
// </sheetData>, et étend la <dimension> en conséquence. C'est la SEULE
// modification apportée au fichier — rien d'autre dans le XML n'est touché.
function patchSheetXml(
  sheetXml: string,
  employeeRows: CellSpec[][],
  lastCol: string,
): string {
  const startRow = 2; // ligne 1 = en-têtes officielles, jamais modifiée
  const rowsXml = employeeRows
    .map((cells, idx) => buildRowXml(startRow + idx, cells))
    .join('');

  if (!sheetXml.includes('</sheetData>')) {
    throw new Error('Structure inattendue : balise </sheetData> introuvable');
  }
  let newXml = sheetXml.replace('</sheetData>', rowsXml + '</sheetData>');

  const lastRow = startRow + employeeRows.length - 1;
  newXml = newXml.replace(
    /<dimension ref="[^"]*"\/>/,
    `<dimension ref="A1:${lastCol}${Math.max(lastRow, 1)}"/>`,
  );

  return newXml;
}

// Ouvre un .xlsx comme une archive zip, remplace uniquement le XML de
// xl/worksheets/sheet1.xml, et régénère l'archive — tous les autres
// fichiers internes ressortent identiques à l'octet près.
function patchXlsxSheet1(
  templatePath: string,
  employeeRows: CellSpec[][],
  lastCol: string,
): Buffer {
  const original = fs.readFileSync(templatePath);
  const zip = new PizZip(original);

  const sheetPath = 'xl/worksheets/sheet1.xml';
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) {
    throw new Error(`${sheetPath} introuvable dans le template`);
  }
  const sheetXml = sheetFile.asText();

  const newSheetXml = patchSheetXml(sheetXml, employeeRows, lastCol);
  zip.file(sheetPath, newSheetXml);

  return zip.generate({ type: 'nodebuffer' });
}

// ─── REMPLISSAGE TEMPLATE DNMS ────────────────────────────────────────────
// Structure template officiel (ligne 1 = en-têtes, données à partir ligne 2) :
// A=Matricule solde | B=N°CNSS | C=Noms | D=Post noms | E=Prénoms |
// F=Type (1/2) | G=Département | H=Période (jj/mm/aaaa) |
// I=Salaire brut global | J=Salaire soumis cotisation | K=Montant Cotisation
// L=Nb jours | M=Nb heures
export async function fillDnmsTemplate(
  employees: any[],
  month: number,
  year: number,
): Promise<Buffer> {
  const templatePath = path.join(
    TEMPLATES_DIR,
    'Model_Declaration_Mensuelle_CNSS.xlsx',
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template DNMS introuvable : ${templatePath}`);
  }

  const mm = String(month).padStart(2, '0');
  const periode = `01/${mm}/${year}`;

  const rows: CellSpec[][] = employees.map((emp) => [
    { col: 'A', kind: 'str', value: emp.matricule },
    { col: 'B', kind: 'str', value: emp.cnssNumber || '' },
    { col: 'C', kind: 'str', value: emp.nomFamille },
    { col: 'D', kind: 'str', value: emp.postNom || '' },
    { col: 'E', kind: 'str', value: emp.prenom },
    { col: 'F', kind: 'num', value: emp.typeWorker }, // 1 ou 2
    { col: 'G', kind: 'str', value: emp.departement || '' },
    { col: 'H', kind: 'str', value: periode },
    { col: 'I', kind: 'num', value: emp.brutGlobal },
    { col: 'J', kind: 'num', value: emp.salaireSOumisCotisation }, // min(brut, 1 200 000)
    { col: 'K', kind: 'num', value: emp.cotisationDeclaree }, // cnssSalarial 4%
    { col: 'L', kind: 'num', value: emp.nbrJoursTravailles },
    { col: 'M', kind: 'num', value: emp.nbrHeuresTravaillees },
  ]);

  return patchXlsxSheet1(templatePath, rows, 'M');
}

// ─── REMPLISSAGE TEMPLATE TUS ─────────────────────────────────────────────
// Structure template officiel (ligne 1 = en-têtes, données à partir ligne 2) :
// A=Matricule solde | B=N°CNSS | C=Noms | D=Post noms | E=Prénoms |
// F=Type (1/2) | G=Département | H=Période (jj/mm/aaaa) |
// I=Salaire brut global | J=Montant Déclaration TUS | K=Nb jours
export async function fillTusTemplate(
  employees: any[],
  month: number,
  year: number,
): Promise<Buffer> {
  const templatePath = path.join(
    TEMPLATES_DIR,
    'Model_Declaration_Mensuelle_CNSS_TUS.xlsx',
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template TUS introuvable : ${templatePath}`);
  }

  const mm = String(month).padStart(2, '0');
  const periode = `01/${mm}/${year}`;

  const rows: CellSpec[][] = employees.map((emp) => [
    { col: 'A', kind: 'str', value: emp.matricule },
    { col: 'B', kind: 'str', value: emp.cnssNumber || '' },
    { col: 'C', kind: 'str', value: emp.nomFamille },
    { col: 'D', kind: 'str', value: emp.postNom || '' },
    { col: 'E', kind: 'str', value: emp.prenom },
    { col: 'F', kind: 'num', value: emp.typeWorker },
    { col: 'G', kind: 'str', value: emp.departement || '' },
    { col: 'H', kind: 'str', value: periode },
    { col: 'I', kind: 'num', value: emp.brutGlobal },
    { col: 'J', kind: 'num', value: emp.tusTotal }, // 7,5% total lu depuis BDD
    { col: 'K', kind: 'num', value: emp.nbrJoursTravailles },
  ]);

  return patchXlsxSheet1(templatePath, rows, 'K');
}

// ─── REMPLISSAGE TEMPLATE DGC (Déclaration Globale de Cotisation) ────────
// Formulaire officiel CNSS (1 page recto + adresse/tél/acompte au verso —
// c'est le document officiel lui-même qui fait 2 pages, prévu pour une
// impression recto-verso sur UNE feuille physique ; ce n'est pas un bug).
//
// 🐛 CORRIGÉ (Aug 2026) — deux problèmes distincts :
//
// 1) Le template stocké jusqu'ici était une VERSION PÉRIMÉE du formulaire
//    CNSS : il affichait "TUS 3%" alors que le vrai formulaire actuel
//    affiche "TUS 5,475%". Remplacé par le fichier officiel à jour fourni
//    par l'utilisateur (même structure, taux corrigé).
//
// 2) Les zones à remplir sur ce formulaire sont des "cases" dessinées avec
//    des caractères Unicode de dessin de boîte (└┴┴┴┴┴┘). La préparation
//    précédente du template remplaçait TOUT le bloc └┴┴┴┴┴┘ par un simple
//    jeton {{CHAMP}} — donc une fois la valeur insérée, les cases
//    disparaissaient complètement (plus aucune case visible, juste le
//    texte qui flotte). Corrigé : chaque jeton est maintenant entouré par
//    le reste de sa case d'origine, et fillField() ci-dessous ne remplace
//    que le DÉBUT de la case avec la valeur, en gardant les cases
//    inutilisées à la fin (└┴┴┴┴┴┘ + "200000" → "200000┴┴┘" par ex.) —
//    exactement comme sur le formulaire papier rempli à la main.
//    Pour les champs texte libre (raison sociale, adresse, téléphone —
//    lignes soulignées en tirets ─, pas des cases chiffre-par-chiffre), on
//    n'essaie PAS de reboucher avec des tirets après la valeur : ça faisait
//    déborder la ligne sur 2 lignes et ajoutait une page entière en trop.
//
// BOX_WIDTHS ci-dessous = les cases telles qu'elles existent dans le
// template officiel actuel — extraites une fois pour toutes de
// Model_Declaration_Globale_Cotisation.docx. Si la CNSS change à nouveau
// le formulaire, il faut ré-extraire ces valeurs (voir la méthode utilisée
// dans la conversation : chercher les runs contenant └┴┘─ dans
// word/document.xml après un merge_runs).
const BOX_WIDTHS: Record<string, string> = {
  RAISON_SOCIALE: '└────────────────────────────────┘',
  MATRICULE: '└┴┴┴┴┴┴┴┴┴┴┴┴┘',
  P_JJ: '└┴┘',
  P_MM: ' └┴┘',
  P_AAAA: ' └┴┴┴┘',
  EFFECTIF: '└┴┴┴┘',
  SALAIRE_BRUT: '└┴┴┴┴┴┴┴┴┴┴┘',
  TUS_MONTANT: '└┴┴┴┴┴┴┴┴┴┴┘',
  TUS_MAJORATION: '└┴┴┴┴┴┴┴┴┴┴┘',
  SOUS_TOTAL_1: '└┴┴┴┴┴┴┴┴┴┴┴┴┘',
  PENSION_BASE: '└┴┴┴┴┴┴┴┴┴┘',
  PENSION_MONTANT: '└┴┴┴┴┴┴┴┴┴┴┘',
  ATPF_BASE: '└───────────┘',
  ATPF_MONTANT: '└┴┴┴┴┴┴┴┴┴┘',
  MAJORATION_RETARD: '└┴┴┴┴┴┴┴┴┴┴┘',
  PENALITE: '└┴┴┴┴┴┴┴┴┴┴┘',
  DEDUCTION_CREDIT: '└┴┴┴┴┴┴┴┴┴┴┘',
  SOUS_TOTAL_2: '└┴┴┴┴┴┴┴┴┴┴┴┴┘',
  TOTAL_A_PAYER: '└┴┴┴┴┴┴┴┴┴┴┴┴┘',
  F_JJ: '└┴┘',
  F_MM: ' └┴┘',
  F_AAAA: ' └┴┴┴┘',
  ADRESSE: '└─────────────────────────────────────┘',
  TELEPHONE: '└─────────────────────────────────────┘',
  ACOMPTE: '└┴┴┴┴┴┴┴┴┴┴┴┴┘',
};

// Insère `value` dans la case d'origine `boxStr` :
// - case à chiffres (└┴┴┴┴┴┘) : CHAQUE chiffre est inséré juste après SON
//   propre trait de case (└2┴0┴0┴4┴7┴┴┴┴┴┴┘), au lieu d'écraser les traits
//   des cases utilisées. Les cases inutilisées restent affichées à la fin,
//   comme rempli à la main sur le formulaire papier.
//   ⚠️ Ancien bug corrigé (Aug 2026) : la version précédente remplaçait le
//   DÉBUT de la case par le bloc de chiffres entier ("20000" + "┴┴┴┴┴┴┘"),
//   ce qui faisait disparaître les traits de case sous les chiffres saisis
//   — d'où un rendu qui ressemblait à du texte brut collé, différent du
//   reste du formulaire (voir capture Word fournie par l'utilisateur : le
//   "20000" de Salaire Brut n'a aucune case visible, contrairement à
//   l'original CNSS où chaque chiffre reste dans sa case).
// - ligne soulignée en tirets (└────────┘, texte libre) : on insère juste
//   la valeur, sans reboucher avec des tirets (évite le débordement de ligne)
function fillField(rawValue: unknown, fieldName: string): string {
  const value = rawValue === null || rawValue === undefined ? '' : String(rawValue);
  const boxStr = BOX_WIDTHS[fieldName];
  if (!boxStr) return value;

  const startIdx = boxStr.indexOf('└');
  if (startIdx === -1) return value;
  const prefix = boxStr.slice(0, startIdx);
  const comb = boxStr.slice(startIdx);
  const fillChar = comb[1];

  if (fillChar === '─') {
    return prefix + value;
  }

  // Chaque caractère de case (└┴┴┴┴┘) sert de "mur" gauche à un chiffre :
  // on insère le chiffre juste APRÈS son mur, sans l'écraser. Le dernier
  // caractère (┘) est le mur de fermeture : il ne reçoit jamais de chiffre,
  // donc une case de N caractères ne peut afficher que N-1 chiffres (troncature
  // défensive si la valeur est trop longue pour la case).
  const maxDigits = comb.length - 1;
  const digits = value.slice(0, maxDigits).split('');
  let filled = '';
  let i = 0;
  for (; i < digits.length; i++) {
    filled += comb[i] + digits[i];
  }
  filled += comb.slice(i); // cases inutilisées inchangées, y compris le mur final
  return prefix + filled;
}

// Formatage numérique SANS séparateur de milliers — chaque chiffre occupe
// une case, un espace mangerait une case pour rien et désalignerait tout.
function fmtDigits(x: number): string {
  return String(Math.round(x || 0));
}

export async function fillDgcTemplate(
  recap: {
    company?: {
      legalName?: string;
      cnssAffiliationNumber?: string;
      cnssNumber?: string;
      address?: string;
      phone?: string;
    };
    totals: {
      effectif: number;
      masseSalariale: number;
      tusCnss: number;
      tusMajoration: number;
      dgcSousTot1: number;
      dgcPensionBase: number;
      dgcCotisationPension: number;
      dgcAtPfBase: number;
      dgcCotisationAtPf: number;
      latePenalty: number;
      dgcSousTot2: number;
      dgcTotalAPayer: number;
    };
  },
  month: number,
  year: number,
  options?: { ville?: string; acompte?: number },
): Promise<Buffer> {
  const templatePath = path.join(
    TEMPLATES_DIR,
    'Model_Declaration_Globale_Cotisation.docx',
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template DGC introuvable : ${templatePath}`);
  }

  const mm = String(month).padStart(2, '0');
  const today = new Date();
  const t = recap.totals;

  const raw: Record<string, string> = {
    RAISON_SOCIALE: recap.company?.legalName || '',
    MATRICULE:
      recap.company?.cnssAffiliationNumber || recap.company?.cnssNumber || '',
    P_JJ: '01',
    P_MM: mm,
    P_AAAA: String(year),
    EFFECTIF: String(t.effectif),
    SALAIRE_BRUT: fmtDigits(t.masseSalariale),
    TUS_MONTANT: fmtDigits(t.tusCnss),
    TUS_MAJORATION: fmtDigits(t.tusMajoration),
    SOUS_TOTAL_1: fmtDigits(t.dgcSousTot1),
    PENSION_BASE: fmtDigits(t.dgcPensionBase),
    PENSION_MONTANT: fmtDigits(t.dgcCotisationPension),
    ATPF_BASE: fmtDigits(t.dgcAtPfBase),
    ATPF_MONTANT: fmtDigits(t.dgcCotisationAtPf),
    MAJORATION_RETARD: fmtDigits(t.latePenalty),
    PENALITE: '0',
    DEDUCTION_CREDIT: '0',
    SOUS_TOTAL_2: fmtDigits(t.dgcSousTot2),
    TOTAL_A_PAYER: fmtDigits(t.dgcTotalAPayer),
    VILLE: options?.ville || 'Brazzaville',
    F_JJ: String(today.getDate()).padStart(2, '0'),
    F_MM: String(today.getMonth() + 1).padStart(2, '0'),
    F_AAAA: String(today.getFullYear()),
    ADRESSE: recap.company?.address || '',
    TELEPHONE: recap.company?.phone || '',
    ACOMPTE: options?.acompte ? fmtDigits(options.acompte) : '',
  };

  const values: Record<string, string> = {};
  for (const field of Object.keys(raw)) {
    values[field] = fillField(raw[field], field);
  }

  const templateBuffer = fs.readFileSync(templatePath);
  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    // Même logique que fillOrcaWordTemplate (documents/orca-word.util.ts) :
    // une balise sans valeur devient une chaîne vide plutôt que de faire
    // planter le rendu (ex. ACOMPTE souvent non renseigné).
    nullGetter: () => '',
  });

  try {
    doc.render(values);
  } catch (error: any) {
    // docxtemplater regroupe ses erreurs de rendu dans error.properties.errors
    const details = error?.properties?.errors
      ?.map((e: any) => e.properties?.explanation)
      .filter(Boolean)
      .join(' | ');
    throw new Error(
      `Échec du remplissage du template DGC${details ? ` : ${details}` : ''}`,
    );
  }

  return doc.getZip().generate({ type: 'nodebuffer' });
}