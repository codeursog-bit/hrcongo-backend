// ============================================================================
// 📁 src/documents/orca-word.util.ts
// ✅ Écrit directement dans les fichiers .docx originaux fournis par Orca —
//    pas de reproduction HTML, le fichier de sortie EST leur fichier, avec
//    les valeurs injectées dans les balises {tag} préparées dans le template.
// ✅ Dépendances à ajouter au projet : `npm install docxtemplater pizzip`
//    (aucune n'est requise côté paiement — le module image payant de
//    docxtemplater n'est PAS utilisé : le cachet est injecté par
//    remplacement direct du fichier image dans l'archive .docx, une
//    opération de bas niveau qui ne nécessite aucune dépendance supplémentaire).
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

const TEMPLATES_DIR = path.join(__dirname, 'orca-templates');

export type OrcaLeaveDocType = 'conge' | 'absence';

/**
 * Remplit un template .docx Orca avec les données fournies (balises {tag}
 * préparées dans le fichier original) et retourne le buffer du .docx final.
 */
export function fillOrcaWordTemplate(
  templateFile: string,
  data: Record<string, string>,
): Buffer {
  const templatePath = path.join(TEMPLATES_DIR, templateFile);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Modèle Orca introuvable : ${templatePath}`);
  }

  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    // Toute balise {tag} sans valeur fournie est remplacée par une chaîne
    // vide plutôt que de faire planter le rendu — évite un crash sur un
    // champ optionnel manquant (ex. motif vide).
    nullGetter: () => '',
  });

  doc.render(data);

  return doc.getZip().generate({ type: 'nodebuffer' });
}

/**
 * Remplace l'image "cachet" (placeholder transparent dans le template) par
 * le vrai cachet + signature de l'entreprise, directement dans l'archive
 * .docx déjà générée. `mediaFileName` doit correspondre exactement au nom
 * du fichier média du placeholder dans le template d'origine — voir la
 * constante ORCA_CACHET_MEDIA_FILE ci-dessous pour chaque type de document.
 */
export function swapCachetImage(
  docxBuffer: Buffer,
  cachetImageBuffer: Buffer,
  mediaFileName: string,
): Buffer {
  const zip = new PizZip(docxBuffer);
  const target = `word/media/${mediaFileName}`;
  if (!zip.file(target)) {
    // Le placeholder n'existe pas sous ce nom dans ce template — on ignore
    // silencieusement plutôt que de faire planter la génération du document ;
    // le document sort simplement sans cachet.
    return docxBuffer;
  }
  zip.file(target, cachetImageBuffer);
  return zip.generate({ type: 'nodebuffer' });
}

// ✅ Nom exact du fichier média du placeholder cachet dans chaque template —
// déterminé une fois lors de la préparation du template (voir commentaire
// dans le fichier .docx source : c'est la 2e image insérée, après le logo).
export const ORCA_CACHET_MEDIA_FILE: Record<OrcaLeaveDocType, string> = {
  conge: 'image2.png',
  absence: 'image2.png',
};

export function getOrcaTemplateFile(docType: OrcaLeaveDocType): string {
  return docType === 'conge' ? 'conge.docx' : 'absence.docx';
}

/**
 * Télécharge une image depuis une URL (ex. cachetUrl Cloudinary) et retourne
 * son buffer. Utilisé pour récupérer le cachet au moment de générer le
 * document — pas de mise en cache, volontairement simple.
 */
export async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`Impossible de récupérer l'image : ${url} (${res.status})`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
