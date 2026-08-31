import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// ─── CabinetMemberGuard ───────────────────────────────────────────────────────
// Vérifie que l'utilisateur est membre du cabinet ciblé
// Injecte request.cabinetRole et request.cabinetId

@Injectable()
export class CabinetMemberGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const cabinetId = req.params.cabinetId;
    if (!cabinetId) throw new ForbiddenException('Cabinet non spécifié');
    if (req.user?.role === 'SUPER_ADMIN') return true;

    const member = await this.prisma.cabinetUser.findUnique({
      where: { cabinetId_userId: { cabinetId, userId: req.user.userId } },
    });

    if (!member)
      throw new ForbiddenException("Vous n'êtes pas membre de ce cabinet");

    req.cabinetRole = member.role;
    req.cabinetId = cabinetId;
    return true;
  }
}

// ─── CabinetAdminGuard ────────────────────────────────────────────────────────
// À utiliser APRÈS CabinetMemberGuard

@Injectable()
export class CabinetAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (req.cabinetRole !== 'CABINET_ADMIN') {
      throw new ForbiddenException(
        'Action réservée aux administrateurs du cabinet',
      );
    }
    return true;
  }
}

// ─── CabinetCompanyIsolationGuard ────────────────────────────────────────────
// SÉCURITÉ CRITIQUE : vérifie que companyId appartient au cabinet
// Empêche l'accès aux données d'une autre PME (IDOR)

@Injectable()
export class CabinetCompanyIsolationGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (req.user?.role === 'SUPER_ADMIN') return true;

    const cabinetId = req.cabinetId ?? req.params.cabinetId;
    const companyId =
      req.params.companyId ?? req.body?.companyId ?? req.query?.companyId;

    if (!companyId) throw new ForbiddenException('companyId manquant');
    if (!cabinetId) throw new ForbiddenException('Accès cabinet non vérifié');

    const link = await this.prisma.cabinetCompany.findUnique({
      where: { cabinetId_companyId: { cabinetId, companyId } },
      select: { isActive: true },
    });

    // 404 intentionnel — ne pas révéler si la PME existe
    if (!link)
      throw new NotFoundException(
        'Entreprise introuvable ou non gérée par ce cabinet',
      );
    if (!link.isActive)
      throw new ForbiddenException('Contrat avec cette entreprise terminé');

    req.isolatedCompanyId = companyId;
    return true;
  }
}
