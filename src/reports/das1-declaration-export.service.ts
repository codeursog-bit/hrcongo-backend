// ============================================================================
// 📁 src/reports/das1-declaration-export.service.ts
// ✅ Reproduction fidèle du "BULLETIN INDIVIDUEL" — Déclaration Annuelle des
//    Salaires (DAS 1) — un bloc par employé, dans le même ordre et avec les
//    mêmes libellés que le modèle PPP_MODELE_BILAN_DAS_I...xls fourni.
//
// ⚠️ Le modèle fourni contenait une anomalie (formule cassée : la cellule
// "NOM et PRENOMS" et plusieurs cellules chiffrées affichaient "23" à
// l'identique sur tous les employés). On reproduit ici la même structure,
// les mêmes libellés, le même ordre de blocs — mais avec les VRAIES valeurs
// (issues de Das1DeclarationService, lui-même basé sur les bulletins de
// paie réels). Un bloc = une page imprimable (saut de page automatique).
// ============================================================================

import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Das1Declaration, Das1Bulletin } from './das1-declaration.service';

const BORDER = 'FF000000';
const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: BORDER } };
const boxBorder: Partial<ExcelJS.Borders> = { top: thin, bottom: thin, left: thin, right: thin };

@Injectable()
export class Das1DeclarationExportService {
  async export(declaration: Das1Declaration): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'KonzaRH';
    workbook.created = new Date();

    const ws = workbook.addWorksheet(`BULLETINS ${declaration.year}`, {
      pageSetup: { orientation: 'portrait', paperSize: 9, fitToWidth: 1, fitToHeight: 0 },
      views: [{ showGridLines: false }],
    });

    ws.columns = [
      { width: 30 }, // A
      { width: 16 }, // B
      { width: 14 }, // C
      { width: 26 }, // D
      { width: 16 }, // E
      { width: 16 }, // F
      { width: 18 }, // G
      { width: 16 }, // H
    ];

    let cursor = 0;
    declaration.bulletins.forEach((b, idx) => {
      const r0 = cursor;
      this.buildBlock(ws, r0, b, declaration);
      const thisHeight = this.blockHeight(b);
      cursor += thisHeight;
      // Saut de page après chaque bulletin (1 employé = 1 page imprimée),
      // sauf après le dernier.
      if (idx < declaration.bulletins.length - 1) {
        ws.getRow(r0 + thisHeight).addPageBreak();
      }
    });

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // ══════════════════════════════════════════════════════════════════════
  // Un bloc = un bulletin individuel complet (61 lignes de base, comme le
  // modèle — étendu automatiquement si l'employé a plus de 2 catégories
  // d'indemnités non imposables, pour ne jamais rien couper).
  // ══════════════════════════════════════════════════════════════════════
  blockHeight(b: Das1Bulletin): number {
    const indemExtra = Math.max(0, b.indemnitesNonImposables.length - 2);
    return 61 + indemExtra;
  }

  private buildBlock(ws: ExcelJS.Worksheet, r0: number, b: Das1Bulletin, decl: Das1Declaration) {
    // Décalage appliqué à partir de la section III (offset 44) si l'employé
    // a plus de 2 catégories d'indemnités — tout ce qui suit (section III,
    // souche employé, tableau récapitulatif) glisse d'autant, pour ne
    // jamais chevaucher les lignes déjà écrites.
    const indemExtra = Math.max(0, b.indemnitesNonImposables.length - 2);
    // R() ne décale QUE ce qui suit le bloc indemnités (à partir de la
    // section III) — le bloc indemnités lui-même (lignes 40 à 42 dans le
    // modèle d'origine) est écrit avec des offsets calculés directement
    // (rawR), puisque c'est justement lui qui grandit ou non.
    const R = (offset: number) => r0 + (offset >= 44 ? offset + indemExtra : offset) + 1; // ligne réelle (1-indexée)
    const rawR = (offset: number) => r0 + offset + 1;
    const set = (offset: number, col: number, value: any, opts?: Partial<{ bold: boolean; italic: boolean; size: number; align: 'left' | 'center' | 'right' }>) => {
      const cell = ws.getCell(R(offset), col);
      cell.value = value;
      cell.font = { name: 'Arial', size: opts?.size ?? 8, bold: !!opts?.bold, italic: !!opts?.italic };
      cell.alignment = { horizontal: opts?.align ?? 'left', vertical: 'top', wrapText: true };
      cell.protection = { locked: false };
      return cell;
    };
    const merge = (offset: number, c1: number, c2: number) => {
      ws.mergeCells(R(offset), c1, R(offset), c2);
    };
    const num = (offset: number, col: number, value: number, opts?: Partial<{ bold: boolean }>) => {
      const cell = set(offset, col, value, { align: 'right', bold: opts?.bold });
      cell.numFmt = '#,##0;(#,##0);–';
      return cell;
    };
    // Variantes "brutes" (sans décalage) pour le bloc indemnités lui-même.
    const setRaw = (offset: number, col: number, value: any, opts?: Partial<{ bold: boolean; italic: boolean; size: number; align: 'left' | 'center' | 'right' }>) => {
      const cell = ws.getCell(rawR(offset), col);
      cell.value = value;
      cell.font = { name: 'Arial', size: opts?.size ?? 8, bold: !!opts?.bold, italic: !!opts?.italic };
      cell.alignment = { horizontal: opts?.align ?? 'left', vertical: 'top', wrapText: true };
      cell.protection = { locked: false };
      return cell;
    };
    const numRaw = (offset: number, col: number, value: number, opts?: Partial<{ bold: boolean }>) => {
      const cell = setRaw(offset, col, value, { align: 'right', bold: opts?.bold });
      cell.numFmt = '#,##0;(#,##0);–';
      return cell;
    };

    const year = decl.year;

    // ── En-tête employeur / N° d'ordre ─────────────────────────────────
    set(0, 1, "DESIGNATION DE L'EMPLOYEUR", { bold: true });
    merge(0, 4, 6);
    set(0, 4, "N° D'ORDRE DU BORDEREAU RECAPITULATIF", { bold: true, align: 'center' });
    num(0, 8, b.ordre);

    merge(1, 4, 7);
    set(1, 4, 'Traitements publics et privés, indemnités, émoluments, salaires, pensions', { size: 7 });

    set(2, 1, decl.companyName, { bold: true });
    set(2, 5, 'rentes viagères', { size: 7 });

    set(3, 1, decl.companyActivity ?? '');
    merge(3, 4, 7);
    set(3, 4, 'BULLETIN   INDIVIDUEL', { bold: true, align: 'center', size: 11 });

    set(4, 1, decl.companyAddress);
    set(4, 2, decl.companyPhone ? `Tél. ${decl.companyPhone}` : '');
    merge(4, 4, 7);
    set(4, 4, `Rémunérations payées au cours de l'année ${year}`, { align: 'center' });

    // ── Désignation de la personne rétribuée ───────────────────────────
    merge(6, 3, 4);
    set(6, 3, 'DESIGNATION DE LA PERSONNE RETRIBUEE', { bold: true, align: 'center' });

    set(7, 4, 'ADRESSE', { align: 'center', bold: true });
    set(7, 6, 'SITUATION', { align: 'center', bold: true });
    set(7, 8, 'Période à laquelle', { align: 'center' });

    set(8, 1, 'NOM et PRENOMS', { bold: true });
    set(8, 3, 'EMPLOI', { bold: true, align: 'center' });
    set(8, 4, `au 31 Décembre ${year}`, { align: 'center', size: 7 });
    set(8, 6, 'de famille (1)', { align: 'center', size: 7 });
    set(8, 8, "s'appliquent", { align: 'center', size: 7 });

    set(9, 4, 'ou dernière adresse connue', { align: 'center', size: 7 });
    set(9, 6, `au 31 Décembre ${year}`, { align: 'center', size: 7 });
    set(9, 8, 'les paiements', { align: 'center', size: 7 });

    set(11, 1, b.employeeName, { bold: true });
    set(11, 3, b.position);
    set(11, 4, b.address);
    set(11, 6, b.maritalStatusLabel);
    set(11, 8, `Du ${b.periodFrom}`);

    set(12, 4, b.phone ? `Tél: ${b.phone}` : '');
    set(12, 6, "Nombre d'enfants", { size: 7 });
    set(12, 8, `Au ${b.periodTo}`);

    set(13, 1, 'NIU:');
    set(13, 4, b.city);
    set(13, 6, 'à charge', { size: 7 });
    num(13, 7, b.numberOfChildren);

    set(14, 1, b.niu ?? '');

    set(15, 1, '(1) Célibataire, marié, veuf ou divorcé — Pour les fonctionnaires ou militaires, indice au 31 Décembre ' + year, { italic: true, size: 7 });

    // ── I - Montant payé en espèces ─────────────────────────────────────
    set(16, 6, 'PERIODE DE', { align: 'center', bold: true, size: 7 });

    merge(17, 1, 3);
    set(17, 1, `I - Montant payé en espèces ou crédité en compte en ${year}`, { bold: true });
    set(17, 6, 'Présence au Congo', { align: 'center', size: 7 });
    set(17, 7, 'Congé', { align: 'center', size: 7 });
    set(17, 8, 'Colonne réservée', { align: 'center', size: 7 });

    set(18, 8, 'au Service des', { align: 'center', size: 7 });

    set(19, 1, 'Après déduction des retenues pour retraite ou sécurité sociale — avant déduction de', { size: 7 });
    set(19, 8, 'Contributions directes', { align: 'center', size: 7 });

    set(20, 1, "l'I.R.P.P. et des retenues pour logement, nourriture, etc.", { size: 7 });
    num(20, 6, b.moisPresence);
    num(20, 7, b.moisConge);

    set(21, 8, 'I.R.P.P. dû', { align: 'center', size: 7 });

    set(22, 1, '(Ce chiffre doit comprendre toutes les sommes imposables : Solde ou salaire de base, complément', { size: 7 });
    set(23, 1, 'spécial, dixième, indemnités de résidence, de fonction, de sujétion, technicité, prime de rendement,', { size: 7 });
    set(24, 1, 'remises, heures supplémentaires, gratifications, pensions viagères, etc.)', { size: 7 });

    set(26, 1, 'Rappels afférents aux années antérieures', { size: 7 });
    set(26, 8, 'R.S.', { align: 'center', size: 7 });

    set(27, 1, "Indemnités d'éloignement", { size: 7 });

    set(28, 3, 'TOTAL en espèces', { bold: true, align: 'right' });
    num(28, 6, b.montantEspeces, { bold: true });

    set(29, 1, 'Avantages en nature — Logement gratuit (a) 10% du total ci-dessus', { size: 7 });
    num(29, 6, b.avantageNatureLogement);

    set(30, 2, '— Autres avantages (b) valeur réelle', { size: 7 });
    num(30, 6, b.avantageNatureAutres);

    set(31, 2, '', {});
    set(31, 8, 'T.P.', { align: 'center', size: 7 });
    num(32, 6, b.montantEspeces + b.avantageNatureLogement + b.avantageNatureAutres);

    set(33, 1, "Montant imposable à l'I.R.P.P. — 80% du total ci-dessus", { size: 7 });
    num(33, 6, b.montantImposable80, { bold: true });

    set(34, 1, `I.R.P.P. retenu en ${year}...........`);
    num(34, 6, b.irppRetenu, { bold: true });

    set(35, 1, `T. Départementale retenue en ${year}...........`);
    num(35, 6, b.taxeDepartementale, { bold: true });

    set(36, 1, "(a) Le logement n'est pas gratuit lorsqu'il donne lieu à retenue.", { italic: true, size: 7 });
    set(37, 1, '(b) Indiquer ici les avantages accordés : nourriture, domesticité, éclairage, etc.', { italic: true, size: 7 });

    // ── II - Indemnités non imposables (dynamique) ──────────────────────
    set(38, 2, 'II - Indemnités non imposables', { bold: true });
    set(39, 2, "(Les administrations civiles ou militaires n'ont pas à remplir ce cadre)", { italic: true, size: 7 });

    set(40, 1, 'En indiquer la nature et le montant', { size: 7 });
    set(40, 4, 'PNI', { bold: true, align: 'center' });

    // On affiche une ligne par catégorie d'indemnité réellement payée
    // (transport, panier, logement, autres...) — jamais de ligne vide.
    // Occupe les offsets 40..(40+n-1), TOTAL juste après — comme le
    // modèle d'origine quand n=2 (offsets 40,41 puis TOTAL à 42).
    b.indemnitesNonImposables.forEach((line, i) => {
      setRaw(40 + i, 5, line.label);
      numRaw(40 + i, 6, line.amount);
    });
    const totalOffset = 40 + b.indemnitesNonImposables.length;
    setRaw(totalOffset, 4, 'TOTAL', { bold: true, align: 'right' });
    numRaw(totalOffset, 6, b.totalIndemnitesNonImposables, { bold: true });

    // ── III - Non applicable aux salariés (texte réglementaire, vide) ──
    set(44, 2, "III - Contribuables n'ayant pas la qualité de salarié", { bold: true });

    set(45, 1, "1° Rémunérations des administrateurs des sociétés membres des conseils de direction, de gestion, de surveillance,", { size: 7 });
    set(46, 1, 'commissaires aux comptes, etc. (Tantièmes, jetons de présence, etc.)', { size: 7 });
    set(47, 1, 'sociétés — 2° Courtages, commissions et autres rémunérations versées à des courtiers, commissionnaires ou intermédiaires.', { size: 7 });
    set(48, 1, '3° Honoraires, vacations et autres rémunérations versées à des avocats, notaires, greffiers, huissiers, experts-comptables,', { size: 7 });
    set(49, 1, 'médecins, etc.', { size: 7 });
    set(50, 1, "(L'admission de ces sommes en frais généraux de l'entreprise est subordonnée à la présente déclaration)", { italic: true, size: 7 });

    // ── Souche / résumé remis à l'employé ────────────────────────────
    set(52, 1, `Souche à remettre à l'employé : ${b.employeeName}`, { bold: true });
    set(53, 1, `Renseignements fournis à l'Administration et concernant les sommes perçues du ${b.periodFrom} au ${b.periodTo}`, { size: 7, italic: true });

    set(54, 1, 'PERIODE', { bold: true, align: 'center' });
    set(54, 2, 'MONTANT', { bold: true, align: 'center' });
    set(54, 3, 'RAPPELS', { bold: true, align: 'center' });
    set(54, 4, 'INDEMNITES', { bold: true, align: 'center' });
    set(54, 5, 'AVANTAGES EN NATURE', { bold: true, align: 'center' });

    set(55, 1, 'de', { align: 'center', size: 7 });
    set(55, 2, `Brut ${year}`, { align: 'center', size: 7 });
    set(55, 3, 'Années', { align: 'center', size: 7 });
    set(55, 4, "d'éloignement", { align: 'center', size: 7 });
    set(55, 5, '(10%)', { align: 'center', size: 7 });
    set(55, 6, 'Nourriture, éclairage', { align: 'center', size: 7 });
    set(55, 7, 'Total brut', { align: 'center', size: 7 });
    num(55, 8, b.montantEspeces);

    ws.getCell(R(56), 1).value = new Date(b.periodFrom.split('/').reverse().join('-'));
    ws.getCell(R(56), 1).numFmt = 'dd/mm/yyyy';
    set(56, 3, 'antérieures', { align: 'center', size: 7 });
    set(56, 5, '(logement)', { align: 'center', size: 7 });
    set(56, 6, 'domesticité, etc.', { align: 'center', size: 7 });
    set(56, 7, 'Imposable 80%', { align: 'center', size: 7 });
    num(56, 8, b.montantImposable80);

    ws.getCell(R(57), 1).value = new Date(b.periodTo.split('/').reverse().join('-'));
    ws.getCell(R(57), 1).numFmt = 'dd/mm/yyyy';
    set(57, 6, 'valeur réelle', { align: 'center', size: 7 });
    set(57, 7, 'I.R.P.P. retenu', { align: 'center', size: 7 });
    num(57, 8, b.irppRetenu);

    set(58, 1, 'Présence au Congo', { size: 7 });
    num(58, 2, b.moisPresence);
    set(58, 7, 'T. Départementale retenu', { align: 'center', size: 7 });
    num(58, 8, b.taxeDepartementale);

    set(59, 1, 'Congé', { size: 7 });
    num(59, 2, b.moisConge);
    set(59, 7, 'TOL retenu', { align: 'center', size: 7 });
    num(59, 8, b.tolRetenu);

    // ── Cadre général du bulletin (boîte fine) ──────────────────────────
    for (let row = R(0); row <= R(60); row++) {
      for (let col = 1; col <= 8; col++) {
        const cell = ws.getCell(row, col);
        if (!cell.border) cell.border = boxBorder;
      }
    }
  }
}