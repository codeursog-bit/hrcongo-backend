import knowledge from './knowledge.json';
export interface HelpArticle {
  id: string;
  title: string;
  question: string;
  keywords: string[];
  roles: string[];
  text: string;
  path: string;
  guideId?: string;
}
export const HELP = knowledge as HelpArticle[];
export const normalizeHelp = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
export const helpFor = (role: string) =>
  HELP.filter((a) => a.roles.includes(role));
export const REFUSAL =
  'Je ne peux pas répondre à cette question avec les fonctions disponibles. Je peux vous aider à utiliser l’application. Pour une autre demande, contactez le support.';
export function answerHelp(message: string, role: string) {
  const q = normalizeHelp(message),
    tokens = new Set(q.split(' ')),
    allowed = helpFor(role);
  if (
    /\b(ignore|instructions|sql|juridique|licenciement|combien|pourquoi|montant|classement|augmentation|augmente|calculer|calcule|net|brut|entreprise b|autre entreprise)\b/.test(
      q,
    )
  )
    return {
      text: REFUSAL,
      refusal: true,
      canonical: 'Question non prise en charge',
    };
  const how =
    /\b(comment|comen|commen|ou|guide|guider|montre|montrer|faire|creer|ajouter|importer|pointer|consulter|retrouver|changer|modifier|voir|preparer|generer|demander)\b/.test(
      q,
    ) || tokens.size <= 2;
  if (!how)
    return {
      text: REFUSAL,
      refusal: true,
      canonical: 'Question non prise en charge',
    };
  const ranked = allowed
    .map((a) => ({
      article: a,
      score:
        a.keywords.filter((k) => tokens.has(k)).length -
        (a.id === 'personal-pay' && ['ADMIN', 'HR_MANAGER'].includes(role)
          ? 0.1
          : 0),
    }))
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score);
  // Consulting a payslip is different from preparing payroll.
  if (/\b(consulter|telecharger|mes bulletins|ma paie)\b/.test(q)) {
    const own = allowed.find((a) => a.id === 'personal-pay');
    if (own && /paie|bulletin/.test(q))
      return {
        text: own.text,
        article: own,
        refusal: false,
        canonical: own.question,
      };
  }
  if (
    !ranked.length ||
    (ranked.length > 1 && ranked[0].score === ranked[1].score)
  )
    return {
      text: 'Voici les sujets que je peux expliquer. Choisissez une question suggérée pour préciser votre demande.',
      refusal: true,
      canonical: 'Demande de précisions',
    };
  const article = ranked[0].article;
  return {
    text: article.text,
    article,
    refusal: false,
    canonical: article.question,
  };
}
/** Every digit-bearing token must originate in the selected tool result. */
export function numbersGrounded(text: string, source: unknown) {
  const digits = (v: string) => v.match(/\d+(?:[.,]\d+)?/g) || [];
  const allowed = new Set(
    digits(JSON.stringify(source)).map((n) => n.replace(',', '.')),
  );
  return digits(text).every((n) => allowed.has(n.replace(',', '.')));
}
