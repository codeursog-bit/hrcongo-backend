// ============================================================================
// 📁 src/auth/two-factor.service.ts
// ============================================================================
import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { COOKIE_CONFIG } from './auth.service';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { Response } from 'express';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';

const ROLES_REQUIRING_2FA = ['ADMIN', 'HR_MANAGER', 'CABINET_ADMIN'];

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async setup(userId: string): Promise<{
    secret: string;
    qrCodeUrl: string;
    manualKey: string;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, twoFactorEnabled: true },
    });
    if (!user) throw new BadRequestException('Utilisateur introuvable');
    if (user.twoFactorEnabled) {
      throw new BadRequestException('Le 2FA est déjà activé sur ce compte');
    }

    const generated = speakeasy.generateSecret({ length: 20 });
    const secret = generated.base32;
    const appName = process.env.APP_NAME || 'KonzaRH';
    const otpAuthUrl = speakeasy.otpauthURL({
      issuer: appName,
      label: user.email,
      secret,
      encoding: 'base32',
    });
    const qrCodeUrl = await qrcode.toDataURL(otpAuthUrl);

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret },
    });

    return { secret, qrCodeUrl, manualKey: secret };
  }

  async activate(
    userId: string,
    code: string,
  ): Promise<{ backupCodes: string[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });
    if (!user?.twoFactorSecret) {
      throw new BadRequestException(
        `Lancez d'abord la configuration 2FA (/auth/2fa/setup)`,
      );
    }
    if (user.twoFactorEnabled) {
      throw new BadRequestException('Le 2FA est déjà activé');
    }

    const valid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code,
      window: 1, // ±30s de tolérance
    });
    if (!valid) {
      throw new BadRequestException(
        `Code invalide. Vérifiez l'heure de votre téléphone.`,
      );
    }

    const plainCodes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(4).toString('hex').toUpperCase(),
    );
    const hashedCodes = await Promise.all(
      plainCodes.map((c) => bcrypt.hash(c, 10)),
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorBackupCodes: hashedCodes,
      } as any,
    });

    this.logger.log(`✅ 2FA activé pour user ${userId}`);
    return { backupCodes: plainCodes };
  }

  async validateCode(
    tempToken2fa: string,
    code: string,
    res: Response,
  ): Promise<void> {
    let payload: any;
    try {
      payload = this.jwtService.verify(tempToken2fa);
    } catch {
      throw new UnauthorizedException(
        'Token expiré. Recommencez la connexion.',
      );
    }
    if (payload.purpose !== '2fa-pending' || !payload.sub) {
      throw new UnauthorizedException('Token invalide');
    }
    const userId = payload.sub;

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
        twoFactorSecret: true,
        twoFactorEnabled: true,
        twoFactorBackupCodes: true,
      } as any,
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');

    const secret = (user as any).twoFactorSecret as string;
    if (!secret) throw new BadRequestException('2FA non configuré');

    const valid = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code,
      window: 1,
    });

    if (!valid) {
      const backupCodes =
        ((user as any).twoFactorBackupCodes as string[]) ?? [];
      let matchedIndex = -1;

      for (let i = 0; i < backupCodes.length; i++) {
        if (await bcrypt.compare(code, backupCodes[i])) {
          matchedIndex = i;
          break;
        }
      }

      if (matchedIndex === -1) {
        throw new UnauthorizedException('Code 2FA invalide');
      }

      backupCodes.splice(matchedIndex, 1);
      await this.prisma.user.update({
        where: { id: userId },
        data: { twoFactorBackupCodes: backupCodes } as any,
      });

      this.logger.warn(`⚠️ Code de secours utilisé par user ${userId}`);
    }

    const { v4: uuidv4 } = await import('uuid');
    const jti = uuidv4();

    // Récupérer cabinetId si nécessaire
    let cabinetId: string | null = null;
    if (
      (user as any).role === 'CABINET_ADMIN' ||
      (user as any).role === 'CABINET_GESTIONNAIRE'
    ) {
      const cu = await this.prisma.cabinetUser.findFirst({
        where: { userId: (user as any).id },
        select: { cabinetId: true },
      });
      cabinetId = cu?.cabinetId ?? null;
    }

    // managedByCabinet
    let managedByCabinet = false;
    if ((user as any).role === 'ADMIN' && (user as any).companyId) {
      const co = await this.prisma.company.findUnique({
        where: { id: (user as any).companyId },
        select: { managedByCabinet: true },
      });
      managedByCabinet = co?.managedByCabinet ?? false;
    }

    const accessPayload = {
      email: (user as any).email,
      sub: (user as any).id,
      role: (user as any).role,
      companyId: (user as any).companyId ?? null,
      cabinetId: cabinetId ?? null,
      managedByCabinet: managedByCabinet,
    };
    const refreshPayload = { sub: (user as any).id, type: 'refresh', jti };

    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: '2h',
    });
    const refreshToken = this.jwtService.sign(refreshPayload, {
      expiresIn: '30d',
    });

    await this.prisma.userSession.create({
      data: {
        jti,
        user: { connect: { id: (user as any).id as string } },
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 jours
      },
    });

    // Nettoyage silencieux des sessions expirées
    this.prisma.userSession
      .deleteMany({
        where: { userId: (user as any).id, expiresAt: { lt: new Date() } },
      })
      .catch(() => {
        /* silencieux */
      });

    res.cookie('access_token', accessToken, COOKIE_CONFIG.ACCESS);
    res.cookie('refresh_token', refreshToken, COOKIE_CONFIG.REFRESH);

    // ── Cookie "trusted device" — valide 30 jours, évite le 2FA sur cet appareil ──
    const trustToken = this.jwtService.sign(
      { sub: (user as any).id, purpose: 'trusted-device' },
      { expiresIn: '30d' },
    );
    res.cookie('trust_device', trustToken, COOKIE_CONFIG.TRUSTED_DEVICE);

    this.logger.log(
      `✅ 2FA validé pour user ${userId} — cookie trusted-device posé`,
    );

    res.json({
      user: {
        id: (user as any).id,
        email: (user as any).email,
        firstName: (user as any).firstName,
        lastName: (user as any).lastName,
        role: (user as any).role,
        companyId: (user as any).companyId ?? null,
        cabinetId: cabinetId ?? null,
        managedByCabinet: managedByCabinet,
      },
    });
  }

  async disable(
    userId: string,
    password: string,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true, twoFactorEnabled: true, role: true },
    });
    if (!user) throw new BadRequestException('Utilisateur introuvable');
    if (!user.twoFactorEnabled) {
      throw new BadRequestException(`Le 2FA n'est pas activé sur ce compte`);
    }

    if (ROLES_REQUIRING_2FA.includes(user.role)) {
      throw new BadRequestException(
        'Le 2FA est obligatoire pour votre rôle et ne peut pas être désactivé.',
      );
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) throw new BadRequestException('Mot de passe incorrect');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: [],
      } as any,
    });

    this.logger.log(`2FA désactivé pour user ${userId}`);
    return { message: '2FA désactivé avec succès' };
  }

  static requiresTwoFactor(role: string): boolean {
    return ROLES_REQUIRING_2FA.includes(role);
  }
}
