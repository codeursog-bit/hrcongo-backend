// ============================================================================
// 📁 src/contracts/contract-content.ts
//
// Source UNIQUE du texte juridique et de la structure de chaque type de
// contrat. Ni le générateur Word (contract-docx-builder.ts) ni le générateur
// PDF (contract-pdf-builder.ts) ne contiennent de texte en dur : les deux
// lisent ce même modèle de données, garantissant que le Word téléchargé et
// le PDF prévisualisé disent toujours exactement la même chose.
//
// Le contenu du Contrat de travail (CDI/CDD) reproduit fidèlement, article
// par article, le modèle réel fourni par l'entreprise.
// ============================================================================

export interface ContractTemplateData {
  titreContrat: string;
  nomEntreprise: string;
  adresseEntreprise: string;
  telephoneEntreprise: string;
  formeJuridique: string;
  representantNom: string;
  representantFonction: string;

  civilite: string;
  nom: string;
  prenom: string;
  dateNaissance: string;
  lieuNaissance: string;
  nationalite: string;
  nomPere: string;
  nomMere: string;
  adresseEmploye: string;
  telephoneEmploye: string;
  nombreEnfants: number;
  situationMatrimoniale: string;

  poste: string;
  categorie: string;
  lieuTravail: string;

  dureeTexte: string;
  dateDebut: string;
  dateFin: string;
  estCDD: boolean;
  hasEssai: boolean;
  periodeEssai: string;

  salaireBase: string;
  sursalaire: string;
  heuresSupplementaires: string;
  primes: { label: string; montant: string }[];
  totalBrut: string;
  retenuesCnss: string;
  retenuesIts: string;
  tol: string;
  transport: string;
  indemniteTransport: string;
  indemnites: { label: string; montant: string }[];
  netAPayer: string;

  montantForfaitaire: string;
  dureeStageTexte: string;
  renouvelable: boolean;

  taches: string;
  horaires: string;
  emoluments: string;
  tauxBnc: number;
  montantBnc: string;

  villeSignature: string;
  dateSignature: string;
  piedDePage: string;
}

export type ContractKind = 'CONTRAT_TRAVAIL' | 'PRESTATION_SERVICES' | 'CONSULTANT' | 'STAGE';

export interface SalaryRow {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
}

export interface TextLine {
  text: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
}

export type ContentBlock =
  | { type: 'article'; heading: string; paragraphs: string[] }
  | { type: 'salary'; intro: string; rows: SalaryRow[] };

export interface ContractContent {
  title: string;
  preamble: TextLine[]; // "Entre les soussignés..." jusqu'à "Il a été convenu..."
  blocks: ContentBlock[];
  closing: TextLine[]; // "Fait à..." + "En X exemplaires..."
  signature: {
    leftLabel: string; // "Le travailleur" ou "L'Employé(e)" selon le type
    leftName: string;
    leftNote?: string;
    rightLabel: string; // "L'Employeur"
    rightName: string;
    rightNote?: string;
  };
  footer: string;
}

function salaryRows(d: ContractTemplateData): SalaryRow[] {
  const rows: SalaryRow[] = [{ label: 'Salaire de base', value: `${d.salaireBase} FCFA` }];
  if (Number(d.sursalaire.replace(/\D/g, '')) > 0) rows.push({ label: 'Sursalaire', value: `${d.sursalaire} FCFA` });
  if (Number(d.heuresSupplementaires.replace(/\D/g, '')) > 0)
    rows.push({ label: 'Heures supplémentaires forfaitaires', value: `${d.heuresSupplementaires} FCFA` });
  d.primes.forEach((p) => rows.push({ label: p.label, value: `${p.montant} FCFA` }));
  if (Number(d.transport.replace(/\D/g, '')) > 0) rows.push({ label: 'Transport', value: `${d.transport} FCFA` });
  rows.push({ label: 'TOTAL BRUT', value: `${d.totalBrut} FCFA`, bold: true });
  rows.push({ label: 'Retenues CNSS', value: `- ${d.retenuesCnss} FCFA`, muted: true });
  rows.push({ label: 'Retenues ITS', value: `- ${d.retenuesIts} FCFA`, muted: true });
  rows.push({ label: 'TOL', value: `- ${d.tol} FCFA`, muted: true });
  if (Number(d.indemniteTransport.replace(/\D/g, '')) > 0)
    rows.push({ label: 'Indemnité de transport', value: `${d.indemniteTransport} FCFA` });
  d.indemnites.forEach((i) => rows.push({ label: i.label, value: `${i.montant} FCFA` }));
  rows.push({ label: 'NET À PAYER', value: `${d.netAPayer} FCFA`, bold: true });
  return rows;
}

// ════════════════════════════════════════════════════════════════════════════
// CONTRAT DE TRAVAIL (CDI / CDD) — reproduit fidèlement le modèle réel
// ════════════════════════════════════════════════════════════════════════════
function contratTravailPreamble(d: ContractTemplateData): TextLine[] {
  return [
    { text: 'Entre les soussignés :' },
    { text: 'Le présent contrat est conclu entre' },
    { text: "D'une part," },
    { text: `La société ${d.nomEntreprise}, ${d.adresseEntreprise}.` },
    { text: `Forme juridique : ${d.formeJuridique}` },
    { text: `Représentée par ${d.representantNom}, agissant en qualité de ${d.representantFonction}, dûment habilité(e),` },
    { text: `Ci-après dénommée « l'Employeur »` },
    { text: 'ET' },
    { text: `${d.civilite} ${d.prenom} ${d.nom}`, bold: true },
    { text: `Né(e) le : ${d.dateNaissance} à ${d.lieuNaissance}` },
    { text: ` Nationalité : ${d.nationalite} ` },
    { text: `Nom de père : ${d.nomPere || '—'}` },
    { text: `Nom de la mère : ${d.nomMere || '—'}` },
    { text: `Adresse : ${d.adresseEmploye}` },
    { text: `Nombre d'enfants à charge : ${d.nombreEnfants} ; ${d.situationMatrimoniale}` },
    { text: `Ci-après dénommé(e) « L'employé(e) »` },
    { text: "D'autre part" },
    {
      text: `Il est établi par le présent contrat qui, outre les dispositions ci-dessous, sera régi par les dispositions du Code du travail en République du Congo et de la Convention Collective du Commerce.`,
    },
  ];
}

function contratTravailBlocks(d: ContractTemplateData): ContentBlock[] {
  const blocks: ContentBlock[] = [
    {
      type: 'article',
      heading: "ARTICLE 1ER : OBJET DE L'EMPLOI",
      paragraphs: [
        `L'employeur engage ${d.civilite} ${d.prenom} ${d.nom}, reconnu(e) physiquement apte suivant le certificat ci-joint, en qualité de ${d.poste}, ou tout autre fonction compatible à ses fonctions et à ses aptitudes, classé(e) à la catégorie ${d.categorie}, de la convention collective de commerce en vue de servir à ${d.lieuTravail} ou tout autre lieu où sa présence serait nécessaire.`,
      ],
    },
    {
      type: 'article',
      heading: 'ARTICLE 2 : DUREE DU CONTRAT',
      paragraphs: [
        `En vertu des dispositions de l'article 32 de la loi 6/96 1996, le présent contrat est conclu, pour une durée ${d.dureeTexte} à compter du ${d.dateDebut}${d.estCDD ? `, jusqu'au ${d.dateFin}` : ''}.`,
      ],
    },
  ];

  if (d.hasEssai) {
    blocks.push({
      type: 'article',
      heading: 'ARTICLE 3 : ESSAI',
      paragraphs: [
        `La période d'essai est fixée à ${d.periodeEssai} conformément à l'article 15 de la Convention collective de commerce. Pendant cette période, les parties peuvent se séparer avec ou sans préavis ni indemnités en se conformant toutefois aux dispositions de la convention collective du commerce.`,
      ],
    });
  }

  blocks.push(
    {
      type: 'article',
      heading: "ARTICLE 4 : OBLIGATION DE L'EMPLOYE",
      paragraphs: [
        `L'Employé(e) s'engage à consacrer toute son activité à l'Employeur et à observer les instructions et consignes qui lui seront données par ses supérieurs.`,
        `Il/elle observera la plus grande discrétion sur tous les faits dont il/elle pourra avoir connaissance en raison de ses fonctions et de son appartenance à l'entreprise.`,
        `L'Employé(e) est tenu(e) d'observer l'horaire de travail, les principes et règles de discipline en vigueur dans la société.`,
      ],
    },
    {
      type: 'salary',
      intro: `Pendant la durée du présent contrat ${d.civilite} ${d.prenom} ${d.nom}, percevra une rémunération nette mensuelle de ${d.netAPayer} FCFA, payable au dernier jour de chaque mois à terme échu, décomposée ainsi qu'il suit :`,
      rows: salaryRows(d),
    },
    {
      type: 'article',
      heading: 'ARTICLE 6 : CONGES PAYES',
      paragraphs: [
        `L'Employé(e) acquiert droit aux congés de vingt-six (26) jours ouvrables par an. La période ouvrant droit aux congés est de douze (12) mois.`,
        `Il/elle bénéficiera du droit au congé supplémentaire dans les conditions fixées par la Convention Collective susvisée.`,
      ],
    },
    {
      type: 'article',
      heading: 'ARTICLE 7 : SOINS MEDICAUX',
      paragraphs: [
        `L'employeur assure les frais médicaux et la fourniture des produits pharmaceutiques au travailleur dans les conditions prévues aux articles 146 et 147 du Code du travail, aux arrêtés d'application, et aux articles 52 et 53 de la Convention Collective du Commerce.`,
      ],
    },
    {
      type: 'article',
      heading: 'ARTICLE 8 : ACCIDENTS DU TRAVAIL',
      paragraphs: [
        `La responsabilité des accidents qui pourraient survenir à l'Employé(e) du fait ou à l'occasion du travail est en principe assurée par la Caisse Nationale de Sécurité Sociale du Congo, qui gère la réparation des accidents du travail.`,
      ],
    },
    {
      type: 'article',
      heading: 'ARTICLE 9 : RETRAITE',
      paragraphs: [
        `L'Employé(e) est affilié(e) au régime général de retraite géré par la Caisse Nationale de Sécurité Sociale. Il/elle aura, à ce titre, à verser dans la limite du plafond en vigueur une cotisation, dont le taux est à la date de signature du contrat de 4%, précomptée sur son salaire, l'Employeur versant pour sa part une cotisation de 8%.`,
      ],
    },
    {
      type: 'article',
      heading: 'ARTICLE 10 : RESILIATION DE CONTRAT',
      paragraphs: [
        `Le présent contrat de travail peut être résilié moyennant un préavis de deux (02) mois, donné par l'une ou l'autre des parties et exécuté conformément aux dispositions des articles 39 nouveau et 41 nouveau du Code du Travail, et 20 de la convention collective susvisée.`,
        `Toutefois, la résiliation de ce contrat de travail peut intervenir sans préavis en cas de faute lourde, faute grave, sous réserve de l'appréciation de la juridiction compétente, ou en cas de force majeure.`,
      ],
    },
    {
      type: 'article',
      heading: 'ARTICLE 11 : REGLEMENT DES CONFLITS',
      paragraphs: [
        `Tout conflit qui pourrait survenir à l'occasion de l'exécution du présent contrat sera soumis par la partie la plus diligente à la Direction Départementale du Travail du lieu d'exécution du contrat en vue de son règlement amiable. En cas d'échec de la procédure amiable, le litige sera soumis au tribunal du travail du lieu d'emploi.`,
      ],
    },
    {
      type: 'article',
      heading: 'ARTICLE 12 : DROIT APPLICABLE',
      paragraphs: [
        `Pour l'exécution du présent contrat de travail, les parties déclarent se référer au Code du Travail de la République du Congo (loi 45/75 du 15 mars 1975 et loi 6/96 du 6 mars 1996), aux lois le modifiant, aux différents règlements d'application, et à la Convention Collective de Commerce.`,
      ],
    },
    {
      type: 'article',
      heading: "ARTICLE 13 : ENREGISTREMENT DU CONTRAT A L'ACPE",
      paragraphs: [
        `Conformément aux dispositions de la loi n° 7-2019 du 9 avril 2019 portant création de l'ACPE, le présent contrat de travail sera soumis à l'agence ACPE compétente pour enregistrement.`,
      ],
    },
  );

  return blocks;
}

// ════════════════════════════════════════════════════════════════════════════
// PRESTATION DE SERVICES / CONSULTANCE
// ════════════════════════════════════════════════════════════════════════════
function prestationPreamble(d: ContractTemplateData): TextLine[] {
  return [
    { text: 'Entre les soussignés :' },
    { text: `La société ${d.nomEntreprise}${d.formeJuridique ? `, ${d.formeJuridique}` : ''}, dont le siège social est situé ${d.adresseEntreprise}${d.telephoneEntreprise ? `, téléphone : ${d.telephoneEntreprise}` : ''}, représentée par ${d.representantNom}, agissant en qualité de ${d.representantFonction}, dûment habilité(e) à l'effet des présentes,` },
    { text: `Ci-après dénommée « le Client »,` },
    { text: 'Et' },
    { text: `${d.civilite} ${d.prenom} ${d.nom}, né(e) le ${d.dateNaissance} à ${d.lieuNaissance}, de nationalité ${d.nationalite}, ${d.situationMatrimoniale}, demeurant ${d.adresseEmploye}${d.telephoneEmploye ? `, téléphone : ${d.telephoneEmploye}` : ''},` },
    { text: `Ci-après dénommé(e) « le Prestataire »,` },
    { text: 'Il a été convenu et arrêté ce qui suit :' },
  ];
}

function prestationBlocks(d: ContractTemplateData): ContentBlock[] {
  const tachesLines = (d.taches || '').split('\n').filter(Boolean);
  const horairesLines = (d.horaires || '').split('\n').filter(Boolean);

  const blocks: ContentBlock[] = [
    {
      type: 'article',
      heading: 'Article 1 — Nature de la prestation',
      paragraphs: [
        `Le Prestataire, ${d.civilite} ${d.prenom} ${d.nom}, agissant en toute indépendance et hors de tout lien de subordination, s'engage à réaliser pour le compte du Client les prestations relevant de sa qualification professionnelle de ${d.poste}, notamment :`,
        ...(tachesLines.length
          ? tachesLines.map((t) => (t.startsWith('-') ? t : `- ${t}`))
          : ["- Prestations à définir d'un commun accord entre les parties."]),
      ],
    },
    {
      type: 'article',
      heading: 'Article 2 — Durée',
      paragraphs: [
        `Le présent contrat est conclu pour une durée ${d.dureeTexte}, à compter du ${d.dateDebut}${d.estCDD ? ` jusqu'au ${d.dateFin}` : ''}. Il pourra être renouvelé par accord exprès et écrit des parties.`,
      ],
    },
  ];

  if (horairesLines.length) {
    blocks.push({ type: 'article', heading: 'Article 3 — Horaires des prestations', paragraphs: horairesLines });
  }

  blocks.push(
    {
      type: 'article',
      heading: 'Article 4 — Statut du prestataire',
      paragraphs: [
        `Le Prestataire n'est lié au Client par aucun lien de subordination et n'est pas soumis aux dispositions du Code du travail relatives aux salariés. Il demeure seul responsable de ses obligations fiscales et sociales.`,
      ],
    },
    {
      type: 'salary',
      intro: `Le Client s'engage à verser mensuellement au Prestataire, sur présentation de facture, la rémunération suivante :`,
      rows: [
        { label: 'Émoluments mensuels', value: `${d.emoluments} FCFA`, bold: true },
        { label: `Cotisation BNC (${d.tauxBnc}%, à la charge du prestataire)`, value: `${d.montantBnc} FCFA`, muted: true },
      ],
    },
    {
      type: 'article',
      heading: 'Article 7 — Confidentialité et propriété intellectuelle',
      paragraphs: [
        `Le Prestataire s'engage à garder confidentielle toute information relative à l'activité du Client dont il aurait connaissance dans le cadre de sa mission, pendant toute sa durée et après son terme. Les livrables produits dans le cadre strict de la présente prestation demeurent la propriété du Client, sauf stipulation contraire écrite.`,
      ],
    },
    {
      type: 'article',
      heading: 'Article 8 — Responsabilité',
      paragraphs: [
        `Le Prestataire est seul responsable des moyens qu'il met en œuvre pour l'exécution de sa mission. Il garantit disposer de toute couverture (assurance, autorisation d'exercer) nécessaire à l'exécution des prestations objet du présent contrat.`,
      ],
    },
    {
      type: 'article',
      heading: 'Article 9 — Résiliation',
      paragraphs: [
        `Chacune des parties peut mettre fin au présent contrat moyennant un préavis raisonnable notifié par écrit à l'autre partie.`,
      ],
    },
    {
      type: 'article',
      heading: 'Article 10 — Litiges',
      paragraphs: [
        `Tout différend relatif au présent contrat sera réglé à l'amiable ; à défaut, il relèvera des juridictions compétentes de la République du Congo.`,
      ],
    },
  );

  return blocks;
}

// ════════════════════════════════════════════════════════════════════════════
// STAGE
// ════════════════════════════════════════════════════════════════════════════
function stagePreamble(d: ContractTemplateData): TextLine[] {
  return [
    { text: 'Entre les soussignés :' },
    { text: `La société ${d.nomEntreprise} dont le siège social se situe ${d.adresseEntreprise}, TEL : ${d.telephoneEntreprise}, représentée par ${d.representantNom} ayant tous pouvoirs à l'effet, en sa qualité de ${d.representantFonction}.` },
    { text: `Ci-après dénommée « l'Employeur »,` },
    { text: 'Et' },
    { text: `${d.civilite} ${d.prenom} ${d.nom}, né(e) le ${d.dateNaissance} à ${d.lieuNaissance}, de nationalité ${d.nationalite}, ${d.situationMatrimoniale}, demeurant ${d.adresseEmploye},` },
    { text: `Ci-après dénommé(e) « le/la stagiaire »,` },
    { text: 'Il a été convenu et arrêté ce qui suit :' },
  ];
}

function stageBlocks(d: ContractTemplateData): ContentBlock[] {
  return [
    {
      type: 'article',
      heading: 'Article 1 — Objet',
      paragraphs: [
        `L'Employeur accueille ${d.civilite} ${d.prenom} ${d.nom} en qualité de stagiaire, aux fins de lui permettre d'acquérir une expérience professionnelle et de mettre en pratique ses connaissances théoriques.`,
      ],
    },
    {
      type: 'article',
      heading: "Article 2 — Obligations de l'entreprise d'accueil",
      paragraphs: [
        `L'Employeur s'assurera de l'aptitude médicale du/de la stagiaire, ne l'emploiera qu'aux travaux et services en rapport avec son stage, veillera à son assiduité, et lui délivrera au terme du stage un certificat constatant l'exécution du présent contrat.`,
      ],
    },
    {
      type: 'article',
      heading: 'Article 3 — Obligations du/de la stagiaire',
      paragraphs: [
        `${d.civilite} ${d.prenom} ${d.nom} s'engage à se conformer aux prescriptions réglementaires, disciplinaires, techniques, d'hygiène et de sécurité de l'entreprise, et à se mettre à l'entière disposition de l'Employeur pour l'exécution des tâches liées à son stage.`,
      ],
    },
    {
      type: 'article',
      heading: 'Article 4 — Encadrement et confidentialité',
      paragraphs: [
        `L'Employeur désigne, le cas échéant, un tuteur ou une tutrice chargé(e) de l'encadrement du/de la stagiaire. Le/la stagiaire s'engage à observer la confidentialité la plus stricte sur les informations dont il/elle aurait connaissance durant son stage.`,
      ],
    },
    {
      type: 'salary',
      intro: `${d.civilite} ${d.prenom} ${d.nom} percevra un montant forfaitaire mensuel, payé chaque fin de mois ou selon toute périodicité mutuellement convenue, durant toute la période de stage :`,
      rows: [{ label: 'Gratification mensuelle', value: `${d.montantForfaitaire} FCFA`, bold: true }],
    },
    {
      type: 'article',
      heading: 'Article 6 — Durée',
      paragraphs: [
        `Le présent contrat de stage est conclu pour une durée ${d.dureeStageTexte || 'à préciser'}, allant du ${d.dateDebut} au ${d.dateFin}, ${d.renouvelable ? 'renouvelable si nécessaire' : 'non renouvelable'}.`,
      ],
    },
    {
      type: 'article',
      heading: 'Article 7 — Résiliation',
      paragraphs: [
        `La résiliation du présent contrat de stage, à l'initiative de l'une ou l'autre des parties, ne donne droit à aucune indemnité.`,
      ],
    },
  ];
}

// ── Point d'entrée unique ────────────────────────────────────────────────────
export function buildContractContent(kind: ContractKind, d: ContractTemplateData): ContractContent {
  if (kind === 'CONTRAT_TRAVAIL') {
    return {
      title: d.titreContrat,
      preamble: contratTravailPreamble(d),
      blocks: contratTravailBlocks(d),
      closing: [
        { text: `Fait à ${d.villeSignature}, le ${d.dateSignature}`, align: 'right' },
        { text: 'En quatre (4) exemplaires originaux', align: 'right' },
      ],
      signature: {
        leftLabel: 'Le travailleur',
        leftName: `${d.civilite} ${d.prenom} ${d.nom}`,
        leftNote: 'Précédée de la mention manuscrite « lu et approuvé »',
        rightLabel: "L'Employeur",
        rightName: `${d.representantNom} — ${d.representantFonction}`,
      },
      footer: d.piedDePage,
    };
  }

  if (kind === 'STAGE') {
    return {
      title: d.titreContrat,
      preamble: stagePreamble(d),
      blocks: stageBlocks(d),
      closing: [{ text: `Fait à ${d.villeSignature}, le ${d.dateSignature}, en deux exemplaires originaux.` }],
      signature: {
        leftLabel: "Pour l'Employeur",
        leftName: `${d.representantNom} — ${d.representantFonction}`,
        rightLabel: 'Le/la stagiaire',
        rightName: `${d.civilite} ${d.prenom} ${d.nom}`,
        rightNote: '« Lu et approuvé »',
      },
      footer: d.piedDePage,
    };
  }

  // PRESTATION_SERVICES / CONSULTANT
  return {
    title: d.titreContrat,
    preamble: prestationPreamble(d),
    blocks: prestationBlocks(d),
    closing: [{ text: `Fait à ${d.villeSignature}, le ${d.dateSignature}, en deux exemplaires originaux.` }],
    signature: {
      leftLabel: 'Pour le Client',
      leftName: `${d.representantNom} — ${d.representantFonction}`,
      rightLabel: 'Le Prestataire',
      rightName: `${d.civilite} ${d.prenom} ${d.nom}`,
      rightNote: '« Lu et approuvé »',
    },
    footer: d.piedDePage,
  };
}