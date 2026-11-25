import { createHash } from 'crypto';

/** Free text is deliberately lossy: never retain arbitrary numbers, emails, quoted payloads or URL queries. */
export function safeIncidentText(input: unknown, max = 2000): string {
  return String(input ?? '')
    .slice(0, 16000)
    .replace(/(["']?(?:password|token|secret|authorization|cookie|api[_-]?key|salary|salaire|iban|cnss|nationalid)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi, '[champ sensible masqué]')
    .replace(/(?:Bearer\s+)[\w.\-]+/gi, 'Bearer [masqué]')
    .replace(/\beyJ[\w.-]+/g, '[jeton masqué]')
    .replace(
      /\b(?:password|token|secret|authorization|cookie|api[_-]?key|salary|salaire|iban|cnss|nationalid)\s*[:=]\s*[^\s,;}]+/gi,
      '[champ sensible masqué]',
    )
    .replace(/https?:\/\/[^\s)]+/gi, (value) => {
      try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
      } catch {
        return '[url]';
      }
    })
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[courriel]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[id]')
    .replace(/(["'`])[^"'`\n]{0,2000}\1/g, '[valeur]')
    .replace(/\b[A-Za-z0-9_+\/-]{32,}\b/g, '[identifiant]')
    .replace(/\d[\d\s.,+-]*/g, '#')
    .slice(0, max);
}

export function safeIncidentPath(input: unknown): string {
  try {
    const path = new URL(String(input ?? '/'), 'https://incident.invalid')
      .pathname;
    return path
      .split('/')
      .map((segment,index,segments) =>
        /token|reset|verify|tracking|suivi|invitation/i.test(segments[index-1]??'') ||
        /^(?:[0-9a-f-]{32,}|\d+|demo-.+)$/.test(segment) ||
        /^[a-zA-Z0-9_-]{24,}$/.test(segment) ||
        segment.includes('@') ||
        segment.length > 60
          ? ':id'
          : segment,
      )
      .join('/')
      .slice(0, 300);
  } catch {
    return '/';
  }
}

/** Retain only conventional code frames with their line/column, never arbitrary stack payloads. */
export function safeIncidentStack(stack: string): string {
  return stack
    .slice(0, 16000)
    .split('\n')
    .slice(0, 30)
    .map((line, index) => {
      if (index === 0) return safeIncidentText(line, 500);
      const frame = line.match(
        /^\s*at\s+(?:([\w.$ <>]+)\s+\()?([^()\s]+):(\d+):(\d+)\)?$/,
      );
      if (!frame) return safeIncidentText(line, 150);
      const file = frame[2]
        .split('?')[0]
        .replace(/([A-Z]:[\\/]Users[\\/])[^\\/]+/gi, '$1[utilisateur]')
        .replace(/\/home\/[^/]+/g, '/home/[utilisateur]');
      if (/https?:\/\/[^/]*@/i.test(file)) return '    at [adresse masquée]';
      if (!/\.(?:[cm]?js|jsx|tsx?)$/.test(file))
        return safeIncidentText(line, 150);
      return `    at ${frame[1] ? safeIncidentText(frame[1], 100) + ' ' : ''}(${file.slice(0, 500)}:${frame[3]}:${frame[4]})`;
    })
    .join('\n')
    .slice(0, 6000);
}

export function safeIncidentVersion(value: unknown): string | undefined {
  const version=String(value??'');
  return /^[a-zA-Z0-9._-]{1,100}$/.test(version)&&!version.includes('..')?version:undefined;
}

export function incidentFingerprint(event: {
  source: string;
  code: string;
  message: string;
  stack?: string;
  path: string;
}) {
  const frame =
    event.stack?.split('\n').find((line) => /^\s*at\s/.test(line)) ?? '';
  return createHash('sha256')
    .update(
      [
        event.source,
        safeIncidentText(event.code, 100),
        safeIncidentText(event.message),
        safeIncidentText(frame),
        safeIncidentPath(event.path),
      ].join('|'),
    )
    .digest('hex');
}

export function ignoreIncident(message: string, stack = '') {
  return /ResizeObserver loop|AbortError|request (?:was )?(?:cancelled|canceled)|chrome-extension:|moz-extension:/i.test(
    `${message} ${stack}`,
  );
}
