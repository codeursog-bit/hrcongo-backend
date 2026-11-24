// ============================================================================
// 📁 src/reports/export-bulletin-annuel-template.ts
// ✅ Remplit le template Excel "bulletin-annuel-template.xlsx" avec ExcelJS —
//    MÊME PRINCIPE que src/das-declaration/export-das-template.ts : on ouvre
//    le template, on écrit UNIQUEMENT des valeurs dans des cellules déjà
//    stylées, jamais de reconstruction de la feuille à l'exécution.
//
// Le template a été extrait DIRECTEMENT du fichier réel fourni
// (PPP_MODELE_BILAN_DAS_I...xls, converti en .xlsx) : mêmes polices, mêmes
// bordures, mêmes largeurs de colonnes, mêmes libellés — un seul bloc de 61
// lignes (un employé), cloné autant de fois que nécessaire à l'exécution.
//
// ⚠️ Le fichier source contenait plusieurs formules cassées (référence
// #REF!, cellules mal reliées) et, comme dans export-das-template.ts, on
// n'essaie PAS de conserver des formules Excel "live" dans les blocs
// clonés : cloner une formule copie littéralement son texte (ex. "F33*80%")
// sans réajuster les références de ligne, donc un bloc cloné pointerait à
// tort vers les cellules du 1er bloc. Toutes les cellules calculées
// (montant imposable, totaux du récapitulatif...) sont donc de simples
// VALEURS écrites directement ici — exactement comme le fait la
// déclaration DAS. Elles restent modifiables à la main dans Excel, seul le
// recalcul automatique disparaît (comme pour DAS).
//
// Repères réels (1-indexés, à l'intérieur d'un bloc de 61 lignes) :
//   L1  C8         → N° d'ordre
//   L3  C1         → Nom entreprise
//   L4  C1         → Activité entreprise
//   L5  C1/C2/C4   → Adresse / Tél. entreprise / sous-titre période
//   L9  C4         → "au 31 Décembre {année}"
//   L12 C1/C3/C4/C6/C8 → Nom employé / Emploi / Adresse / Situation / "Du {date}"
//   L13 C4/C8      → Tél employé / "Au {date}"
//   L14 C4/C7      → Ville / Nb enfants
//   L15 C1         → NIU
//   L16 C1         → footnote (année)
//   L21 C6/C7      → Présence au Congo (mois) / Congé (mois)
//   L29 C6         → TOTAL en espèces (montant brut − CNSS)
//   L30 C6         → Avantage nature — logement
//   L31 C6         → Avantage nature — autres
//   L33 C6         → Base 80% (montant + avantages) — valeur directe
//   L34 C6         → Montant imposable à l'IRPP (80%) — valeur directe
//   L35 C1/C6      → "I.R.P.P. retenu en {année}" / valeur
//   L36 C1/C6      → "T.Départementale retenue en {année}" / valeur
//   L41 C5/C6      → Indemnité #1 (libellé / montant)
//   L42 C5/C6      → Indemnité #2 (libellé / montant)
//   L43 C6         → TOTAL indemnités — valeur directe
//   L53 C1         → "Souche à remettre à l'employé : ..."
//   L54 C1         → "Renseignements fournis... du ... au ..."
//   L56 C2/C8      → "Brut {année}" / Total brut (valeur directe)
//   L57 C1/C8      → Date début période / Imposable 80% (valeur directe)
//   L58 C1/C8      → Date fin période / I.R.P.P. retenu (valeur directe)
//   L59 C2/C8      → Présence (mois, souche) / T.Départementale (valeur directe)
//   L60 C2/C8      → Congé (mois, souche) / TOL retenu (valeur directe)
// ============================================================================

import * as path from 'path';
import * as fs from 'fs';
import * as ExcelJS from 'exceljs';
import { Das1Declaration, Das1Bulletin } from './das1-declaration.service';

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'bulletin-annuel-template.xlsx');

const BLOCK_HEIGHT = 61; // taille réelle d'un bloc dans le fichier d'origine
const MAX_INDEMNITE_SLOTS = 2; // le formulaire officiel ne réserve que 2 lignes

/**
 * Clone un bloc de page (valeurs, styles, hauteurs de ligne, fusions) depuis
 * la position source vers une position destination — identique à la
 * fonction du même nom dans export-das-template.ts.
 */
function clonePageBlock(
  sheet: ExcelJS.Worksheet,
  sourceStartRow1Indexed: number,
  destStartRow1Indexed: number,
  blockHeight: number,
) {
  for (let r = 0; r < blockHeight; r++) {
    const srcRow = sheet.getRow(sourceStartRow1Indexed + r);
    const dstRow = sheet.getRow(destStartRow1Indexed + r);
    if (srcRow.height) dstRow.height = srcRow.height;
    srcRow.eachCell({ includeEmpty: true }, (srcCell, colNumber) => {
      const dstCell = dstRow.getCell(colNumber);
      dstCell.value = srcCell.value;
      dstCell.style = JSON.parse(JSON.stringify(srcCell.style));
    });
    dstRow.commit();
  }

  const rowOffset = destStartRow1Indexed - sourceStartRow1Indexed;
  const sourceMerges = (sheet.model.merges || []).filter((m) => {
    const rowNum = parseInt(m.match(/[A-Z]+(\d+)/)![1], 10);
    return rowNum >= sourceStartRow1Indexed && rowNum < sourceStartRow1Indexed + blockHeight;
  });
  sourceMerges.forEach((m) => {
    const translated = m.replace(/([A-Z]+)(\d+)/g, (_match, col, row) => `${col}${parseInt(row, 10) + rowOffset}`);
    sheet.mergeCells(translated);
  });
}

function buildSheetName(companyName: string, year: number): string {
  const cleaned = (companyName || 'Bulletin').replace(/[\\/?*[\]:]/g, ' ').trim();
  const suffix = ` ${year}`;
  const maxNameLength = 31 - suffix.length;
  const truncated = cleaned.length > maxNameLength ? cleaned.slice(0, maxNameLength).trim() : cleaned;
  return `${truncated}${suffix}`;
}

export async function fillBulletinAnnuelTemplate(declaration: Das1Declaration): Promise<Buffer> {
  // ── Vérification défensive du template ──────────────────────────────
  // "Corrupted zip" / "data length = 0" venant de JSZip signifie presque
  // toujours que le fichier .xlsx est absent, vide ou tronqué sur le
  // disque (mauvaise copie, build qui n'a pas copié l'asset, etc.) — pas
  // un bug de ce code. On le détecte ici avec un message clair plutôt que
  // de laisser remonter la stack trace cryptique de jszip.
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(
      `[Bulletin Annuel] Template introuvable : ${TEMPLATE_PATH}. ` +
        `Vérifie que le fichier src/reports/templates/bulletin-annuel-template.xlsx existe bien ` +
        `(et qu'il est copié dans dist/ si tu construis le projet avec "nest build").`,
    );
  }
  const stats = fs.statSync(TEMPLATE_PATH);
  if (stats.size === 0) {
    throw new Error(
      `[Bulletin Annuel] Le template ${TEMPLATE_PATH} fait 0 octet (fichier vide/corrompu). ` +
        `Retélécharge le fichier bulletin-annuel-template.xlsx et remplace-le — il doit faire ~9 Ko.`,
    );
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  const sheet = workbook.worksheets[0];
  sheet.name = buildSheetName(declaration.companyName, declaration.year);

  // Échelle fixe (pas de "fit to page") : avec des sauts de page manuels,
  // "fit to height" recalculerait l'échelle sur TOUT le contenu et
  // écraserait les sauts entre blocs. Une échelle fixe à 88% garantit que
  // chaque bloc de 61 lignes tient sur une seule page A4 portrait.
  sheet.pageSetup = {
    orientation: 'portrait',
    paperSize: 9, // A4
    scale: 88,
    margins: { top: 0.25, bottom: 0.25, left: 0.25, right: 0.25, header: 0, footer: 0 },
  };

  const bulletins = declaration.bulletins;
  const totalPages = Math.max(bulletins.length, 1);

  // Le template ne contient physiquement qu'un seul bloc (lignes 1-61). On
  // le clone (styles/fusions/hauteurs/formules comprises) autant de fois
  // que nécessaire AVANT de remplir les valeurs.
  for (let pageIndex = 1; pageIndex < totalPages; pageIndex++) {
    const destStartRow1Indexed = pageIndex * BLOCK_HEIGHT + 1;
    clonePageBlock(sheet, 1, destStartRow1Indexed, BLOCK_HEIGHT);
    sheet.getRow(destStartRow1Indexed - 1).addPageBreak();
  }

  bulletins.forEach((b: Das1Bulletin, idx: number) => {
    const blockStart = idx * BLOCK_HEIGHT; // ligne 0 du bloc de cet employé (0-indexé)
    writeBulletin(sheet, blockStart, b, declaration);
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// L = numéro de ligne RÉEL (1-indexé) tel que documenté en en-tête de fichier.
function at(sheet: ExcelJS.Worksheet, blockStart: number, L: number, col: number) {
  return sheet.getRow(blockStart + L).getCell(col);
}

function writeBulletin(sheet: ExcelJS.Worksheet, blockStart: number, b: Das1Bulletin, decl: Das1Declaration) {
  const year = decl.year;
  const C = (L: number, col: number) => at(sheet, blockStart, L, col);

  // ── En-tête employeur / N° d'ordre ──────────────────────────────────
  C(1, 8).value = b.ordre;
  C(3, 1).value = decl.companyName;
  C(4, 1).value = decl.companyActivity ?? '';
  // ⚠️ Adresse et téléphone sur deux lignes SÉPARÉES (5 et 6), pas sur la
  // même ligne : l'adresse complète déborde presque toujours au-delà de la
  // colonne A, et la colonne D contient déjà "Rémunérations payées..." sur
  // cette même ligne 5 — donc même en fusionnant adresse+tél dans une seule
  // cellule A5, le texte butait contre la colonne D et le téléphone
  // disparaissait purement et simplement. La ligne 6 (col A) est vide dans
  // le vrai modèle — le téléphone y a toute la place nécessaire.
  C(5, 1).value = decl.companyAddress;
  C(6, 1).value = decl.companyPhone ? `Tél. ${decl.companyPhone}` : '';
  C(5, 4).value = `Rémunérations payées au cours de l'année ${year}`;
  // ⚠️ SUPPRIMÉ : cette ligne écrivait "au 31 Décembre {année}" dans la
  // ligne des LIBELLÉS d'en-tête eux-mêmes (juste sous "ADRESSE", ligne 9),
  // là où le vrai modèle n'a rien à cet endroit. Cette information existe
  // déjà correctement dans la note de bas de bloc (ligne 16, phrase
  // "...indice au 31 Décembre {année}") — c'était un doublon mal placé qui
  // polluait l'en-tête "ADRESSE" sans raison.

  // ── Désignation de la personne rétribuée ───────────────────────────
  C(12, 1).value = b.employeeName;
  C(12, 3).value = b.position;
  C(12, 4).value = b.address;
  C(12, 6).value = b.maritalStatusLabel;
  C(12, 8).value = `Du ${b.periodFrom}`;

  C(13, 4).value = b.phone ? `Tél: ${b.phone}` : '';
  C(13, 8).value = `Au ${b.periodTo}`;

  C(14, 4).value = b.city;
  C(14, 7).value = b.numberOfChildren;

  // ⚠️ Le vrai modèle a le libellé "NIU: " à la ligne 14 (fusion A14:B14),
  // PAS à la ligne 15 (complètement vide dans le modèle d'origine). Écrire la
  // valeur seule à la ligne 15 empétait le numéro juste en dessous du
  // libellé, sans bordure entre les deux — donnant l'illusion d'un retour
  // à la ligne. On écrit maintenant le libellé + la valeur sur la même
  // ligne, dans la cellule fusionnée réelle.
  C(14, 1).value = `NIU: ${b.niu ?? ''}`;

  C(16, 1).value =
    `(1) Célibataire, marié, veuf ou divorcé - Pour les fonctionnaires ou militaires, indice au 31 Décembre ${year}`;

  // ── I - Montant payé en espèces ─────────────────────────────────────
  C(18, 1).value = `I - Montant payé en espèces ou crédité en compte en ${year}`;
  C(21, 6).value = b.moisPresence;
  C(21, 7).value = b.moisConge;

  C(29, 6).value = Math.round(b.montantEspeces);
  C(30, 6).value = Math.round(b.avantageNatureLogement);
  C(31, 6).value = Math.round(b.avantageNatureAutres);
  C(33, 6).value = Math.round(b.montantEspeces + b.avantageNatureLogement + b.avantageNatureAutres);
  C(34, 6).value = Math.round(b.montantImposable80);

  C(35, 1).value = `I.R.P.P. retenu en ${year}...........`;
  C(35, 6).value = Math.round(b.irppRetenu);

  C(36, 1).value = `T.Départementale retenue en ${year}...........`;
  C(36, 6).value = Math.round(b.taxeDepartementale);

  // ── II - Indemnités non imposables (2 emplacements, comme le formulaire) ─
  const slots = b.indemnitesNonImposables.slice(0, MAX_INDEMNITE_SLOTS);
  if (b.indemnitesNonImposables.length > MAX_INDEMNITE_SLOTS) {
    const overflow = b.indemnitesNonImposables.slice(MAX_INDEMNITE_SLOTS - 1);
    slots[MAX_INDEMNITE_SLOTS - 1] = {
      label: overflow.map((l) => l.label).join(' + '),
      amount: overflow.reduce((s, l) => s + l.amount, 0),
    };
  }
  slots.forEach((line, i) => {
    C(41 + i, 5).value = line.label;
    C(41 + i, 6).value = Math.round(line.amount);
  });
  C(43, 6).value = Math.round(b.totalIndemnitesNonImposables);

  // ── Souche / résumé remis à l'employé ───────────────────────────────
  C(53, 1).value = `Souche à remettre à l'employé:  ${b.employeeName}`;
  C(54, 1).value =
    `Renseignements fournis à l'Administration et concernant les sommes perçues du ${b.periodFrom} au ${b.periodTo}`;

  C(56, 2).value = `Brut ${year}`;
  C(56, 8).value = Math.round(b.montantEspeces);

  const [dFrom, mFrom, yFrom] = b.periodFrom.split('/');
  const [dTo, mTo, yTo] = b.periodTo.split('/');
  const from = C(57, 1);
  from.value = new Date(`${yFrom}-${mFrom}-${dFrom}`);
  from.numFmt = 'dd/mm/yyyy';
  C(57, 8).value = Math.round(b.montantImposable80);

  const to = C(58, 1);
  to.value = new Date(`${yTo}-${mTo}-${dTo}`);
  to.numFmt = 'dd/mm/yyyy';
  C(58, 8).value = Math.round(b.irppRetenu);

  C(59, 2).value = b.moisPresence;
  C(59, 8).value = Math.round(b.taxeDepartementale);

  C(60, 2).value = b.moisConge;
  C(60, 8).value = Math.round(b.tolRetenu);
}