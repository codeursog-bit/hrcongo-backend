// ============================================================================
// 📁 src/display-screens/guards/display-device.guard.ts
// Authentifie la TABLETTE (pas un employé) via le header « x-display-token »,
// remis à l'approbation. Stocké haché en base ; révocation immédiate (l'écran
// passe REVOKED et son hash est effacé).
// 401 = « écran non reconnu » → le front retourne à l'appairage.
// ============================================================================
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { sha256 } from '../display-token.util';

@Injectable()
export class DisplayDeviceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.headers['x-display-token'];
    if (
      !token ||
      typeof token !== 'string' ||
      token.length < 32 ||
      token.length > 200
    ) {
      throw new UnauthorizedException('Écran non appairé.');
    }

    let screen;
    try {
      screen = await this.prisma.displayScreen.findUnique({
        where: { deviceTokenHash: sha256(token) },
      });
    } catch {
      throw new ServiceUnavailableException(
        'Service momentanément indisponible.',
      );
    }
    if (!screen || screen.status !== 'APPROVED') {
      throw new UnauthorizedException('Écran non reconnu ou désactivé.');
    }

    // « Vu pour la dernière fois » : au plus une écriture toutes les 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (!screen.lastSeenAt || screen.lastSeenAt < fiveMinAgo) {
      this.prisma.displayScreen
        .updateMany({
          where: {
            id: screen.id,
            OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: fiveMinAgo } }],
          },
          data: { lastSeenAt: new Date() },
        })
        .catch(() => undefined);
    }

    req.displayScreen = screen;
    return true;
  }
}