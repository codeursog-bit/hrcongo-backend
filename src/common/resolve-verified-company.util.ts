// ============================================================================
// 📁 src/common/resolve-verified-company.util.ts
// 🔒 CORRECTIF SÉCURITÉ (audit) — fonction centrale, à réutiliser PARTOUT où
// un compte cabinet (CABINET_ADMIN/CABINET_GESTIONNAIRE) ou un admin
// multi-entreprises (manageMultipleCompanies) peut cibler un companyId
// différent du sien via query/body.
//
// Avant : ce companyId fourni par le client était utilisé tel quel dès que
// isCabinet || user.manageMultipleCompanies était vrai — jamais comparé à
// l'appartenance réelle (userCompany / cabinetCompany). N'importe quel
// compte cabinet/multi-entreprises pouvait donc lire ou modifier les
// données d'une entreprise qu'il ne gère pas juste en changeant l'UUID.
//
// Ici, on réutilise exactement les mêmes tables déjà vérifiées ailleurs :
//   - cabinetUser → cabinetCompany (isActive)  : même principe que
//     CabinetCompanyIsolationGuard (cabinet/guards/cabinet.guards.ts).
//   - userCompany                              : même principe que
//     AuthService.switchCompany (auth/auth.service.ts).
//
// Comportement :
//   - Pas de companyId demandé, OU rôle sans droit d'override → renvoie
//     user.companyId tel quel (comportement historique inchangé).
//   - companyId demandé ET rôle avec droit d'override (cabinet ou
//     multi-entreprises) → vérifié réellement ; renvoyé si l'appartenance
//     est confirmée, sinon ForbiddenException (plus jamais accepté tel
//     quel).
// ============================================================================

import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface OverridableUser {
  id: string;
  companyId: string | null;
  role: string;
  manageMultipleCompanies?: boolean | null;
}

export async function resolveVerifiedCompanyId(
  prisma: PrismaService,
  user: OverridableUser,
  requestedCompanyId?: string | null,
): Promise<string | null> {
  const isCabinet =
    user.role === 'CABINET_ADMIN' || user.role === 'CABINET_GESTIONNAIRE';
  const canOverride = isCabinet || !!user.manageMultipleCompanies;

  // 🔒 DURCISSEMENT (audit) — `requestedCompanyId` vient du client. Express
  // (qs) transforme `?companyId[not]=x` en OBJET ; transmis tel quel à Prisma
  // (`companyId: requestedCompanyId`) il devient un opérateur de filtre : la
  // vérification d'appartenance « réussit » pour une entreprise du portefeuille
  // et la valeur renvoyée — l'objet contrôlé par l'attaquant — est ensuite
  // réutilisée par l'appelant dans ses requêtes, qui portent alors sur
  // d'AUTRES entreprises. On exige donc une chaîne UUID stricte.
  if (
    requestedCompanyId !== undefined &&
    requestedCompanyId !== null &&
    requestedCompanyId !== ''
  ) {
    if (
      typeof requestedCompanyId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        requestedCompanyId,
      )
    ) {
      throw new ForbiddenException("Vous n'avez pas accès à cette entreprise.");
    }
  }

  // Pas d'override demandé, ou rôle qui n'a de toute façon pas ce droit →
  // comportement historique : sa propre entreprise (peut être null pour un
  // cabinet qui n'a pas encore ciblé d'entreprise — laissé au appelant de
  // décider quoi faire, ex: renvoyer une liste vide).
  if (!requestedCompanyId || !canOverride) {
    return user.companyId ?? null;
  }

  // Un companyId différent est demandé par un rôle qui PEUT en principe
  // overrider — mais on vérifie maintenant réellement l'appartenance avant
  // de l'accorder.
  if (isCabinet) {
    const memberships = await prisma.cabinetUser.findMany({
      where: { userId: user.id },
      select: { cabinetId: true },
    });
    if (memberships.length > 0) {
      const link = await prisma.cabinetCompany.findFirst({
        where: {
          cabinetId: { in: memberships.map((m) => m.cabinetId) },
          companyId: requestedCompanyId,
          isActive: true,
        },
        select: { id: true },
      });
      if (link) return requestedCompanyId;
    }
  }

  if (user.manageMultipleCompanies) {
    const link = await prisma.userCompany.findUnique({
      where: {
        userId_companyId: { userId: user.id, companyId: requestedCompanyId },
      },
      select: { id: true },
    });
    if (link) return requestedCompanyId;
  }

  throw new ForbiddenException("Vous n'avez pas accès à cette entreprise.");
}

// ============================================================================
// 🔒 assertCompanyAccess — pour les routes qui reçoivent un companyId dans
// l'URL (/companies/:id/..., /companies/:companyId/sites) ou qui chargent un
// objet par ID puis lisent son companyId (paie, primes...).
//
// Autorise :
//   - SUPER_ADMIN (accès global déjà existant ailleurs dans l'app)
//   - l'utilisateur dont c'est l'entreprise (user.companyId)
//   - un cabinet / admin portefeuille RÉELLEMENT lié à cette entreprise
//     (cabinetCompany actif / userCompany), via resolveVerifiedCompanyId
// Sinon : ForbiddenException.
//
// options.write = true : exige en plus un rôle d'écriture (ADMIN, HR_MANAGER,
// SUPER_ADMIN, CABINET_*). À n'utiliser que là où AUCUN @Roles n'existe déjà
// sur la route (sinon on double un contrôle existant).
// ============================================================================
const COMPANY_WRITE_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'HR_MANAGER',
  'CABINET_ADMIN',
  'CABINET_GESTIONNAIRE',
];

export async function assertCompanyAccess(
  prisma: PrismaService,
  userId: string,
  companyId: string,
  options: { write?: boolean } = {},
): Promise<void> {
  // 🔒 companyId d'URL/corps : chaîne UUID stricte (voir resolveVerifiedCompanyId)
  if (
    typeof companyId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      companyId,
    )
  ) {
    throw new ForbiddenException("Vous n'avez pas accès à cette entreprise.");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      companyId: true,
      role: true,
      manageMultipleCompanies: true,
    },
  });
  if (!user) throw new ForbiddenException('Utilisateur introuvable.');

  if (options.write && !COMPANY_WRITE_ROLES.includes(user.role)) {
    throw new ForbiddenException(
      "Vous n'avez pas les droits pour effectuer cette action.",
    );
  }
  if (user.role === 'SUPER_ADMIN') return;
  if (user.companyId && user.companyId === companyId) return;

  // Entreprise différente de la sienne : seul un lien cabinet/portefeuille
  // réel l'autorise (resolveVerifiedCompanyId lève Forbidden sinon ; s'il
  // renvoie autre chose que companyId, l'override a été ignoré → refus).
  const verified = await resolveVerifiedCompanyId(prisma, user, companyId);
  if (verified !== companyId) {
    throw new ForbiddenException("Vous n'avez pas accès à cette entreprise.");
  }
}