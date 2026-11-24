import { ForbiddenException } from '@nestjs/common';
/** Platform agents have no tenant or platform-management permission, even on endpoints guarded only by JWT. */
export function enforceSupportAccess(role: string, path: string) {
  if (role !== 'SUPPORT') return;
  const clean = path.split('?')[0].replace(/^\/api(?=\/)/, '');
  if (
    /^\/admin\/support(?:\/|$)/.test(clean) ||
    /^\/support\/tickets(?:\/|$)/.test(clean) ||
    /^\/auth\/(verify|me|logout|change-password)\/?$/.test(clean) ||
    /^\/auth\/2fa\/(setup|activate|disable)\/?$/.test(clean)
  )
    return;
  throw new ForbiddenException('Ce compte est réservé à l’espace support.');
}
