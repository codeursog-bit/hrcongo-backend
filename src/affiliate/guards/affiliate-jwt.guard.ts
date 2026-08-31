// src/affiliate/guards/affiliate-jwt.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AffiliateJwtGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token manquant');
    }

    const token = authHeader.split(' ')[1];
    let payload: any;

    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Token invalide ou expiré');
    }

    if (!payload.affiliateId) {
      throw new UnauthorizedException('Token non autorisé pour un affilié');
    }

    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: payload.affiliateId },
    });

    if (!affiliate || !affiliate.isActive) {
      throw new UnauthorizedException(
        'Compte affilié introuvable ou désactivé',
      );
    }

    req.affiliate = affiliate;
    return true;
  }
}
