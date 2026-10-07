// ============================================================================
// 📁 src/companies/company-trusted-ip.controller.ts  (NOUVEAU)
// IP publiques de confiance d'une entreprise (wifi du site) — secours du GPS.
// ============================================================================
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CompanySiteService } from './company-site.service';
import { SubscriptionGuard } from '../subscriptions/guards/subscription.guard';
import { isPrivateOrLocalIp, normalizeIp } from '../common/ip.util';

class LearnedIpActionDto {
  // IP déjà normalisée, telle que renvoyée par GET /trusted-ips/learned
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  ip: string;

  // Libellé (obligatoire pour « valider en permanent »)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;
}

class AddTrustedIpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;

  // Vide = IP actuelle de l'admin (celle vue par le serveur)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;
}

const MAX_TRUSTED_IPS = 20;

@UseGuards(AuthGuard('jwt'))
@Controller('companies/:companyId/trusted-ips')
export class CompanyTrustedIpController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companySiteService: CompanySiteService,
    private readonly subscriptionGuard: SubscriptionGuard,
  ) {}

  // GET /companies/:companyId/trusted-ips
  @Get()
  async list(@Param('companyId') companyId: string, @Request() req) {
    await this.companySiteService.assertAccess(req.user.userId, companyId, false);
    return this.prisma.companyTrustedIp.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // GET /companies/:companyId/trusted-ips/my-ip — l'IP que le serveur voit pour l'admin
  @Get('my-ip')
  async myIp(@Param('companyId') companyId: string, @Request() req) {
    await this.companySiteService.assertAccess(req.user.userId, companyId, false);
    const ip = normalizeIp(req.ip);
    const usable = !!ip && !isPrivateOrLocalIp(ip);
    // « Cette connexion est-elle déjà reconnue comme wifi de l'entreprise ? » (saisie ou apprise)
    const rec = usable
      ? await this.companySiteService.isIpRecognized(companyId, ip)
      : { recognized: false, via: null };
    return { ip, usable, recognized: rec.recognized, via: rec.via };
  }

  // GET /companies/:companyId/trusted-ips/learned — IP apprises automatiquement (< 24 h)
  // (déclarée AVANT « :id » pour ne pas être confondue avec un identifiant)
  @Get('learned')
  async learned(@Param('companyId') companyId: string, @Request() req) {
    await this.companySiteService.assertAccess(req.user.userId, companyId, false);
    return this.companySiteService.listLearnedIps(companyId);
  }

  // POST /companies/:companyId/trusted-ips/learned/promote — valider une IP apprise en permanent
  @Post('learned/promote')
  async promoteLearned(
    @Param('companyId') companyId: string,
    @Body() dto: LearnedIpActionDto,
    @Request() req,
  ) {
    await this.companySiteService.assertAccess(req.user.userId, companyId, true);
    await this.subscriptionGuard.checkFeatureAccess(companyId, 'hasAttendanceGPS');

    const ip = dto.ip.trim();
    // On ne promeut qu'une IP réellement observée (pas une valeur arbitraire)
    if (isPrivateOrLocalIp(ip) || !(await this.companySiteService.hasRecentSighting(companyId, ip))) {
      throw new BadRequestException("Cette IP n'a pas été observée récemment.");
    }
    const label = dto.label?.trim();
    if (!label) throw new BadRequestException('Libellé requis.');

    const count = await this.prisma.companyTrustedIp.count({ where: { companyId } });
    if (count >= MAX_TRUSTED_IPS) {
      throw new BadRequestException(`Maximum ${MAX_TRUSTED_IPS} IP de confiance par entreprise.`);
    }
    return this.prisma.companyTrustedIp.upsert({
      where: { companyId_ip: { companyId, ip } },
      create: { companyId, ip, label },
      update: { label, isActive: true },
    });
  }

  // POST /companies/:companyId/trusted-ips/learned/revoke — écarter une IP apprise
  @Post('learned/revoke')
  async revokeLearned(
    @Param('companyId') companyId: string,
    @Body() dto: LearnedIpActionDto,
    @Request() req,
  ) {
    await this.companySiteService.assertAccess(req.user.userId, companyId, true);
    return this.companySiteService.blockLearnedIp(companyId, dto.ip.trim());
  }

  // POST /companies/:companyId/trusted-ips
  @Post()
  async add(
    @Param('companyId') companyId: string,
    @Body() dto: AddTrustedIpDto,
    @Request() req,
  ) {
    await this.companySiteService.assertAccess(req.user.userId, companyId, true);
    await this.subscriptionGuard.checkFeatureAccess(companyId, 'hasAttendanceGPS');

    const ip = normalizeIp(dto.ip?.trim() ? dto.ip : req.ip);
    if (!ip) throw new BadRequestException('Adresse IP invalide.');
    if (isPrivateOrLocalIp(ip)) {
      throw new BadRequestException(
        "Cette adresse est privée ou locale : elle ne peut pas servir d'IP de confiance. " +
          "Si vous avez cliqué sur « Ajouter mon IP actuelle », vérifiez que TRUST_PROXY est défini sur le serveur.",
      );
    }

    const count = await this.prisma.companyTrustedIp.count({ where: { companyId } });
    if (count >= MAX_TRUSTED_IPS) {
      throw new BadRequestException(`Maximum ${MAX_TRUSTED_IPS} IP de confiance par entreprise.`);
    }

    return this.prisma.companyTrustedIp.upsert({
      where: { companyId_ip: { companyId, ip } },
      create: { companyId, ip, label: dto.label.trim() },
      update: { label: dto.label.trim(), isActive: true },
    });
  }

  // DELETE /companies/:companyId/trusted-ips/:id
  @Delete(':id')
  async remove(
    @Param('companyId') companyId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Request() req,
  ) {
    await this.companySiteService.assertAccess(req.user.userId, companyId, true);
    await this.prisma.companyTrustedIp.deleteMany({ where: { id, companyId } });
    return { deleted: true };
  }
}