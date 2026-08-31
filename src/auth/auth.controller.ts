// ============================================================================
// 📁 src/auth/auth.controller.ts
// Cookies HttpOnly + Throttle renforcé + Sessions révocables + Trusted Device
// Routes PUBLIQUES (sans JwtAuthGuard) :
//   GET  /auth/invitation-info/:token
//   POST /auth/accept-invitation/:token
//   GET  /auth/cabinet-branding/:subdomain
//   POST /auth/forgot-password
//   POST /auth/reset-password
// ============================================================================

import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  Request,
  Res,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response, Request as ExpressRequest } from 'express';
import { AuthService, ChangePasswordDto } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { ForcePasswordChangeDto } from './dto/force-password-change.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CabinetService } from 'src/cabinet/services/cabinet.service';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private prisma: PrismaService,
    private cabinetService: CabinetService,
  ) {}

  // ── Login ────────────────────────────────────────────────────────────────
  // 5 tentatives max / 15 min par IP — verrouillage compte géré dans le service
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 900000 } })
  async login(
    @Body() loginDto: LoginDto,
    @Ip() ip: string,
    @Req() req: ExpressRequest,
    @Res() res: Response,
  ) {
    // req est passé au service — il lit lui-même req.cookies.trust_device
    // (cookie HttpOnly : le browser l'envoie automatiquement, le front n'y a pas accès)
    return this.authService.login({ ...loginDto, ip }, res, req);
  }

  // ── Register ─────────────────────────────────────────────────────────────
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 3, ttl: 3600000 } }) // 3 créations / heure par IP
  async register(@Body() dto: RegisterDto, @Res() res: Response) {
    return this.authService.register(dto, res);
  }

  // ── Force password change (premier login) ─────────────────────────────────
  @Post('force-password-change')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 300000 } })
  async forcePasswordChange(
    @Body() dto: ForcePasswordChangeDto,
    @Res() res: Response,
  ) {
    return this.authService.forcePasswordChange(
      dto.tempToken,
      dto.newPassword,
      res,
    );
  }

  // ── Change password (depuis profil) ───────────────────────────────────────
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 300000 } })
  async changePassword(@Request() req: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user.userId, dto);
  }

  // ── Refresh token ─────────────────────────────────────────────────────────
  // Lit le refresh_token depuis le cookie HttpOnly (pas du body)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(@Req() req: ExpressRequest, @Res() res: Response) {
    const token = (req.cookies as any)?.refresh_token;
    if (!token)
      throw new BadRequestException('Token de rafraîchissement manquant');
    return this.authService.refreshToken(token, res);
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  // Révoque la session + efface les cookies (trust_device volontairement conservé)
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @Request() req: any,
    @Req() expressReq: ExpressRequest,
    @Res() res: Response,
  ) {
    const refreshToken = (expressReq.cookies as any)?.refresh_token;
    return this.authService.logout(req.user.userId, refreshToken, res);
  }

  // ── Forgot password ───────────────────────────────────────────────────────
  // 3 demandes max / 15 min par IP — anti-spam email
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 900000 } })
  async forgotPassword(@Body('email') email: string) {
    if (!email) throw new BadRequestException('Email requis');
    return this.authService.forgotPassword(email);
  }

  // ── Reset password ────────────────────────────────────────────────────────
  // 5 tentatives max / 15 min par IP
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 900000 } })
  async resetPassword(
    @Body('token') token: string,
    @Body('newPassword') newPassword: string,
  ) {
    if (!token || !newPassword) {
      throw new BadRequestException('Token et nouveau mot de passe requis');
    }
    return this.authService.resetPassword(token, newPassword);
  }

  // ── Verify token ──────────────────────────────────────────────────────────
  @Post('verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async verify(@Request() req: any) {
    // Charger le user complet — companyId, cabinetId et managedByCabinet
    // sont nécessaires pour que le frontend sache où rediriger
    const userId = req.user.userId;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        companyId: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Compte introuvable ou désactivé');
    }

    // cabinetId pour CABINET_ADMIN / CABINET_GESTIONNAIRE
    let cabinetId: string | null = null;
    if (user.role === 'CABINET_ADMIN' || user.role === 'CABINET_GESTIONNAIRE') {
      const cu = await this.prisma.cabinetUser.findFirst({
        where: { userId: user.id },
        select: { cabinetId: true },
      });
      cabinetId = cu?.cabinetId ?? null;
    }

    // managedByCabinet pour ADMIN avec entreprise gérée par cabinet
    let managedByCabinet = false;
    if (user.role === 'ADMIN' && user.companyId) {
      const co = await this.prisma.company.findUnique({
        where: { id: user.companyId },
        select: { managedByCabinet: true },
      });
      managedByCabinet = co?.managedByCabinet ?? false;
    }

    return {
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        companyId: user.companyId ?? null,
        cabinetId,
        managedByCabinet,
      },
    };
  }

  // ── Get current user (enrichi avec profil employé) ────────────────────────
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() req: any) {
    const userId = req.user.userId;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        companyId: true,
        isActive: true,
        canRecordAttendanceForAll: true, // 🆕 permission "secrétaire" pointage
        employee: {
          select: {
            id: true,
            employeeNumber: true,
            position: true,
            photoUrl: true,
            department: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    if (!user) {
      return { id: userId, email: req.user.email, role: req.user.role };
    }

    // ✅ L'entreprise est chargée séparément depuis user.companyId, pas via
    // employee.company — un admin sans fiche employé associée doit quand
    // même avoir accès au logo, au nom, et aux réglages de son entreprise
    // (ex: documentTemplate, qui conditionne l'affichage du bouton Excel).
    let company: any = null;
    if (user.companyId) {
      company = await this.prisma.company.findUnique({
        where: { id: user.companyId },
        select: {
          id: true,
          legalName: true,
          tradeName: true,
          logo: true,
          rccmNumber: true,
          taxNumber: true,
          address: true,
          phone: true,
          documentTemplate: true,
          cachetUrl: true,
          documentFooterText: true,
          createdAt: true,
        },
      });
      if (company) company.name = company.tradeName || company.legalName;
    }

    return { ...user, company };
  }

  // ── Invitation info (PUBLIC — pas de guard) ───────────────────────────────
  @Get('invitation-info/:token')
  @HttpCode(HttpStatus.OK)
  async getInvitationInfo(@Param('token') token: string) {
    return this.cabinetService.getInvitationInfo(token);
  }

  // ── Accept invitation (PUBLIC — pas de guard) ─────────────────────────────
  @Post('accept-invitation/:token')
  @HttpCode(HttpStatus.CREATED)
  async acceptInvitation(
    @Param('token') token: string,
    @Body('password') password: string,
    @Body('firstName') firstName?: string,
    @Body('lastName') lastName?: string,
  ) {
    return this.cabinetService.acceptInvitation(
      token,
      password,
      firstName,
      lastName,
    );
  }

  // ── Cabinet branding (PUBLIC — pas de guard) ──────────────────────────────
  @Get('cabinet-branding/:subdomain')
  @HttpCode(HttpStatus.OK)
  async getCabinetBranding(@Param('subdomain') subdomain: string) {
    return this.cabinetService.getBrandingBySubdomain(subdomain);
  }
}