// 📁 src/common/utils/phone.util.ts
//
// Normalisation et validation des numéros de téléphone (format Congo-Brazzaville).
// Utilisé partout où un téléphone est enregistré ou comparé :
//   - création/modification d'un employé (employees.service.ts)
//   - import CSV (employees-import.service.ts)
//   - login par téléphone (auth.service.ts)
//
// Objectif : quelle que soit la façon dont le numéro est saisi
// ("064 133 693", "+242 064133693", "00242064133693", "242064133693"),
// on obtient toujours la même forme canonique : "064133693".

/**
 * Normalise un numéro de téléphone vers sa forme canonique locale (9 chiffres, préfixe 0).
 * Retourne null si la valeur est vide/absente. Ne valide PAS le format ici —
 * utiliser isValidCongoPhone() pour ça.
 */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Ne garder que les chiffres (supprime espaces, tirets, points, +)
  let digits = trimmed.replace(/[^\d]/g, '');

  // Retirer l'indicatif pays sous ses différentes formes
  if (digits.startsWith('00242')) {
    digits = digits.slice(5);
  } else if (digits.startsWith('242') && digits.length > 9) {
    digits = digits.slice(3);
  }

  // Remettre le 0 initial si absent (ex: "64133693" → "064133693")
  if (digits.length === 9 && !digits.startsWith('0')) {
    digits = '0' + digits;
  }

  return digits;
}

/**
 * Valide qu'une valeur DÉJÀ normalisée correspond bien à un unique numéro
 * mobile congolais : 0 suivi de 8 chiffres (9 chiffres au total).
 * Rejette naturellement les cas où 2 numéros ont été collés dans le même champ
 * (le total dépasse alors largement 9 chiffres).
 */
export function isValidCongoPhone(normalized: string): boolean {
  return /^0\d{8}$/.test(normalized);
}

/**
 * Normalise puis valide en une seule étape. Lève une erreur descriptive
 * si le format est invalide — à catcher côté service pour renvoyer un
 * message clair à l'utilisateur (ex: via BadRequestException).
 */
export function normalizeAndValidatePhone(raw: string): string {
  const normalized = normalizePhone(raw);
  if (!normalized) {
    throw new Error('Le numéro de téléphone est vide.');
  }
  if (!isValidCongoPhone(normalized)) {
    throw new Error(
      `Le numéro "${raw}" n'est pas valide. Format attendu : un seul numéro à 9 chiffres ` +
        `(ex: 064133693), avec ou sans indicatif (+242, 00242, 242).`,
    );
  }
  return normalized;
}
