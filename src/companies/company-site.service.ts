import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCompanySiteDto,
  UpdateCompanySiteDto,
} from './dto/company-site.dto';

@Injectable()
export class CompanySiteService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Récupérer tous les sites d'une entreprise ──────────────────────────────
  async findAll(companyId: string) {
    return this.prisma.companySite.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Récupérer uniquement les sites actifs (utilisé au pointage) ───────────
  async findActive(companyId: string) {
    return this.prisma.companySite.findMany({
      where: { companyId, isActive: true },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        radius: true,
      },
    });
  }

  // ── Créer un site ──────────────────────────────────────────────────────────
  async create(companyId: string, dto: CreateCompanySiteDto) {
    return this.prisma.companySite.create({
      data: {
        companyId,
        name: dto.name,
        latitude: dto.latitude,
        longitude: dto.longitude,
        radius: dto.radius ?? 100,
        isActive: dto.isActive ?? true,
      },
    });
  }

  // ── Modifier un site ───────────────────────────────────────────────────────
  async update(siteId: string, companyId: string, dto: UpdateCompanySiteDto) {
    const site = await this.prisma.companySite.findFirst({
      where: { id: siteId, companyId },
    });
    if (!site) throw new NotFoundException('Site introuvable');

    return this.prisma.companySite.update({
      where: { id: siteId },
      data: dto,
    });
  }

  // ── Supprimer un site ──────────────────────────────────────────────────────
  async remove(siteId: string, companyId: string) {
    const site = await this.prisma.companySite.findFirst({
      where: { id: siteId, companyId },
    });
    if (!site) throw new NotFoundException('Site introuvable');

    await this.prisma.companySite.delete({ where: { id: siteId } });
    return { deleted: true };
  }

  // ── Vérifier si une position GPS est dans l'un des sites actifs ───────────
  // Retourne le site matché ou null
  // Utilisé par attendance-check.service.ts
  async checkPositionInAnySite(
    companyId: string,
    latitude: number,
    longitude: number,
    utilsGetDistance: (
      lat1: number,
      lon1: number,
      lat2: number,
      lon2: number,
    ) => number,
  ): Promise<{ matched: boolean; siteName: string | null }> {
    const sites = await this.findActive(companyId);

    // Aucun site configuré → comportement legacy (pas de restriction par sites)
    if (sites.length === 0) return { matched: true, siteName: null };

    for (const site of sites) {
      const distance = utilsGetDistance(
        latitude,
        longitude,
        Number(site.latitude),
        Number(site.longitude),
      );
      if (distance <= site.radius) {
        return { matched: true, siteName: site.name };
      }
    }

    return { matched: false, siteName: null };
  }
}
