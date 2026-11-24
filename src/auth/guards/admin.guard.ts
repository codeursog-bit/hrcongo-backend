// ============================================================================
// 🛡️ ADMIN GUARD - VÉRIFICATION PERMISSIONS
// ============================================================================
// Fichier: src/auth/guards/admin.guard.ts

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.userId) {
      throw new ForbiddenException('Authentification requise');
    }

    // Vérifier le rôle dans la base de données
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { role: true, companyId: true, isActive: true },
    });

    if (!dbUser || !dbUser.isActive) {
      throw new ForbiddenException('Utilisateur inactif ou introuvable');
    }

    if (!dbUser.companyId) {
      throw new ForbiddenException('Aucune entreprise associée');
    }

    if (dbUser.role !== 'ADMIN' && dbUser.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Permissions administrateur requises');
    }

    // Ajouter les infos au request pour utilisation ultérieure
    request.user.role = dbUser.role;
    request.user.companyId = dbUser.companyId;

    return true;
  }
}
