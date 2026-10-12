import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { AssetStatus } from '@prisma/client';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
import { resolveVerifiedCompanyId } from '../common/resolve-verified-company.util';

@Injectable()
export class AssetsService {
  constructor(
    private prisma: PrismaService,
    private subscriptionGuard: SubscriptionGuard,
  ) {}

  // ── Helper : utilisateur avec companyId garanti non-null ────────────────────
  private async getVerifiedUser(
    userId: string,
  ): Promise<{ id: string; companyId: string; role: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, role: true },
    });
    if (!user || !user.companyId) {
      throw new ForbiddenException(
        'Utilisateur non rattaché à une entreprise.',
      );
    }
    return { id: user.id, companyId: user.companyId, role: user.role };
  }

  // ── Helper : réservé aux rôles habilités à réassigner/changer le statut d'un actif ──
  private assertAssetManagerRole(role: string) {
    const allowed = ['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];
    if (!allowed.includes(role)) {
      throw new ForbiddenException(
        "Cette action est réservée à l'administration et aux RH.",
      );
    }
  }

  // ── Helper : vérifie que l'actif appartient à l'entreprise ─────────────────
  private async getAssetOrFail(assetId: string, companyId: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, companyId },
    });
    if (!asset)
      throw new NotFoundException('Actif introuvable dans cette entreprise.');
    return asset;
  }

  // ── Créer un actif ──────────────────────────────────────────────────────────
  async create(dto: CreateAssetDto, userId: string) {
    const user = await this.getVerifiedUser(userId);

    await this.subscriptionGuard.checkFeatureAccess(
      user.companyId,
      'hasAssetManagement',
    );

    if (!dto.purchaseDate) {
      throw new BadRequestException("La date d'achat est obligatoire.");
    }

    let finalStatus: AssetStatus;
    if (dto.employeeId) {
      finalStatus = AssetStatus.IN_USE;
    } else if (dto.status) {
      finalStatus = dto.status;
    } else {
      finalStatus = AssetStatus.AVAILABLE;
    }

    return this.prisma.asset.create({
      data: {
        name: dto.name,
        serialNumber: dto.serialNumber || null,
        category: dto.category as any, // String libre — cast si enum Prisma pas encore migré
        purchaseDate: new Date(dto.purchaseDate),
        purchasePrice: dto.purchaseValue ?? 0,
        companyId: user.companyId,
        assignedTo: dto.employeeId || null,
        status: finalStatus,
      },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, photoUrl: true },
        },
      },
    });
  }

  // ── Lister tous les actifs de l'entreprise ─────────────────────────────────
  async findAll(userId: string, overrideCompanyId?: string) {
    // ── Résolution companyId (vérifiée réellement) ───────────────────────────
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true, role: true, manageMultipleCompanies: true },
    });
    if (!user) throw new NotFoundException('Entreprise introuvable');

    // 🔒 CORRECTIF SÉCURITÉ (audit) : overrideCompanyId était accepté tel
    // quel dès que isCabinet était vrai, jamais vérifié contre
    // userCompany/cabinetCompany. Rebranché sur la fonction centrale.
    const companyId = await resolveVerifiedCompanyId(
      this.prisma,
      user,
      overrideCompanyId,
    );

    if (!companyId) throw new NotFoundException('Entreprise introuvable');

    return this.prisma.asset.findMany({
      where: { companyId },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, photoUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Assigner / désassigner ──────────────────────────────────────────────────
  async assign(assetId: string, employeeId: string | null, userId: string) {
    const user = await this.getVerifiedUser(userId);
    this.assertAssetManagerRole(user.role);
    await this.getAssetOrFail(assetId, user.companyId);

    return this.prisma.asset.update({
      where: { id: assetId },
      data: {
        assignedTo: employeeId,
        status: employeeId ? AssetStatus.IN_USE : AssetStatus.AVAILABLE,
      },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, photoUrl: true },
        },
      },
    });
  }

  // ── Changer le statut ───────────────────────────────────────────────────────
  // ✅ Aucune migration BDD nécessaire — on utilise les valeurs existantes de
  //    l'enum AssetStatus : AVAILABLE | IN_USE | MAINTENANCE | RETIRED
  async changeStatus(assetId: string, newStatus: string, userId: string) {
    const user = await this.getVerifiedUser(userId);
    this.assertAssetManagerRole(user.role);
    const asset = await this.getAssetOrFail(assetId, user.companyId);

    // Validation : refuser toute valeur hors enum
    const validStatuses = Object.values(AssetStatus);
    if (!validStatuses.includes(newStatus as AssetStatus)) {
      throw new BadRequestException(
        `Statut invalide. Valeurs acceptées : ${validStatuses.join(', ')}`,
      );
    }

    return this.prisma.asset.update({
      where: { id: assetId },
      data: {
        status: newStatus as AssetStatus,
        // Quitter IN_USE → désassigner automatiquement
        ...(newStatus !== 'IN_USE' && asset.status === 'IN_USE'
          ? { assignedTo: null }
          : {}),
      },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, photoUrl: true },
        },
      },
    });
  }

  // ── Modifier un actif (nom, n° de série, catégorie, valeur, date d'achat) ───
  async update(assetId: string, dto: UpdateAssetDto, userId: string) {
    const user = await this.getVerifiedUser(userId);
    this.assertAssetManagerRole(user.role);
    await this.getAssetOrFail(assetId, user.companyId);

    const data: Record<string, any> = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException('Le nom du matériel est obligatoire.');
      }
      data.name = name;
    }
    if (dto.serialNumber !== undefined) {
      data.serialNumber = dto.serialNumber.trim() || null;
    }
    if (dto.category !== undefined) {
      const category = dto.category.trim();
      if (!category) {
        throw new BadRequestException('La catégorie est obligatoire.');
      }
      data.category = category as any; // String libre, comme à la création
    }
    if (dto.purchaseDate !== undefined) {
      data.purchaseDate = new Date(dto.purchaseDate);
    }
    if (dto.purchaseValue !== undefined) {
      data.purchasePrice = dto.purchaseValue;
    }

    return this.prisma.asset.update({
      where: { id: assetId },
      data,
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, photoUrl: true },
        },
      },
    });
  }

  // ── Supprimer un actif ──────────────────────────────────────────────────────
  // Refusé tant que le matériel est attribué à un employé : il faut d'abord le
  // récupérer (désassigner), pour ne pas perdre la trace de la dotation.
  async remove(assetId: string, userId: string) {
    const user = await this.getVerifiedUser(userId);
    this.assertAssetManagerRole(user.role);
    const asset = await this.getAssetOrFail(assetId, user.companyId);

    if (asset.status === AssetStatus.IN_USE || asset.assignedTo) {
      throw new BadRequestException(
        "Ce matériel est attribué à un employé. Retirez-le d'abord avant de le supprimer.",
      );
    }

    await this.prisma.asset.delete({ where: { id: assetId } });
    return { success: true, id: assetId };
  }

  // ── Actifs d'un employé ─────────────────────────────────────────────────────
  async findByEmployee(employeeId: string) {
    return this.prisma.asset.findMany({
      where: { assignedTo: employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }
}