// ============================================================================
// 📁 loans-orca-export.service.ts
// ✅ Écrit directement dans la fiche Excel FOURNIE PAR LE CLIENT ORCA
//    (onglets AVANCE / MARCHANDISE) au lieu de recréer un rendu HTML — le
//    fichier de sortie est visuellement identique à celui qu'Orca utilisait
//    déjà. Le template est un fichier DU PROJET (src/loans/templates/,
//    même principe que src/cnss-declaration/templates/) — copié dans dist/
//    au build grâce à `assets` dans nest-cli.json.
// ✅ Réservé aux entreprises dont `company.documentTemplate === 'ORCA'` —
//    les autres clients continuent d'utiliser le rendu HTML existant
//    (LoanRequestPrintable). Le jour où un 2e client veut son propre
//    fichier, on ajoute juste une nouvelle valeur de documentTemplate + son
//    propre template/mapping, sans toucher à celui-ci.
// ✅ Le cachet de l'entreprise (company.cachetUrl, hébergé sur Cloudinary)
//    n'est apposé que si la fiche est APPROUVÉE (Loan: ACTIVE/PAID —
//    Advance: APPROVED/PAID/DEDUCTED). Une fiche encore en attente sort
//    donc sans cachet.
// ✅ Impression depuis l'app : `exportLoanPdf`/`exportAdvancePdf` convertissent
//    le classeur rempli en PDF via LibreOffice headless (binaire `soffice`),
//    pour que le frontend puisse l'ouvrir dans un nouvel onglet et imprimer
//    sans que la personne n'ait à télécharger puis rouvrir le fichier dans
//    Excel. ⚠️ NÉCESSITE `libreoffice` installé dans l'image Docker (voir
//    note d'infra en bas de fichier) — sans lui, le téléchargement .xlsx
//    continue de fonctionner normalement, seul l'aperçu/impression PDF
//    échoue proprement avec un message clair.
//
// ⚠️ MAPPING DES CELLULES : déduit des bordures du fichier fourni (lignes
//    soulignées = zones de saisie). Si à l'impression une valeur tombe
//    légèrement à côté de sa ligne, il suffit d'ajuster la coordonnée
//    correspondante ci-dessous — aucune autre partie du code n'est à
//    toucher. Les prêts de type ARGENT/AUTRE utilisent par défaut l'onglet
//    MARCHANDISE (le fichier fourni ne contient pas d'onglet dédié à
//    l'argent liquide) — à corriger ici si un onglet dédié est ajouté.
// ============================================================================

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { LoansCommonService } from './loans-common.service';

const execAsync = promisify(exec);
// Deux fichiers DISTINCTS (au lieu d'un seul fichier partagé avec suppression
// d'onglet) — ainsi l'écriture d'une fiche ne touche jamais, même
// indirectement, au fichier de l'autre type.
const AVANCE_TEMPLATE_PATH = path.join(
  __dirname,
  'templates',
  'fiche-avance-argent-orca.xlsx',
);
const MARCHANDISE_TEMPLATE_PATH = path.join(
  __dirname,
  'templates',
  'fiche-marchandise-orca.xlsx',
);
// Logo extrait du template — exceljs ne réécrit pas fiablement les images déjà
// présentes dans un fichier qu'il charge (limitation connue de la librairie),
// donc on le replace nous-mêmes explicitement à chaque génération plutôt que
// de compter sur exceljs pour le préserver tout seul.
const LOGO_PATH = path.join(__dirname, 'templates', 'orca-logo.png');
const LOGO_ANCHOR = { col: 0, row: 0, width: 198, height: 120 }; // position/taille d'origine dans le fichier fourni

@Injectable()
export class LoansOrcaExportService {
  private readonly logger = new Logger(LoansOrcaExportService.name);

  constructor(
    private prisma: PrismaService,
    private common: LoansCommonService,
  ) {}

  // ── Prêts (MARCHANDISE — aussi utilisé pour ARGENT/AUTRE par défaut) ────

  async exportLoanXlsx(
    loanId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { workbook, employee, loan } = await this.buildLoanWorkbook(
      loanId,
      userId,
    );
    void workbook; // déjà rempli par buildLoanWorkbook
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    return {
      buffer,
      filename: `Demande_pret_${employee.lastName}_${loan.id.slice(0, 8)}.xlsx`,
    };
  }

  async exportLoanPdf(
    loanId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { workbook, employee, loan } = await this.buildLoanWorkbook(
      loanId,
      userId,
    );
    const buffer = await this.workbookToPdf(workbook);
    return {
      buffer,
      filename: `Demande_pret_${employee.lastName}_${loan.id.slice(0, 8)}.pdf`,
    };
  }

  private async buildLoanWorkbook(loanId: string, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    const loan = await this.common.getOwnedLoanOrThrow(loanId, user.companyId);

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: {
        legalName: true,
        tradeName: true,
        documentTemplate: true,
        cachetUrl: true,
      },
    });
    if (company?.documentTemplate !== 'ORCA') {
      throw new BadRequestException(
        "Ce client n'utilise pas la fiche Excel Orca — utilisez l'aperçu HTML standard.",
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: loan.employeeId },
      select: {
        firstName: true,
        lastName: true,
        position: true,
        phone: true,
        department: { select: { name: true } },
      },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(MARCHANDISE_TEMPLATE_PATH); // ARGENT/AUTRE : pas de fichier dédié fourni, cf. note en tête de fichier
    const ws = workbook.getWorksheet('MARCHANDISE');
    if (!ws)
      throw new BadRequestException(
        'Onglet MARCHANDISE introuvable dans la fiche Orca.',
      );

    ws.getCell('B10').value = `${employee.lastName}`.toUpperCase();
    ws.getCell('E12').value = employee.firstName;
    ws.getCell('C15').value = employee.position ?? '';
    ws.getCell('M15').value = employee.phone ?? '';
    ws.getCell('D17').value = employee.department?.name ?? '';
    ws.getCell('H21').value = Number(loan.amount);
    ws.getCell('B23').value = new Date(loan.startDate).toLocaleDateString(
      'fr-FR',
    );
    ws.getCell('F26').value = Number(loan.monthlyRepayment);
    ws.getCell('H29').value = Math.ceil(
      Number(loan.amount) / Number(loan.monthlyRepayment),
    );

    const previousLoansTotal = await this.getPreviousLoansTotal(
      loan.employeeId,
      loan.id,
    );
    ws.getCell('H32').value = previousLoansTotal;
    ws.getCell('N32').value = previousLoansTotal + Number(loan.amount);

    // Décision DRH (case OUI/NON juste après le libellé — cf. note de mapping en tête de fichier)
    if (loan.drhDecision)
      ws.getCell('C45').value = loan.drhDecision === 'OUI' ? 'X' : '';
    if (loan.drhDecision === 'NON') ws.getCell('C48').value = 'X';
    // Décision DG
    if (loan.dgDecision)
      ws.getCell('N45').value = loan.dgDecision === 'OUI' ? 'X' : '';
    if (loan.dgDecision === 'NON') ws.getCell('N48').value = 'X';

    await this.stampLogo(workbook, ws);

    if (['ACTIVE', 'PAID'].includes(loan.status) && company.cachetUrl) {
      await this.stampCachet(workbook, ws, company.cachetUrl, 'K40');
    }

    return { workbook, ws, employee, loan, company };
  }

  // ── Avances sur salaire ──────────────────────────────────────────────────

  async exportAdvanceXlsx(
    advanceId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { workbook, employee, advance } = await this.buildAdvanceWorkbook(
      advanceId,
      userId,
    );
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    return {
      buffer,
      filename: `Demande_avance_${employee.lastName}_${advance.id.slice(0, 8)}.xlsx`,
    };
  }

  async exportAdvancePdf(
    advanceId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { workbook, employee, advance } = await this.buildAdvanceWorkbook(
      advanceId,
      userId,
    );
    const buffer = await this.workbookToPdf(workbook);
    return {
      buffer,
      filename: `Demande_avance_${employee.lastName}_${advance.id.slice(0, 8)}.pdf`,
    };
  }

  private async buildAdvanceWorkbook(advanceId: string, userId: string) {
    const user = await this.common.getVerifiedUser(userId);
    const advance = await this.common.getOwnedAdvanceOrThrow(
      advanceId,
      user.companyId,
    );

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: {
        legalName: true,
        tradeName: true,
        documentTemplate: true,
        cachetUrl: true,
      },
    });
    if (company?.documentTemplate !== 'ORCA') {
      throw new BadRequestException(
        "Ce client n'utilise pas la fiche Excel Orca — utilisez l'aperçu HTML standard.",
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: advance.employeeId },
      select: {
        firstName: true,
        lastName: true,
        position: true,
        phone: true,
        department: { select: { name: true } },
      },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(AVANCE_TEMPLATE_PATH);
    const ws = workbook.getWorksheet('AVANCE');
    if (!ws)
      throw new BadRequestException(
        'Onglet AVANCE introuvable dans la fiche Orca.',
      );

    ws.getCell('B10').value = `${employee.lastName}`.toUpperCase();
    ws.getCell('E12').value = employee.firstName;
    ws.getCell('C14').value = employee.position ?? '';
    ws.getCell('M14').value = employee.phone ?? '';
    ws.getCell('D16').value = employee.department?.name ?? '';
    ws.getCell('I19').value = advance.reason ?? '';
    ws.getCell('H22').value = Number(advance.amount);
    ws.getCell('B24').value = new Date(advance.createdAt).toLocaleDateString(
      'fr-FR',
    );

    const previousLoansTotal = await this.getPreviousLoansTotal(
      advance.employeeId,
    );
    ws.getCell('H32').value = previousLoansTotal;
    ws.getCell('N32').value = previousLoansTotal + Number(advance.amount);

    // Avis Chef de Service : OUI = case juste au-dessus du mot "OUI" (K48), NON = K51
    if (
      advance.status === 'APPROVED' ||
      advance.status === 'PAID' ||
      advance.status === 'DEDUCTED'
    )
      ws.getCell('K48').value = 'X';
    if (advance.status === 'REJECTED') ws.getCell('K51').value = 'X';

    await this.stampLogo(workbook, ws);

    if (
      ['APPROVED', 'PAID', 'DEDUCTED'].includes(advance.status) &&
      company.cachetUrl
    ) {
      await this.stampCachet(workbook, ws, company.cachetUrl, 'K40');
    }

    return { workbook, ws, employee, advance, company };
  }

  // ── Rendu HTML fidèle (bordures, fusions, polices, largeurs réelles) ─────
  // Alternative à LibreOffice : au lieu de convertir le fichier en PDF via un
  // binaire externe, on reconstruit le tableau HTML directement à partir du
  // modèle ExcelJS déjà chargé (mêmes bordures, mêmes fusions de cellules,
  // mêmes polices/couleurs, mêmes largeurs de colonnes) — donc un rendu
  // fidèle au fichier réel, imprimable depuis le navigateur, sans aucune
  // dépendance serveur.

  async exportLoanHtml(loanId: string, userId: string): Promise<string> {
    const { ws, company } = await this.buildLoanWorkbook(loanId, userId);
    return this.renderWorksheetToHtml(ws, company);
  }

  async exportAdvanceHtml(advanceId: string, userId: string): Promise<string> {
    const { ws, company } = await this.buildAdvanceWorkbook(advanceId, userId);
    return this.renderWorksheetToHtml(ws, company);
  }

  private async renderWorksheetToHtml(
    ws: ExcelJS.Worksheet,
    company: { cachetUrl: string | null },
  ): Promise<string> {
    const colCount = ws.columnCount;
    const rowCount = ws.rowCount;

    // ── Largeurs/hauteurs réelles (conversion unités Excel → px) ───────────
    const colPx: number[] = [0]; // index 1-based
    for (let c = 1; c <= colCount; c++) {
      const w = ws.getColumn(c).width ?? 8.43;
      colPx[c] = Math.round(w * 7 + 5);
    }
    const rowPx: number[] = [0];
    for (let r = 1; r <= rowCount; r++) {
      const h = ws.getRow(r).height ?? 15;
      rowPx[r] = Math.round(h * 1.333);
    }
    const colLeft: number[] = [0]; // offset cumulé gauche de chaque colonne
    for (let c = 1; c <= colCount; c++)
      colLeft[c] = (colLeft[c - 1] ?? 0) + (colPx[c - 1] ?? 0);
    const rowTop: number[] = [0];
    for (let r = 1; r <= rowCount; r++)
      rowTop[r] = (rowTop[r - 1] ?? 0) + (rowPx[r - 1] ?? 0);

    // ── Fusions de cellules ─────────────────────────────────────────────────
    type Merge = { c1: number; r1: number; c2: number; r2: number };
    const merges: Merge[] = ((ws.model as any).merges ?? []).map(
      (range: string) => {
        const [a, b] = range.split(':');
        const parse = (ref: string) => {
          const col = ref.match(/[A-Z]+/)![0];
          const row = Number(ref.match(/\d+/)![0]);
          return { col: this.colLetterToIndex(col) + 1, row };
        };
        const p1 = parse(a);
        const p2 = parse(b ?? a);
        return { c1: p1.col, r1: p1.row, c2: p2.col, r2: p2.row };
      },
    );
    const mergeAnchor = new Map<string, Merge>(); // "r,c" -> merge (pour la cellule en haut à gauche)
    const covered = new Set<string>(); // cellules recouvertes (pas l'ancre)
    merges.forEach((m) => {
      mergeAnchor.set(`${m.r1},${m.c1}`, m);
      for (let r = m.r1; r <= m.r2; r++)
        for (let c = m.c1; c <= m.c2; c++) {
          if (r !== m.r1 || c !== m.c1) covered.add(`${r},${c}`);
        }
    });

    const argb = (color?: { argb?: string }) =>
      color?.argb ? `#${color.argb.slice(2)}` : undefined;
    const borderCss = (b?: Partial<ExcelJS.Border>) => {
      if (!b || !b.style) return 'none';
      const width = b.style === 'thick' ? 3 : b.style === 'medium' ? 2 : 1;
      const style = ['dashed', 'dotted', 'double'].includes(b.style)
        ? b.style
        : 'solid';
      return `${width}px ${style} ${argb(b.color) ?? '#000'}`;
    };

    let tableHtml = `<table style="border-collapse:collapse;table-layout:fixed;width:${colLeft[colCount]}px;font-family:Calibri,Arial,sans-serif;">`;
    tableHtml += `<colgroup>${Array.from({ length: colCount }, (_, i) => `<col style="width:${colPx[i + 1]}px">`).join('')}</colgroup>`;

    for (let r = 1; r <= rowCount; r++) {
      tableHtml += `<tr style="height:${rowPx[r]}px;">`;
      for (let c = 1; c <= colCount; c++) {
        if (covered.has(`${r},${c}`)) continue;
        const cell = ws.getRow(r).getCell(c);
        const merge = mergeAnchor.get(`${r},${c}`);
        const colspan = merge ? merge.c2 - merge.c1 + 1 : 1;
        const rowspan = merge ? merge.r2 - merge.r1 + 1 : 1;

        const border = cell.border ?? {};
        const font = cell.font ?? {};
        const align = cell.alignment ?? {};
        const fill: any = cell.fill;
        const bg =
          fill?.type === 'pattern' && fill.pattern === 'solid'
            ? argb(fill.fgColor)
            : undefined;

        let value = cell.value;
        if (value && typeof value === 'object' && 'result' in (value as any))
          value = (value as any).result; // formule évaluée
        let display = '';
        if (value instanceof Date) display = value.toLocaleDateString('fr-FR');
        else if (typeof value === 'number')
          display = value.toLocaleString('fr-FR');
        else if (value != null) display = String(value);

        const style = [
          `border-top:${borderCss(border.top)}`,
          `border-bottom:${borderCss(border.bottom)}`,
          `border-left:${borderCss(border.left)}`,
          `border-right:${borderCss(border.right)}`,
          bg ? `background:${bg}` : '',
          `font-weight:${font.bold ? 'bold' : 'normal'}`,
          font.italic ? 'font-style:italic' : '',
          `font-size:${font.size ?? 11}pt`,
          font.color ? `color:${argb(font.color as any)}` : '',
          `text-align:${align.horizontal ?? (typeof value === 'number' ? 'right' : 'left')}`,
          `vertical-align:${align.vertical === 'middle' ? 'middle' : align.vertical === 'bottom' ? 'bottom' : 'top'}`,
          `white-space:${align.wrapText ? 'normal' : 'nowrap'}`,
          'padding:1px 3px',
          'overflow:hidden',
        ]
          .filter(Boolean)
          .join(';');

        tableHtml += `<td${colspan > 1 ? ` colspan="${colspan}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''} style="${style}">${display}</td>`;
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</table>';

    // ── Images en overlay (logo + cachet), positionnées via les offsets réels ──
    let imagesHtml = '';
    try {
      const logoBuffer = await fs.readFile(LOGO_PATH);
      const logoBase64 = logoBuffer.toString('base64');
      const left = colLeft[LOGO_ANCHOR.col + 1] ?? 0;
      const top = rowTop[LOGO_ANCHOR.row + 1] ?? 0;
      imagesHtml += `<img src="data:image/png;base64,${logoBase64}" style="position:absolute;left:${left}px;top:${top}px;width:${LOGO_ANCHOR.width}px;height:${LOGO_ANCHOR.height}px;" />`;
    } catch {
      /* logo cosmétique, on continue sans lui si illisible */
    }

    if (company.cachetUrl) {
      try {
        const response = await fetch(company.cachetUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString('base64');
          const ext = company.cachetUrl.toLowerCase().endsWith('.png')
            ? 'png'
            : 'jpeg';
          const left = colLeft[this.colLetterToIndex('K') + 1] ?? 0;
          const top = rowTop[40] ?? 0;
          imagesHtml += `<img src="data:image/${ext};base64,${base64}" style="position:absolute;left:${left}px;top:${top}px;width:110px;height:110px;" />`;
        }
      } catch {
        /* cachet en plus, pas bloquant */
      }
    }

    return `<div style="position:relative;width:${colLeft[colCount]}px;">${tableHtml}${imagesHtml}</div>`;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** "Montant du prêt précédent" : somme des prêts déjà actifs/soldés de l'employé (hors le prêt en cours d'édition). */
  private async getPreviousLoansTotal(
    employeeId: string,
    excludeLoanId?: string,
  ) {
    const previous = await this.prisma.loan.findMany({
      where: {
        employeeId,
        status: { in: ['ACTIVE', 'PAID'] },
        ...(excludeLoanId ? { id: { not: excludeLoanId } } : {}),
      },
    });
    return previous.reduce((sum, l) => sum + Number(l.amount), 0);
  }

  private async stampLogo(workbook: ExcelJS.Workbook, ws: ExcelJS.Worksheet) {
    try {
      const buffer = await fs.readFile(LOGO_PATH);
      const imageId = workbook.addImage({
        buffer: buffer as any,
        extension: 'png',
      });
      ws.addImage(imageId, {
        tl: { col: LOGO_ANCHOR.col, row: LOGO_ANCHOR.row },
        ext: { width: LOGO_ANCHOR.width, height: LOGO_ANCHOR.height },
      });
    } catch {
      // Le logo est cosmétique — la fiche sort quand même sans lui en cas de souci de lecture du fichier local.
    }
  }

  private async stampCachet(
    workbook: ExcelJS.Workbook,
    ws: ExcelJS.Worksheet,
    cachetUrl: string,
    anchorCell: string,
  ) {
    try {
      const response = await fetch(cachetUrl);
      if (!response.ok) return;
      const arrayBuffer = await response.arrayBuffer();
      const extension = cachetUrl.toLowerCase().endsWith('.png')
        ? 'png'
        : 'jpeg';
      const imageId = workbook.addImage({
        buffer: Buffer.from(arrayBuffer) as any,
        extension,
      });

      const col = anchorCell.match(/[A-Z]+/)![0];
      const row = Number(anchorCell.match(/\d+/)![0]);
      ws.addImage(imageId, {
        tl: { col: this.colLetterToIndex(col), row: row - 1 },
        ext: { width: 110, height: 110 },
      });
    } catch {
      // Le cachet est un plus, pas un bloquant — la fiche sort quand même sans cachet en cas d'échec réseau.
    }
  }

  private colLetterToIndex(letters: string): number {
    let index = 0;
    for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
    return index - 1; // exceljs attend un index 0-based
  }

  /**
   * Convertit le classeur rempli en PDF via LibreOffice headless (binaire
   * `soffice`), pour permettre l'impression directement depuis l'app (le
   * PDF s'ouvre dans un nouvel onglet, avec le bouton imprimer du
   * navigateur — pas besoin de télécharger puis rouvrir dans Excel).
   *
   * ⚠️ INFRA REQUISE : `libreoffice` doit être installé dans l'image Docker
   * du backend. Sur une image Debian/Ubuntu (Dockerfile), ajouter :
   *   RUN apt-get update && apt-get install -y libreoffice --no-install-recommends && rm -rf /var/lib/apt/lists/*
   * Sans ce paquet, cette méthode échoue avec un message clair — le
   * téléchargement .xlsx (exportLoanXlsx/exportAdvanceXlsx) continue lui de
   * fonctionner normalement, indépendamment de LibreOffice.
   */
  private async workbookToPdf(workbook: ExcelJS.Workbook): Promise<Buffer> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loan-doc-'));
    const xlsxPath = path.join(tmpDir, 'document.xlsx');
    try {
      const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
      await fs.writeFile(xlsxPath, buffer);

      await execAsync(
        `soffice --headless --nologo --nofirststartwizard --convert-to pdf --outdir "${tmpDir}" "${xlsxPath}"`,
        { timeout: 30000 },
      );

      const pdfPath = path.join(tmpDir, 'document.pdf');
      return await fs.readFile(pdfPath);
    } catch (err) {
      this.logger.error(
        `Conversion PDF (LibreOffice) échouée : ${(err as Error).message}`,
      );
      throw new BadRequestException(
        "L'aperçu/impression PDF n'est pas disponible sur ce serveur pour le moment (LibreOffice non installé). Le téléchargement Excel reste disponible.",
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
