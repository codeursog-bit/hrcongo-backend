// src/recruitment/recruitment-email-templates.ts
// ============================================================================
// Modèles d'e-mails du recruteur. Le recruteur les voit PRÉ-REMPLIS dans la
// fenêtre « Écrire au candidat » et peut les modifier avant l'envoi.
// Variables : {{prenom}} {{nom}} {{poste}} {{entreprise}} {{recruteur}}
//             {{date_entretien}} {{heure_entretien}} {{lieu}} {{salaire}} {{date_debut}}
// ============================================================================

export interface EmailTemplate {
  id: string;
  label: string;
  description: string;
  subject: string;
  body: string;
}

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'ACK',
    label: 'Accusé de réception',
    description: 'Confirmer la réception de la candidature',
    subject: 'Votre candidature — {{poste}}',
    body: `Bonjour {{prenom}},

Nous avons bien reçu votre candidature pour le poste de {{poste}} chez {{entreprise}} et nous vous en remercions.

Notre équipe l'étudie avec attention. Nous reviendrons vers vous dans les meilleurs délais.

Cordialement,
{{recruteur}}
{{entreprise}}`,
  },
  {
    id: 'MORE_INFO',
    label: 'Demande de documents',
    description: 'Réclamer des pièces ou des précisions',
    subject: 'Candidature {{poste}} — informations complémentaires',
    body: `Bonjour {{prenom}},

Pour poursuivre l'étude de votre candidature au poste de {{poste}}, pourriez-vous nous transmettre les éléments suivants :

- 
- 

Vous pouvez répondre directement à cet e-mail.

Cordialement,
{{recruteur}}
{{entreprise}}`,
  },
  {
    id: 'INTERVIEW_REMINDER',
    label: 'Rappel d’entretien',
    description: 'Rappeler la date, l’heure et le lieu',
    subject: 'Rappel — entretien pour le poste de {{poste}}',
    body: `Bonjour {{prenom}},

Nous vous rappelons votre entretien pour le poste de {{poste}} :

Date : {{date_entretien}}
Heure : {{heure_entretien}}
Lieu / lien : {{lieu}}

Merci de nous confirmer votre présence en répondant à cet e-mail.

Cordialement,
{{recruteur}}
{{entreprise}}`,
  },
  {
    id: 'REJECT_SCREENING',
    label: 'Refus après étude du dossier',
    description: 'Refus courtois avant entretien',
    subject: 'Suite de votre candidature — {{poste}}',
    body: `Bonjour {{prenom}},

Nous vous remercions de l'intérêt que vous portez à {{entreprise}} et du temps consacré à votre candidature au poste de {{poste}}.

Après étude attentive de votre dossier, nous ne pouvons malheureusement pas donner suite à votre candidature pour ce poste. Cette décision ne remet pas en cause la qualité de votre parcours.

Nous vous souhaitons plein succès dans vos recherches.

Cordialement,
{{recruteur}}
{{entreprise}}`,
  },
  {
    id: 'REJECT_INTERVIEW',
    label: 'Refus après entretien',
    description: 'Refus courtois après avoir rencontré le candidat',
    subject: 'Suite à notre entretien — {{poste}}',
    body: `Bonjour {{prenom}},

Merci d'avoir pris le temps de nous rencontrer pour le poste de {{poste}}. Nous avons apprécié nos échanges.

Après réflexion, nous avons fait le choix de poursuivre avec un autre profil, plus proche de nos besoins actuels. Nous savons que cette réponse n'est pas celle que vous espériez.

Nous vous souhaitons beaucoup de réussite pour la suite.

Cordialement,
{{recruteur}}
{{entreprise}}`,
  },
  {
    id: 'OFFER',
    label: 'Proposition d’embauche',
    description: 'Annoncer l’offre (salaire et date de début)',
    subject: 'Proposition d’embauche — {{poste}}',
    body: `Bonjour {{prenom}},

Nous avons le plaisir de vous proposer le poste de {{poste}} chez {{entreprise}}.

Rémunération mensuelle proposée : {{salaire}}
Date de début souhaitée : {{date_debut}}

Merci de nous faire part de votre réponse en répondant à cet e-mail. Nous restons à votre disposition pour toute question.

Cordialement,
{{recruteur}}
{{entreprise}}`,
  },
  {
    id: 'POSITION_FILLED',
    label: 'Poste pourvu',
    description: 'Prévenir les candidats restants que le poste est pourvu',
    subject: 'Le poste de {{poste}} est pourvu — {{entreprise}}',
    body: `Bonjour {{prenom}},

Nous vous remercions de l'intérêt porté à {{entreprise}} et du temps consacré à votre candidature au poste de {{poste}}.

Ce poste vient d'être pourvu et nous clôturons donc ce recrutement. Votre candidature a été étudiée avec attention.

Nous vous souhaitons plein succès dans vos démarches et espérons avoir l'occasion de collaborer prochainement.

Cordialement,
{{recruteur}}
{{entreprise}}`,
  },
  {
    id: 'TALENT_POOL',
    label: 'Profil conservé (vivier)',
    description: 'Informer que le profil est gardé pour de futures opportunités',
    subject: 'Nous gardons votre profil — {{entreprise}}',
    body: `Bonjour {{prenom}},

Votre candidature pour le poste de {{poste}} n'a pas été retenue cette fois-ci, mais votre profil a retenu notre attention.

Avec votre accord, nous le conservons dans notre vivier afin de vous recontacter si une opportunité correspondante se présente.

Cordialement,
{{recruteur}}
{{entreprise}}`,
  },
  {
    id: 'BLANK',
    label: 'Message libre',
    description: 'Partir d’une page blanche',
    subject: '{{poste}} — {{entreprise}}',
    body: `Bonjour {{prenom}},

 

Cordialement,
{{recruteur}}
{{entreprise}}`,
  },
];

export const REJECTION_REASONS: Array<{ code: string; label: string }> = [
  { code: 'PROFILE_MISMATCH', label: 'Profil inadapté au poste' },
  { code: 'EXPERIENCE', label: 'Expérience insuffisante' },
  { code: 'TEST_RESULT', label: 'Résultat du test insuffisant' },
  { code: 'INTERVIEW', label: 'Entretien non concluant' },
  { code: 'SALARY', label: 'Prétentions salariales trop élevées' },
  { code: 'WITHDREW', label: 'Le candidat se retire' },
  { code: 'OFFER_DECLINED', label: 'Offre déclinée par le candidat' },
  { code: 'NO_SHOW', label: 'Absent à l’entretien' },
  { code: 'POSITION_FILLED', label: 'Poste pourvu' },
  { code: 'OTHER', label: 'Autre motif' },
];

export const REJECTION_CODES = REJECTION_REASONS.map((r) => r.code);

/** Remplace {{variable}} par sa valeur ; les variables inconnues restent vides. */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => vars[key] ?? '');
}
