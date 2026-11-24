// ============================================================================
// 📁 src/common/safe-xlsx.ts  (NOUVEAU FICHIER)
// Lecture Excel sécurisée pour les imports envoyés par les utilisateurs.
//
// Pourquoi : XLSX.read() est SYNCHRONE (il bloque tout le serveur pendant qu'il
// tourne) et lit tout le classeur en mémoire. Un .xlsx est un zip : un fichier de
// 5 Mo peut se décompresser en plusieurs Go (« zip bomb ») ou contenir des
// centaines de milliers de lignes → serveur gelé puis tué par manque de RAM.
//
// Ce helper :
//   1. refuse les zips dont la taille décompressée dépasse un plafond ;
//   2. ne lit que les (maxRows + 2) premières lignes (option sheetRows) ;
//   3. refuse proprement un fichier qui dépasse maxRows lignes de données.
// ============================================================================
import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import PizZip from 'pizzip';

export const IMPORT_MAX_ROWS = 2000; // lignes de données (hors en-tête)
export const IMPORT_MAX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024; // 40 Mo décompressés

export function safeReadWorkbook(
  buffer: Buffer,
  maxRows: number = IMPORT_MAX_ROWS,
): XLSX.WorkBook {
  if (!buffer || buffer.length < 8) {
    throw new BadRequestException('Fichier Excel vide ou invalide.');
  }

  // .xlsx = zip (signature « PK »). Les anciens .xls (OLE) ne sont pas des zips.
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (isZip) {
    let zip: PizZip;
    try {
      zip = new PizZip(buffer); // lit le sommaire, ne décompresse rien
    } catch {
      throw new BadRequestException('Fichier Excel illisible ou corrompu.');
    }
    let total = 0;
    for (const name of Object.keys(zip.files)) {
      total += Number((zip.files[name] as any)?._data?.uncompressedSize ?? 0);
      if (total > IMPORT_MAX_UNCOMPRESSED_BYTES) {
        throw new BadRequestException(
          'Fichier Excel trop volumineux une fois décompressé.',
        );
      }
    }
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', sheetRows: maxRows + 2 });
  } catch {
    throw new BadRequestException('Fichier Excel illisible ou corrompu.');
  }

  const first = workbook.Sheets[workbook.SheetNames[0]];
  if (first?.['!ref']) {
    const range = XLSX.utils.decode_range(first['!ref']);
    // lignes lues = range.e.r + 1 (en-tête incluse). On en a demandé maxRows + 2.
    if (range.e.r + 1 > maxRows + 1) {
      throw new BadRequestException(
        `Fichier trop long : maximum ${maxRows} lignes par import. Découpez le fichier en plusieurs parties.`,
      );
    }
  }
  return workbook;
}