/** Editorial messages, selected deterministically so retries never change a receipt. */
const MESSAGES: Record<number, readonly string[]> = {
  1: [
    'Un an déjà : merci pour ce premier chapitre à nos côtés.',
    'Votre première année se termine, et une nouvelle commence. Merci pour votre contribution.',
  ],
  2: [
    'Deux années de chemin partagé : merci pour votre engagement.',
    'Merci pour ces deux ans de travail et de confiance. Heureux de poursuivre avec vous.',
  ],
  3: [
    '{years} ans à nos côtés : votre expérience fait grandir notre équipe.',
    'Merci pour ces {years} années et pour tout ce que vous apportez au quotidien.',
  ],
  5: [
    '{years} ans de parcours commun : prenons un instant pour célébrer votre engagement.',
    'Ces {years} années comptent. Merci pour votre fidélité et votre contribution à notre équipe.',
  ],
  10: [
    '{years} années d’histoire partagée : merci pour la place que vous occupez dans notre équipe.',
    'Un parcours de {years} ans se construit jour après jour. Merci pour votre engagement durable.',
  ],
};
export function anniversaryMessage(
  years: number,
  year: number,
  company: string,
  subject: string,
  personal: boolean,
) {
  const milestone =
    years >= 10 ? 10 : years >= 5 ? 5 : years >= 3 ? 3 : years >= 2 ? 2 : 1;
  const text = personal
    ? MESSAGES[milestone][year % 2].replaceAll('{years}', String(years))
    : `${subject} fête ses ${years} ans dans l’entreprise. Vous pouvez lui écrire pour marquer cette étape.`;
  return `${text} — Konza RH, au nom de ${company}.`.slice(0, 2000);
}
