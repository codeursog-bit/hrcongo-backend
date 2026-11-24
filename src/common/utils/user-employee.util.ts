// ============================================================================
// 📁 src/common/utils/user-employee.util.ts
// Retrouve la fiche employé d'un compte utilisateur — et la RELIE si besoin.
//
// Pourquoi : User.employeeId n'est renseigné que pour les comptes créés « comme employé ».
// Un admin dont la fiche employé est créée APRÈS coup (même e-mail) n'y est pas lié, alors que
// /employees/me le retrouve par e-mail. Résultat : pas de pointage QR, pas de pause, « Ma
// pointeuse » qui ne voit pas son pointage. Ici, on retrouve la fiche par e-mail (dans son
// entreprise active ou son portefeuille), puis on enregistre le lien une bonne fois pour toutes.
// ============================================================================
import { PrismaService } from '../../prisma/prisma.service';

export async function resolveUserEmployeeId(
  prisma: PrismaService,
  userId: string,
): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, companyId: true, employeeId: true },
  });
  if (!user) return null;
  if (user.employeeId) return user.employeeId;
  if (!user.email) return null;

  // Entreprises où chercher : l'active + celles de son portefeuille
  const links = await prisma.userCompany.findMany({
    where: { userId },
    select: { companyId: true },
  });
  const companyIds = [...new Set([...(user.companyId ? [user.companyId] : []), ...links.map((l) => l.companyId)])];
  if (companyIds.length === 0) return null;

  const candidates = await prisma.employee.findMany({
    where: {
      email: { equals: user.email, mode: 'insensitive' },
      companyId: { in: companyIds },
      user: { is: null }, // fiche pas déjà liée à un autre compte
    },
    select: { id: true, companyId: true },
    take: 5,
  });
  if (candidates.length === 0) return null;

  // Priorité à l'entreprise active ; plusieurs fiches possibles ailleurs → ambigu, on ne devine pas
  const inActive = candidates.filter((c) => c.companyId === user.companyId);
  const pool = inActive.length > 0 ? inActive : candidates;
  if (pool.length !== 1) return null;
  const chosen = pool[0];

  try {
    await prisma.user.update({ where: { id: userId }, data: { employeeId: chosen.id } });
  } catch {
    // Course (lien déjà posé entre-temps) : on relit simplement
    const again = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
    return again?.employeeId ?? null;
  }
  return chosen.id;
}