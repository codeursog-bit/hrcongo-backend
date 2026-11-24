// ============================================================================
// 📁 src/common/resolve-responsable.util.ts
// ✅ Résout le nom à afficher dans le champ "Responsable" des documents
//    imprimables (ex. modèle Orca) : le chef du département de l'employé,
//    ou à défaut un admin de l'entreprise.
// ============================================================================

import { PrismaService } from '../prisma/prisma.service';

export async function resolveResponsableName(
  prisma: PrismaService,
  companyId: string,
  departmentManagerId: string | null | undefined,
): Promise<string> {
  if (departmentManagerId) {
    const manager = await prisma.user.findUnique({
      where: { id: departmentManagerId },
      select: { firstName: true, lastName: true },
    });
    if (manager) return `${manager.firstName} ${manager.lastName}`.trim();
  }

  // Aucun chef de département attribué → on retombe sur un admin de l'entreprise
  const admin = await prisma.user.findFirst({
    where: {
      companyId,
      role: { in: ['ADMIN', 'SUPER_ADMIN'] },
      isActive: true,
    },
    select: { firstName: true, lastName: true },
    orderBy: { role: 'asc' }, // ADMIN avant SUPER_ADMIN si les deux existent
  });

  return admin ? `${admin.firstName} ${admin.lastName}`.trim() : '';
}
