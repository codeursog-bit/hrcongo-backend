// ============================================================================
// src/bulletin-template/bulletin-template.service.ts
// Supporte mode "template" ET mode "canvas" (JSON libre en BDD)
// ============================================================================
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertBulletinTemplateDto } from './bulletin-template.dto';

export const DEFAULT_TEMPLATE = {
  mode: 'template',
  templateId: 'default',
  name: 'Classique administratif',
  style: {
    primaryColor: '#111827',
    secondaryColor: '#374151',
    textColor: '#111827',
    fontFamily: 'sans',
    fontSize: 'md',
    density: 'normal',
    layout: '1col',
    borderRadius: 4,
    headerStyle: 'line',
    showLogo: true,
    logoPosition: 'left',
    showAddress: true,
    showFiscalNumbers: true,
    showPageNumber: false,
    showGeneratedDate: true,
    showHrSignature: false,
    footerMessage: '',
  },
  blocks: [
    {
      id: 'header',
      label: 'En-tête entreprise',
      display: 'table',
      visible: true,
      scope: 'both',
      order: 0,
    },
    {
      id: 'employee',
      label: 'Informations du salarié',
      display: 'table',
      visible: true,
      scope: 'both',
      order: 1,
    },
    {
      id: 'time',
      label: 'Temps de travail',
      display: 'table',
      visible: true,
      scope: 'both',
      order: 2,
    },
    {
      id: 'salary',
      label: 'Rémunérations',
      display: 'table',
      visible: true,
      scope: 'both',
      order: 3,
    },
    {
      id: 'overtime',
      label: 'Heures supplémentaires',
      display: 'table',
      visible: true,
      scope: 'both',
      order: 4,
    },
    {
      id: 'bonuses',
      label: 'Primes & Avantages',
      display: 'table',
      visible: true,
      scope: 'both',
      order: 5,
    },
    {
      id: 'deductions',
      label: 'Cotisations salariales',
      display: 'table',
      visible: true,
      scope: 'both',
      order: 6,
    },
    {
      id: 'employer',
      label: 'Charges patronales',
      display: 'table',
      visible: false,
      scope: 'both',
      order: 7,
    },
    {
      id: 'net',
      label: 'Net à payer',
      display: 'card',
      visible: true,
      scope: 'both',
      order: 8,
    },
    {
      id: 'recap',
      label: 'Récapitulatif',
      display: 'table',
      visible: true,
      scope: 'both',
      order: 9,
    },
    {
      id: 'signatures',
      label: 'Signatures',
      display: 'line',
      visible: true,
      scope: 'both',
      order: 10,
    },
    {
      id: 'message',
      label: 'Message employeur',
      display: 'card',
      visible: false,
      scope: 'both',
      order: 11,
    },
    {
      id: 'legal',
      label: 'Mentions légales',
      display: 'subtle',
      visible: true,
      scope: 'app',
      order: 12,
    },
  ],
};

@Injectable()
export class BulletinTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Résolution companyId ────────────────────────────────────────────────────
  // Priorité 1 : companyId du JWT (déjà résolu par l'auth, 0 requête DB)
  // Priorité 2 : lookup DB sur userId (fallback legacy)
  private async resolveCompanyId(
    userId: string,
    jwtCompanyId?: string | null,
  ): Promise<string> {
    // Cas 1 : companyId présent et valide dans le JWT → on l'utilise directement
    if (
      jwtCompanyId &&
      jwtCompanyId !== 'undefined' &&
      jwtCompanyId !== 'null'
    ) {
      return jwtCompanyId;
    }

    // Cas 2 : fallback lookup DB (userId doit être un UUID valide)
    if (!userId || userId === 'undefined') {
      throw new BadRequestException(
        "Impossible de déterminer l'entreprise : session invalide. Reconnectez-vous.",
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user?.companyId) {
      throw new NotFoundException('Aucune entreprise associée à ce compte.');
    }

    return user.companyId;
  }

  // ── GET /companies/bulletin-template ────────────────────────────────────────
  async getTemplate(userId: string, jwtCompanyId?: string | null) {
    const companyId = await this.resolveCompanyId(userId, jwtCompanyId);
    const tpl = await this.prisma.bulletinTemplate.findUnique({
      where: { companyId },
    });
    return {
      config: tpl ? (tpl.config as object) : DEFAULT_TEMPLATE,
      isDefault: !tpl,
    };
  }

  // ── PUT /companies/bulletin-template ────────────────────────────────────────
  async upsertTemplate(
    userId: string,
    dto: UpsertBulletinTemplateDto,
    jwtCompanyId?: string | null,
  ) {
    const companyId = await this.resolveCompanyId(userId, jwtCompanyId);
    const existing = await this.prisma.bulletinTemplate.findUnique({
      where: { companyId },
    });
    const base = (existing?.config as any) ?? DEFAULT_TEMPLATE;
    const merged = this.deepMerge(base, dto);

    const saved = await this.prisma.bulletinTemplate.upsert({
      where: { companyId },
      create: { companyId, config: merged },
      update: { config: merged },
    });
    return { config: saved.config, isDefault: false };
  }

  // ── DELETE /companies/bulletin-template/reset ────────────────────────────────
  async resetTemplate(userId: string, jwtCompanyId?: string | null) {
    const companyId = await this.resolveCompanyId(userId, jwtCompanyId);
    await this.prisma.bulletinTemplate.deleteMany({ where: { companyId } });
    return { config: DEFAULT_TEMPLATE, isDefault: true };
  }

  // ── Fusion profonde — préserve les champs non envoyés ───────────────────────
  private deepMerge(base: any, patch: any): any {
    const result = { ...base };
    for (const key of Object.keys(patch ?? {})) {
      if (patch[key] !== undefined && patch[key] !== null) {
        if (
          typeof patch[key] === 'object' &&
          !Array.isArray(patch[key]) &&
          typeof base[key] === 'object' &&
          !Array.isArray(base[key])
        ) {
          result[key] = this.deepMerge(base[key], patch[key]);
        } else {
          result[key] = patch[key];
        }
      }
    }
    return result;
  }
}
