import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// ✅ Authentifie la TABLETTE elle-même (pas un employé) via une clé API
// propre au device, envoyée dans le header "x-kiosk-api-key".
// En cas de succès, attache req.kioskDevice pour le controller/service.
@Injectable()
export class KioskApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const apiKey = req.headers['x-kiosk-api-key'];

    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedException('Clé API de la tablette manquante.');
    }

    let device;
    try {
      device = await this.prisma.kioskDevice.findUnique({
        where: { apiKey },
        include: { additionalCompanies: true },
      });
    } catch {
      // Panne base de données temporaire : message clair plutôt qu'un 500
      // brut, la tablette réessaiera automatiquement au prochain scan.
      throw new ServiceUnavailableException('Service momentanément indisponible.');
    }

    if (!device || !device.isActive) {
      throw new UnauthorizedException('Tablette non reconnue ou désactivée.');
    }

    // companyPorters : toutes les entreprises que cette tablette peut servir,
    // chacune avec SON porteur dédié (jamais un compte "portefeuille" dont
    // l'entreprise active change — voir schéma).
    const companyPorters = new Map<string, string>();
    companyPorters.set(device.companyId, device.actingUserId);
    for (const link of device.additionalCompanies) {
      companyPorters.set(link.companyId, link.actingUserId);
    }

    req.kioskDevice = {
      id: device.id,
      companyId: device.companyId, // entreprise principale, gardé pour compat
      actingUserId: device.actingUserId, // idem
      companyPorters, // Map<companyId, actingUserId> — TOUTES les entreprises servies
    };

    return true;
  }
}