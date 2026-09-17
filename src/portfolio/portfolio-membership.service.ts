import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// 🆕 Portefeuille multi-entreprises — service partagé.
// Toute la logique d'autorisation "cette entreprise m'appartient-elle ?" vit
// ici, pour être réutilisée par les futurs modules (paie, présences, congés,
// prêts) sans dupliquer la vérification à chaque fois.
@Injectable()
export class PortfolioMembershipService {
  constructor(private prisma: PrismaService) {}

  async assertCanUsePortfolio(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, manageMultipleCompanies: true },
    });
    if (!user) throw new ForbiddenException('Utilisateur introuvable.');
    if (user.role !== 'SUPER_ADMIN' && !user.manageMultipleCompanies) {
      throw new ForbiddenException(
        "Ce compte n'a pas accès au portefeuille multi-entreprises.",
      );
    }
    return user;
  }

  async getLinkedCompanyIds(userId: string): Promise<string[]> {
    const links = await this.prisma.userCompany.findMany({
      where: { userId },
      select: { companyId: true },
    });
    return links.map((l) => l.companyId);
  }

  // Lève une exception si companyId n'appartient pas au portefeuille de
  // l'utilisateur. Le SUPER_ADMIN passe toujours (accès global existant).
  async assertCompanyMembership(userId: string, companyId: string) {
    const user = await this.assertCanUsePortfolio(userId);
    if (user.role === 'SUPER_ADMIN') return;

    const link = await this.prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!link) {
      throw new ForbiddenException("Vous n'êtes pas lié à cette entreprise.");
    }
  }
}