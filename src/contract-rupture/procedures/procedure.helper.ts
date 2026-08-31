// ============================================================================
// procedure.helper.ts — Couche 4 : checklist + alertes par type de rupture
// Tout est consultatif — Konza conseille, le RH décide
// ============================================================================

import {
  MotifRupture,
  StatutPreavis,
  RuptureAlerte,
  ChecklistItem,
  StatutEtape,
} from '../dto/create-rupture.dto';
import { AncienneteResult } from '../helpers/calcul.helper';

// ─── GÉNÉRATION DE LA CHECKLIST PROCÉDURALE ──────────────────────────────────

export function genererChecklist(
  motif: MotifRupture,
  typeContrat: 'CDI' | 'CDD',
  statutPreavis: StatutPreavis,
  nbSalaries?: number,
): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  switch (motif) {
    case 'LICENCIEMENT_MOTIF_PERSONNEL':
      items.push(
        _item(
          'CONV_PRELIM',
          'Convocation à entretien préalable',
          'Lettre RAR ou remise en main propre — mentionner objet, date, heure, lieu, possibilité assistance',
          'CT art. 39',
          true,
        ),
        _item(
          'DELAI_CONV_ENTRETIEN',
          'Délai entre convocation et entretien',
          'Respecter le délai conventionnel (5 jours ouvrables selon usage)',
          '',
          false,
        ),
        _item(
          'ENTRETIEN',
          'Entretien préalable réalisé',
          'Exposer les motifs, écouter le salarié, noter les observations',
          '',
          true,
        ),
        _item(
          'DELAI_NOTIF',
          'Délai entre entretien et notification',
          "Minimum 2 jours ouvrables après l'entretien selon pratique inspectorale",
          '',
          false,
        ),
        _item(
          'NOTIF_LIC',
          'Lettre de licenciement notifiée',
          "Lettre RAR — motif précis et réel, date d'effet, durée préavis",
          'CT art. 39',
          true,
        ),
      );
      break;

    case 'LICENCIEMENT_FAUTE_GRAVE':
      items.push(
        _item(
          'DEFENSE_SALARIE',
          'Salarié convoqué pour présenter sa défense',
          'Le salarié peut se faire assister par une personne de son choix',
          'CT art. 41',
          true,
        ),
        _item(
          'DELAI_DEFENSE',
          'Délai de défense respecté (max 30 jours)',
          'Relations de travail suspendues pendant ce délai — salaire maintenu',
          'CT art. 41',
          true,
        ),
        _item(
          'MISE_A_PIED',
          'Mise à pied conservatoire notifiée si nécessaire',
          'Pendant la période de défense uniquement',
          '',
          false,
        ),
        _item(
          'NOTIF_LIC',
          'Lettre de licenciement pour faute grave notifiée',
          'Après présentation de la défense — motif précis',
          'CT art. 41',
          true,
        ),
      );
      break;

    case 'LICENCIEMENT_FAUTE_LOURDE':
      items.push(
        _item(
          'DEFENSE_SALARIE',
          'Salarié convoqué pour présenter sa défense',
          'Le salarié peut se faire assister par une personne de son choix',
          'CT art. 41',
          true,
        ),
        _item(
          'DELAI_DEFENSE',
          'Délai de défense respecté (max 30 jours)',
          'Relations de travail suspendues pendant ce délai',
          'CT art. 41',
          true,
        ),
        _item(
          'RESERVE_PREJUDICE',
          'Montant du préjudice mis en réserve si applicable',
          'En attente des décisions de justice — Convention Industrie art. 29',
          '',
          false,
        ),
        _item(
          'NOTIF_LIC',
          'Lettre de licenciement pour faute lourde notifiée',
          '',
          'CT art. 41',
          true,
        ),
      );
      break;

    case 'LICENCIEMENT_ECONOMIQUE':
      items.push(
        _item(
          'ALTERNATIVES',
          "Recherche d'alternatives documentée",
          'Reclassement, réduction temps, formation, chômage technique — preuves à conserver',
          '',
          false,
        ),
      );
      if (nbSalaries && nbSalaries >= 11) {
        items.push(
          _item(
            'CONSULTATION_DP',
            'Consultation des délégués du personnel',
            "Réunion d'information, communication des éléments économiques, recueil des avis, PV",
            'CT art. 39 + art. 177',
            false,
          ),
        );
      }
      items.push(
        _item(
          'NOTIF_INSPECTION',
          "Notification à l'Inspection du Travail",
          'Lettre précisant : nombre de salariés, catégories, motifs, calendrier, mesures accompagnement',
          'CT art. 39',
          false,
        ),
        _item(
          'ORDRE_LICENCIEMENTS',
          'Ordre des licenciements établi',
          'Critères CT art. 39 : qualification > ancienneté (+1 an si marié, +1 an/enfant) > famille',
          'CT art. 39',
          false,
        ),
        _item(
          'CONV_PRELIM',
          'Convocation à entretien préalable',
          'Lettre RAR — motif économique, date entretien, possibilité assistance',
          '',
          true,
        ),
        _item(
          'ENTRETIEN',
          'Entretien préalable réalisé',
          'Exposer situation économique, écouter propositions reclassement',
          '',
          true,
        ),
        _item(
          'NOTIF_LIC',
          'Lettre de licenciement économique notifiée',
          "Motifs économiques détaillés, date d'effet, durée préavis, droits, priorité réembauche",
          'CT art. 39',
          true,
        ),
        _item(
          'PRIORITE_REEMBAUCHE',
          'Mention priorité de réembauche dans la lettre',
          'Durée variable selon convention (1 ou 2 ans)',
          'CT art. 39',
          false,
        ),
      );
      break;

    case 'RUPTURE_CONVENTIONNELLE':
      items.push(
        _item(
          'ACCORD_ECRIT',
          'Accord de rupture conventionnelle formalisé par écrit',
          'Consentement du salarié exprimé par écrit — CT art. 39',
          'CT art. 39',
          true,
        ),
        _item(
          'PRIME_DEPART',
          'Prime de départ négociée',
          'En sus des indemnités légales — montant laissé aux parties (CT art. 39)',
          'CT art. 39',
          false,
        ),
      );
      break;

    case 'RETRAITE_EMPLOYEUR':
    case 'RETRAITE_SALARIE':
      items.push(
        _item(
          'DOSSIER_CNSS',
          'Dossier CNSS constitué et transmis',
          "L'employeur est tenu d'assurer la transmission du dossier à la CNSS",
          '',
          true,
        ),
        _item(
          'NOTIF_RETRAITE',
          'Notification de mise à la retraite',
          'Dans le délai normal et conventionnel de préavis',
          '',
          true,
        ),
        _item(
          'RELEVE_SERVICE',
          'Relevé de service remis au salarié',
          'Récapitulatif de carrière pour NTIC — document base de calcul rappels',
          '',
          false,
        ),
      );
      break;

    case 'DECES':
      items.push(
        _item(
          'HERITIERS',
          'Identification des héritiers légaux',
          "Certificat d'hérédité ou acte notarié requis selon convention",
          '',
          true,
        ),
        _item(
          'STC_HERITIERS',
          'STC et indemnités versés aux héritiers',
          'Salaires présence + congés + indemnités acquises à la date du décès',
          '',
          true,
        ),
        _item(
          'INDEM_DECES',
          'Indemnité décès versée si conditions remplies',
          'Vérifier ancienneté minimale selon convention',
          '',
          true,
        ),
        _item(
          'FRAIS_OBSEQUES',
          'Participation frais obsèques selon convention',
          'Montants et nature selon convention collective applicable',
          '',
          false,
        ),
        _item(
          'CERT_TRAVAIL',
          'Certificat de travail remis aux héritiers',
          '',
          'CT art. 46',
          true,
        ),
      );
      break;

    case 'INVALIDITE':
      items.push(
        _item(
          'CONSTAT_MEDICAL',
          'Inaptitude constatée médicalement',
          'Médecin agréé — après délai de suspension de 6 mois (8 mois Hôtellerie, 12 mois Presse)',
          '',
          true,
        ),
        _item(
          'TENTATIVE_RECLASSEMENT',
          'Tentative de reclassement documentée',
          'Rechercher dans toute la mesure du possible avec délégués du personnel',
          '',
          false,
        ),
        _item(
          'NOTIF_RUPTURE',
          'Notification rupture par lettre recommandée',
          "Après avoir fait part de l'intention de mettre fin au contrat",
          '',
          true,
        ),
      );
      break;

    case 'FIN_CDD':
      items.push(
        _item(
          'CERT_TRAVAIL',
          'Certificat de travail remis',
          "À l'expiration du terme — CT art. 46",
          'CT art. 46',
          true,
        ),
      );
      break;

    case 'RUPTURE_ANTICIPEE_CDD_EMPLOYEUR':
      items.push(
        _item(
          'NOTIF_RUPTURE',
          'Notification de rupture anticipée',
          'CT art. 37-3 : rupture avant terme seulement pour faute lourde ou force majeure',
          'CT art. 37-3',
          true,
        ),
        _item(
          'INDEM_TERME',
          "Indemnité calculée jusqu'au terme",
          "Rémunérations et avantages restants jusqu'à la date prévue — CT art. 37-4",
          'CT art. 37-4',
          true,
        ),
      );
      break;

    case 'DEMISSION':
      items.push(
        _item(
          'DEMISSION_ECRITE',
          'Démission formulée par écrit',
          'Document daté et signé par le salarié',
          '',
          true,
        ),
        _item(
          'PREAVIS_DEMISSION',
          'Préavis respecté ou dispensé',
          'Le salarié doit respecter son préavis sauf accord employeur',
          'CT art. 39',
          true,
        ),
      );
      break;
  }

  // Étapes communes à tous les types
  items.push(
    _item(
      'STC',
      'Solde de tout compte versé',
      'Dès la cessation de service — CT art. 88',
      'CT art. 88',
      true,
    ),
    _item(
      'CERT_TRAVAIL',
      'Certificat de travail remis',
      'Obligatoire sous peine de dommages-intérêts — CT art. 46',
      'CT art. 46',
      true,
    ),
    _item(
      'ATTESTATION_CNSS',
      'Attestation CNSS délivrée',
      'Permet au salarié de faire valoir ses droits',
      '',
      true,
    ),
  );

  return items;
}

// ─── GÉNÉRATION DES ALERTES ───────────────────────────────────────────────────

export function genererAlertes(params: {
  motif: MotifRupture;
  anciennete: AncienneteResult;
  seuilMoisAnc: number;
  statutPreavis: StatutPreavis;
  avg12Source: string;
  soldeCongesSource: string;
  nbSalaries?: number;
  dateRupture: Date;
  dateFinEffective: Date;
  conventionCode: string;
}): RuptureAlerte[] {
  const alertes: RuptureAlerte[] = [];
  const {
    motif,
    anciennete,
    seuilMoisAnc,
    statutPreavis,
    avg12Source,
    soldeCongesSource,
    nbSalaries,
    dateFinEffective,
    conventionCode,
  } = params;

  // ── Ancienneté insuffisante pour indemnité de licenciement
  if (
    motif.startsWith('LICENCIEMENT') &&
    motif !== 'LICENCIEMENT_FAUTE_GRAVE' &&
    motif !== 'LICENCIEMENT_FAUTE_LOURDE' &&
    anciennete.totalMois < seuilMoisAnc
  ) {
    alertes.push({
      niveau: 'ATTENTION',
      code: 'ANCIENNETE_INSUFFISANTE',
      message: `Ancienneté insuffisante pour l'indemnité de licenciement : ${anciennete.totalMois} mois / ${seuilMoisAnc} mois requis. Seuls le préavis et les congés sont dus.`,
      article: `Convention ${conventionCode}`,
    });
  }

  // ── Faute grave/lourde : rappel pas d'indemnité licenciement
  if (
    motif === 'LICENCIEMENT_FAUTE_GRAVE' ||
    motif === 'LICENCIEMENT_FAUTE_LOURDE'
  ) {
    alertes.push({
      niveau: 'INFO',
      code: 'FAUTE_PAS_INDEM',
      message: `${motif === 'LICENCIEMENT_FAUTE_LOURDE' ? 'Faute lourde' : 'Faute grave'} : aucune indemnité de licenciement ni préavis. Seuls les congés payés non pris restent dus.`,
      article: 'CT art. 41',
    });
  }

  // ── Données avg12 estimées
  if (avg12Source === 'fallback') {
    alertes.push({
      niveau: 'ATTENTION',
      code: 'AVG12_ESTIME',
      message:
        "La moyenne des 12 derniers mois contient des mois estimés (salaire actuel utilisé en remplacement). Pour un calcul précis, saisir l'historique des salaires.",
    });
  }

  // ── Données congés estimées
  if (soldeCongesSource === 'estime') {
    alertes.push({
      niveau: 'ATTENTION',
      code: 'CONGES_ESTIME',
      message:
        'Solde de congés calculé sans historique avant Konza. Le solde peut être surestimé. Vérifiez avec vos archives RH.',
    });
  }

  // ── Licenciement économique > 10 salariés → consultation obligatoire
  if (motif === 'LICENCIEMENT_ECONOMIQUE' && nbSalaries && nbSalaries >= 11) {
    alertes.push({
      niveau: 'ATTENTION',
      code: 'CONSULTATION_DP_REQUISE',
      message: `Entreprise de ${nbSalaries} salariés : consultation des délégués du personnel obligatoire avant tout licenciement économique.`,
      article: 'CT art. 39 + art. 177',
    });
  }

  // ── Délai de paiement
  const maintenant = new Date();
  const joursDepuisFin = Math.floor(
    (maintenant.getTime() - dateFinEffective.getTime()) / 86_400_000,
  );
  if (joursDepuisFin > 0) {
    alertes.push({
      niveau: joursDepuisFin > 8 ? 'CRITIQUE' : 'ATTENTION',
      code: 'DELAI_PAIEMENT',
      message: `Le solde de tout compte doit être versé dès la cessation de service (CT art. 88). ${joursDepuisFin > 0 ? `Fin de contrat il y a ${joursDepuisFin} jour(s).` : ''}`,
      article: 'CT art. 88',
    });
  }

  // ── Rupture conventionnelle : prime de départ obligatoire en sus
  if (motif === 'RUPTURE_CONVENTIONNELLE') {
    alertes.push({
      niveau: 'INFO',
      code: 'PRIME_DEPART_CONVENTIONNELLE',
      message:
        'Rupture conventionnelle : le salarié a droit à une prime de départ (montant négocié) EN PLUS des indemnités légales — CT art. 39.',
      article: 'CT art. 39',
    });
  }

  // ── Délégué du personnel : protection renforcée
  if (motif.startsWith('LICENCIEMENT')) {
    alertes.push({
      niveau: 'INFO',
      code: 'DELEGUE_PROTECTION',
      message:
        "Si le salarié est délégué du personnel (ou candidat récent), son licenciement nécessite l'autorisation préalable de la commission des litiges.",
      article: 'CT art. 176',
    });
  }

  // ── CDD : vérifier motif de rupture anticipée
  if (motif === 'RUPTURE_ANTICIPEE_CDD_EMPLOYEUR') {
    alertes.push({
      niveau: 'CRITIQUE',
      code: 'CDD_RUPTURE_ANTICIPEE',
      message:
        "Rupture anticipée de CDD par l'employeur : uniquement admise en cas de faute lourde ou force majeure (CT art. 37-3). Hors ces cas, le salarié perçoit les salaires jusqu'au terme.",
      article: 'CT art. 37-3',
    });
  }

  // ── Pétrole : même barème éco et personnel
  if (conventionCode === 'PETROLE' && motif === 'LICENCIEMENT_ECONOMIQUE') {
    alertes.push({
      niveau: 'INFO',
      code: 'PETROLE_EGO_EGAL_PERSO',
      message:
        'Convention Para-Pétrolier : le barème de licenciement économique est identique au motif personnel (45%/50%/60%/65%/70%/85%).',
      article: 'Convention Pétrole Art. 34',
    });
  }

  // ── BTP : exclusion primes diverses de la base
  if (conventionCode === 'BTP') {
    alertes.push({
      niveau: 'INFO',
      code: 'BTP_BASE_RESTREINTE',
      message:
        "Convention BTP : la base de calcul exclut les primes diverses en plus des remboursements de frais. Vérifier que l'avg12 ne contient que les prestations de travail effectif.",
      article: 'Convention BTP Art. 21',
    });
  }

  // ── Presse : suspension maladie 12 mois (vs 6 partout ailleurs)
  if (conventionCode === 'PRESSE' && motif === 'INVALIDITE') {
    alertes.push({
      niveau: 'INFO',
      code: 'PRESSE_MALADIE_12MOIS',
      message:
        'Convention Presse : délai de suspension pour maladie = 12 mois (vs 6 mois dans les autres conventions). Vérifier ce délai avant rupture.',
      article: 'Convention Presse Art. 36',
    });
  }

  return alertes;
}

// ─── Utilitaire interne ───────────────────────────────────────────────────────
function _item(
  id: string,
  etape: string,
  description: string,
  articleRef?: string,
  obligatoire: boolean = true,
): ChecklistItem {
  return {
    id,
    etape,
    description,
    statut: 'A_FAIRE',
    obligatoire,
    articleRef,
  };
}
