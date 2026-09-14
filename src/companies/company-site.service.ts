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

  // ── L'entreprise a-t-elle configuré une géolocalisation quelconque ? ──────
  // (au moins un CompanySite actif, ou la position principale de la fiche
  // entreprise). Utilisé pour savoir si la position GPS doit être EXIGÉE au
  // pointage, indépendamment de ce que le client a envoyé.
  async isGeofencingConfigured(companyId: string): Promise<boolean> {
    const [siteCount, company] = await Promise.all([
      this.prisma.companySite.count({ where: { companyId, isActive: true } }),
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { latitude: true, longitude: true },
      }),
    ]);
    return siteCount > 0 || (company?.latitude != null && company?.longitude != null);
  }

  // ── Vérifier si une position GPS est dans l'un des sites actifs ───────────
  // Retourne le site matché (avec distance) ou, si aucun match, le site le
  // plus proche (pour un message d'erreur utile : "vous êtes à Xm de Y").
  // Utilisé par attendance-check.service.ts — cette fonction est désormais
  // la SEULE source de vérité pour la géolocalisation : le résultat doit
  // être utilisé pour bloquer le pointage, pas seulement pour l'annoter.
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
  ): Promise<{
    matched: boolean;
    siteId: string | null;
    siteName: string | null;
    distance: number | null; // distance au site matché, ou au plus proche si non matché
    configured: boolean; // false = aucun site/position n'est configuré du tout pour cette entreprise
  }> {
    // Sites multi-sites (table CompanySite)
    const sites = await this.findActive(companyId);

    // ✅ Site "principal" configuré sur la fiche entreprise (Company.latitude/
    // longitude/allowedRadius) — avant ce correctif il était totalement
    // ignoré ici, ce qui rendait le géofencing inopérant pour toute
    // entreprise n'ayant pas créé de site via la table CompanySite.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { latitude: true, longitude: true, allowedRadius: true },
    });

    const candidates: Array<{
      id: string | null;
      name: string;
      latitude: number;
      longitude: number;
      radius: number;
    }> = sites.map((s) => ({
      id: s.id,
      name: s.name,
      latitude: Number(s.latitude),
      longitude: Number(s.longitude),
      radius: s.radius,
    }));

    if (company?.latitude != null && company?.longitude != null) {
      candidates.push({
        id: null, // pas de ligne CompanySite associée
        name: 'Site principal',
        latitude: Number(company.latitude),
        longitude: Number(company.longitude),
        radius: company.allowedRadius ?? 100,
      });
    }

    // Aucune position configurée nulle part → pas de géofencing possible
    if (candidates.length === 0) {
      return {
        matched: true,
        siteId: null,
        siteName: null,
        distance: null,
        configured: false,
      };
    }

    // Distance à chaque candidat, calculée une seule fois
    const withDistances = candidates.map((c) => ({
      ...c,
      distance: utilsGetDistance(latitude, longitude, c.latitude, c.longitude),
    }));

    // Sites dans leur rayon, on garde le plus proche en cas de multi-match
    const matches = withDistances
      .filter((c) => c.distance <= c.radius)
      .sort((a, b) => a.distance - b.distance);

    if (matches.length > 0) {
      const m = matches[0];
      return {
        matched: true,
        siteId: m.id,
        siteName: m.name,
        distance: Math.round(m.distance),
        configured: true,
      };
    }

    // Aucun match : on retient le plus proche pour un message d'erreur utile
    const closest = [...withDistances].sort((a, b) => a.distance - b.distance)[0];
    return {
      matched: false,
      siteId: closest.id,
      siteName: closest.name,
      distance: Math.round(closest.distance),
      configured: true,
    };
  }
}