import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { LoginDto } from './dto/login.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CabinetWalletService } from '../cabinet/services/cabinet-wallet.service';
import { RegisterDto } from './dto/register.dto';
import { AffiliateService } from '../affiliate/affiliate.service';
import { MailService } from '../mail/mail.service';
import { Response, Request } from 'express';
import { normalizePhone } from '../common/utils/phone.util';

export class ChangePasswordDto {
  currentPassword!: string;
  newPassword!: string;
}

const MAX_LOGIN_ATTEMPTS = 10;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000;
const REFRESH_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const isProd = process.env.NODE_ENV === 'production';
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

const sameSiteValue: 'lax' | 'none' | 'strict' =
  isProd && !cookieDomain ? 'none' : 'lax';

export const COOKIE_CONFIG = {
  ACCESS: {
    httpOnly: true,
    secure: isProd,
    sameSite: sameSiteValue,
    maxAge: 2 * 60 * 60 * 1000,
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  },
  REFRESH: {
    httpOnly: true,
    secure: isProd,
    sameSite: sameSiteValue,
    maxAge: REFRESH_DURATION_MS,
    path: '/auth/refresh',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  },
  TRUSTED_DEVICE: {
    httpOnly: true,
    secure: isProd,
    sameSite: sameSiteValue,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  },
};

const CLEAR_OPTIONS = {
  ACCESS: {
    path: '/',
    secure: isProd,
    sameSite: sameSiteValue,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  },
  REFRESH: {
    path: '/auth/refresh',
    secure: isProd,
    sameSite: sameSiteValue,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  },
  TRUSTED_DEVICE: {
    path: '/',
    secure: isProd,
    sameSite: sameSiteValue,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  },
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
    private cabinetWalletService: CabinetWalletService,
    private affiliateService: AffiliateService,
    private mailService: MailService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOne(email);
    if (user && (await bcrypt.compare(pass, user.password))) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  // ← req ajouté pour lire le cookie trust_device
  async login(
    loginDto: LoginDto & { ip?: string },
    res: Response,
    req: Request,
  ) {
    // ✅ Le champ `email` peut contenir un email OU un numéro de téléphone.
    // Le téléphone n'est JAMAIS stocké sur User : on passe par l'employé lié.
    // Si aucun compte User n'est encore rattaché à cet employé, le login échoue
    // normalement (comportement voulu : pas d'accès tant que l'email n'a pas
    // été lié à un compte).
    const identifier = loginDto.email?.trim();
    const isEmailFormat = /\S+@\S+\.\S+/.test(identifier);

    let user: any = null;
    if (isEmailFormat) {
      user = await this.prisma.user.findUnique({
        where: { email: identifier },
      });
    } else {
      // ✅ On normalise ce que l'utilisateur tape (espaces, +242, 00242, 242...)
      // pour retrouver le même format canonique que celui stocké sur Employee.phone.
      const normalizedPhone = normalizePhone(identifier);
      const employee = normalizedPhone
        ? await this.prisma.employee.findFirst({
            where: { phone: normalizedPhone },
            include: { user: true },
          })
        : null;
      user = employee?.user ?? null;
    }

    if (!user)
      throw new UnauthorizedException(
        'Email/téléphone ou mot de passe incorrect',
      );

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60000,
      );
      throw new UnauthorizedException(
        `Compte temporairement verrouillé. Réessayez dans ${minutesLeft} minute(s).`,
      );
    }

    const passwordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );
    if (!passwordValid) {
      await this.recordFailedAttempt(user.id);
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    if (!user.isActive) throw new UnauthorizedException('Compte désactivé');

    const updateData: any = {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: loginDto.ip || null,
    };
    if (!user.firstLoginAt) updateData.firstLoginAt = new Date();
    await this.prisma.user.update({ where: { id: user.id }, data: updateData });

    if (user.mustChangePassword) {
      const tempToken = this.jwtService.sign(
        { email: user.email, sub: user.id, temp: true },
        { expiresIn: '15m' },
      );
      return res.json({
        status: 'MUST_CHANGE_PASSWORD',
        message: 'Vous devez changer votre mot de passe',
        tempToken,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      });
    }

    let cabinetId: string | null = null;
    if (user.role === 'CABINET_ADMIN' || user.role === 'CABINET_GESTIONNAIRE') {
      const cu = await this.prisma.cabinetUser.findFirst({
        where: { userId: user.id },
        select: { cabinetId: true },
      });
      cabinetId = cu?.cabinetId ?? null;
    }

    let managedByCabinet = false;
    if (user.companyId) {
      const co = await this.prisma.company.findUnique({
        where: { id: user.companyId },
        select: { managedByCabinet: true },
      });
      managedByCabinet = co?.managedByCabinet ?? false;
    }

    if (user.twoFactorEnabled) {
      // ✅ On lit le cookie trust_device depuis req.cookies (HttpOnly — envoyé auto par le browser)
      // On NE lit plus loginDto.trustedDeviceToken car le front ne peut pas lire un cookie HttpOnly
      const trustedDeviceToken = req.cookies?.trust_device;

      if (trustedDeviceToken) {
        try {
          const td = this.jwtService.verify(trustedDeviceToken);
          // Vérifier que le token appartient bien à CET utilisateur
          // → empêche qu'un cookie d'un autre compte bypass le 2FA
          if (td.purpose === 'trusted-device' && td.sub === user.id) {
            this.logger.log(
              `🔓 Appareil de confiance reconnu pour user ${user.id}`,
            );
            return this.issueTokensAndSetCookies(
              { ...user, cabinetId, managedByCabinet },
              res,
            );
          }
        } catch {
          // Token expiré ou invalide → on demande le 2FA normalement
          this.logger.warn(
            `⚠️ Token trusted-device invalide/expiré pour user ${user.id}`,
          );
        }
      }

      const tempToken2fa = this.jwtService.sign(
        { sub: user.id, purpose: '2fa-pending' },
        { expiresIn: '10m' },
      );
      return res.json({
        status: 'REQUIRES_2FA',
        message: `Code d'authentification requis`,
        tempToken2fa,
      });
    }

    return this.issueTokensAndSetCookies(
      { ...user, cabinetId, managedByCabinet },
      res,
    );
  }

  async register(dto: RegisterDto, res: Response) {
    if (dto.accountType === 'CABINET') return this.registerCabinet(dto, res);
    return this.registerCompany(dto, res);
  }

  private async registerCompany(dto: RegisterDto, res: Response) {
    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: 'ADMIN',
      },
    });
    this.mailService
      .sendWelcomeAdmin({
        to: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      })
      .catch((err) =>
        this.logger.error('Erreur email inscription company:', err),
      );
    return this.issueTokensAndSetCookies(
      { ...user, cabinetId: null, managedByCabinet: false },
      res,
    );
  }

  private async registerCabinet(dto: RegisterDto, res: Response) {
    if (!dto.cabinetName || !dto.subdomain)
      throw new BadRequestException('Nom du cabinet et sous-domaine requis');

    const existingSubdomain = await this.prisma.cabinet.findUnique({
      where: { subdomain: dto.subdomain },
    });
    if (existingSubdomain)
      throw new BadRequestException(
        `Sous-domaine "${dto.subdomain}" déjà utilisé`,
      );

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser)
      throw new BadRequestException('Un compte existe déjà avec cet email');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const { user, cabinet } = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email,
          password: hashedPassword,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: 'CABINET_ADMIN',
        },
      });
      const newCabinet = await tx.cabinet.create({
        data: {
          name: dto.cabinetName!,
          email: dto.email,
          phone: dto.cabinetPhone,
          subdomain: dto.subdomain!,
        },
      });
      await tx.cabinetUser.create({
        data: {
          cabinetId: newCabinet.id,
          userId: newUser.id,
          role: 'CABINET_ADMIN',
        },
      });
      return { user: newUser, cabinet: newCabinet };
    });

    await this.cabinetWalletService.createWalletWithTrial(cabinet.id);

    const affiliateCode = (dto as any).affiliateCode as string | undefined;
    if (affiliateCode) {
      try {
        await this.affiliateService.linkCabinet(affiliateCode, cabinet.id);
      } catch (err: any) {
        this.logger.warn(`[Affiliate] Erreur linkage cabinet: ${err.message}`);
      }
    }

    this.mailService
      .sendWelcomeAdmin({
        to: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      })
      .catch((err) =>
        this.logger.error('Erreur email inscription cabinet:', err),
      );
    return this.issueTokensAndSetCookies(
      { ...user, cabinetId: cabinet.id },
      res,
    );
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');
    const valid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!valid) throw new BadRequestException('Mot de passe actuel incorrect');
    this.validatePasswordStrength(dto.newPassword);
    const same = await bcrypt.compare(dto.newPassword, user.password);
    if (same)
      throw new BadRequestException(
        'Le nouveau mot de passe doit être différent',
      );
    const hashed = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: hashed,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });
    await this.revokeAllSessions(userId);
    return { success: true, message: 'Mot de passe changé. Reconnectez-vous.' };
  }

  async forcePasswordChange(
    tempToken: string,
    newPassword: string,
    res: Response,
  ) {
    try {
      const payload = this.jwtService.verify(tempToken);
      if (!payload.temp || !payload.sub)
        throw new UnauthorizedException('Token invalide');
      this.validatePasswordStrength(newPassword);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user) throw new UnauthorizedException('Utilisateur introuvable');
      const same = await bcrypt.compare(newPassword, user.password);
      if (same)
        throw new BadRequestException('Mot de passe identique au précédent');
      const hashed = await bcrypt.hash(newPassword, 10);
      await this.prisma.user.update({
        where: { id: payload.sub },
        data: {
          password: hashed,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          firstLoginAt: new Date(),
        },
      });
      const updated = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!updated)
        throw new UnauthorizedException('Utilisateur introuvable après update');
      let cabinetId: string | null = null;
      if (
        updated.role === 'CABINET_ADMIN' ||
        updated.role === 'CABINET_GESTIONNAIRE'
      ) {
        const cu = await this.prisma.cabinetUser.findFirst({
          where: { userId: updated.id },
          select: { cabinetId: true },
        });
        cabinetId = cu?.cabinetId ?? null;
      }
      return this.issueTokensAndSetCookies({ ...updated, cabinetId }, res);
    } catch (error: any) {
      if (
        error.name === 'JsonWebTokenError' ||
        error.name === 'TokenExpiredError'
      )
        throw new UnauthorizedException('Token invalide ou expiré');
      throw error;
    }
  }

  async refreshToken(refreshToken: string, res: Response) {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken);
    } catch {
      throw new UnauthorizedException(
        'Token de rafraîchissement invalide ou expiré',
      );
    }
    if (payload.type !== 'refresh' || !payload.jti)
      throw new UnauthorizedException('Token invalide');
    const session = await this.prisma.userSession.findUnique({
      where: { jti: payload.jti },
    });
    if (!session || session.userId !== payload.sub || session.revokedAt)
      throw new UnauthorizedException(
        'Session invalide ou révoquée. Reconnectez-vous.',
      );
    await this.prisma.userSession.update({
      where: { jti: payload.jti },
      data: { revokedAt: new Date() },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user?.isActive)
      throw new UnauthorizedException('Compte introuvable ou désactivé');
    let cabinetId: string | undefined;
    if (user.role === 'CABINET_ADMIN' || user.role === 'CABINET_GESTIONNAIRE') {
      const cu = await this.prisma.cabinetUser.findFirst({
        where: { userId: user.id },
        select: { cabinetId: true },
      });
      cabinetId = cu?.cabinetId;
    }
    return this.issueTokensAndSetCookies({ ...user, cabinetId }, res);
  }

  async logout(
    userId: string,
    refreshToken: string | undefined,
    res: Response,
  ) {
    if (refreshToken) {
      try {
        const payload = this.jwtService.verify(refreshToken);
        if (payload.jti)
          await this.prisma.userSession.updateMany({
            where: { jti: payload.jti, userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
      } catch {
        /* token déjà expiré */
      }
    }
    await this.prisma.activityLog.create({
      data: {
        userId,
        action: 'LOGOUT',
        entity: 'AUTH',
        description: 'Déconnexion utilisateur',
      },
    });
    res.clearCookie('access_token', CLEAR_OPTIONS.ACCESS);
    res.clearCookie('refresh_token', CLEAR_OPTIONS.REFRESH);
    // ✅ trust_device NON effacé volontairement — permet de ne pas redemander
    // le 2FA quand l'user se reconnecte sur le même appareil dans les 30j
    return res.json({ success: true, message: 'Déconnexion réussie' });
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const safeMsg =
      'Si un compte existe avec cet email, vous recevrez un lien de réinitialisation.';
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return { message: safeMsg };
    const resetToken = this.jwtService.sign(
      { sub: user.id, purpose: 'password-reset' },
      { expiresIn: '30m' },
    );
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const resetUrl = `${appUrl}/auth/reset-password?token=${resetToken}`;
    await this.mailService.sendPasswordReset({
      to: user.email,
      firstName: user.firstName,
      resetUrl,
    });
    return { message: safeMsg };
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    let payload: any;
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new BadRequestException(
        'Lien invalide ou expiré. Veuillez refaire une demande.',
      );
    }
    if (payload.purpose !== 'password-reset' || !payload.sub)
      throw new BadRequestException('Token invalide.');
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.isActive)
      throw new BadRequestException('Compte introuvable ou désactivé.');
    this.validatePasswordStrength(newPassword);
    const same = await bcrypt.compare(newPassword, user.password);
    if (same)
      throw new BadRequestException(
        'Le nouveau mot de passe doit être différent du précédent.',
      );
    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await this.revokeAllSessions(user.id);
    return { message: 'Mot de passe réinitialisé avec succès.' };
  }

  private async issueTokensAndSetCookies(user: any, res: Response) {
    const jti = uuidv4();
    const accessPayload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      companyId: user.companyId ?? null,
      cabinetId: user.cabinetId ?? null,
      managedByCabinet: user.managedByCabinet ?? false,
    };
    const refreshPayload = { sub: user.id, type: 'refresh', jti };
    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: '2h',
    });
    const refreshToken = this.jwtService.sign(refreshPayload, {
      expiresIn: '30d',
    });
    await this.prisma.userSession.create({
      data: {
        jti,
        user: { connect: { id: user.id } },
        expiresAt: new Date(Date.now() + REFRESH_DURATION_MS),
      },
    });
    this.prisma.userSession
      .deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } })
      .catch(() => {});
    res.cookie('access_token', accessToken, COOKIE_CONFIG.ACCESS);
    res.cookie('refresh_token', refreshToken, COOKIE_CONFIG.REFRESH);
    return res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        companyId: user.companyId ?? null,
        cabinetId: user.cabinetId ?? null,
        managedByCabinet: user.managedByCabinet ?? false,
        canRecordAttendanceForAll: user.canRecordAttendanceForAll ?? false, // 🆕 permission "secrétaire" pointage
      },
    });
  }

  private async recordFailedAttempt(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { failedLoginAttempts: true } as any,
    });
    const attempts = ((user as any)?.failedLoginAttempts ?? 0) + 1;
    const data: any = { failedLoginAttempts: attempts };
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      data.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      this.logger.warn(
        `🔒 Compte ${userId} verrouillé après ${attempts} tentatives`,
      );
    }
    await this.prisma.user.update({ where: { id: userId }, data });
  }

  private async revokeAllSessions(userId: string) {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private validatePasswordStrength(password: string): void {
    if (password.length < 8)
      throw new BadRequestException('Au moins 8 caractères');
    if (!/[A-Z]/.test(password))
      throw new BadRequestException('Au moins une majuscule');
    if (!/[a-z]/.test(password))
      throw new BadRequestException('Au moins une minuscule');
    if (!/[0-9]/.test(password))
      throw new BadRequestException('Au moins un chiffre');
  }
}
