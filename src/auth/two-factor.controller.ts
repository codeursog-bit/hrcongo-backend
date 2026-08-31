// ============================================================================
// 📁 src/auth/two-factor.controller.ts
// ============================================================================
// ✅ FIX : /validate et /authenticate acceptent maintenant "tempToken2fa"
//          (nom envoyé par le frontend) ET "tempToken" (ancien nom) pour
//          assurer la compatibilité sans casser les autres clients.
// ============================================================================
import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { TwoFactorService } from './two-factor.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';

@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  // ── Générer le secret + QR code ───────────────────────────────────────────
  @Post('setup')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async setup(@Req() req: any) {
    return this.twoFactorService.setup(req.user.userId);
  }

  // ── Activer le 2FA (confirmer avec le premier code) ───────────────────────
  @Post('activate')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  async activate(@Req() req: any, @Body('code') code: string) {
    if (!code) throw new BadRequestException('Code requis');
    return this.twoFactorService.activate(req.user.userId, code);
  }

  // ── Valider le code 2FA lors du login (/authenticate) ────────────────────
  // Public — l'utilisateur a un tempToken2fa, pas encore de session complète
  @Post('authenticate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  async authenticate(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    // ✅ Accepte "tempToken2fa" (frontend) ET "tempToken" (legacy)
    const tempToken = body.tempToken2fa ?? body.tempToken;
    const code = body.code;

    if (!tempToken || !code) {
      throw new BadRequestException('Token temporaire et code requis');
    }
    return this.twoFactorService.validateCode(tempToken, code, res);
  }

  // ── Valider le code 2FA lors du login (/validate) — route principale ─────
  // C'est cette route que le frontend appelle (POST /auth/2fa/validate)
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  async validate(@Body() body: Record<string, string>, @Res() res: Response) {
    // ✅ Accepte "tempToken2fa" (frontend) ET "tempToken" (legacy)
    const tempToken = body.tempToken2fa ?? body.tempToken;
    const code = body.code;

    if (!tempToken || !code) {
      throw new BadRequestException('Token temporaire et code requis');
    }
    return this.twoFactorService.validateCode(tempToken, code, res);
  }

  // ── Désactiver le 2FA ─────────────────────────────────────────────────────
  @Post('disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disable(@Req() req: any, @Body('password') password: string) {
    if (!password)
      throw new BadRequestException(
        'Mot de passe requis pour désactiver le 2FA',
      );
    return this.twoFactorService.disable(req.user.userId, password);
  }
}
