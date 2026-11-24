// 📁 EMPLACEMENT (projet backend) : src/device-sync/guards/sync-agent-key.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

export const hashAgentKey = (key: string): string =>
  createHash('sha256').update(key).digest('hex');

// ✅ Authentifie l'AGENT installé chez le client (pas un employé) via le header
//    "x-sync-agent-key". Seul le hash SHA-256 de la clé est en base.
//    Attache req.syncConnector : l'agent ne peut agir QUE sur sa propre
//    pointeuse, donc que sur sa propre entreprise.
@Injectable()
export class SyncAgentKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const key = req.headers['x-sync-agent-key'];
    if (!key || typeof key !== 'string') {
      throw new UnauthorizedException("Clé de l'agent manquante.");
    }

    let connector;
    try {
      connector = await this.prisma.syncConnector.findUnique({
        where: { agentKeyHash: hashAgentKey(key) },
      });
    } catch {
      // Panne base temporaire : l'agent réessaiera au prochain cycle.
      throw new ServiceUnavailableException('Service momentanément indisponible.');
    }

    if (!connector || !connector.isActive) {
      throw new UnauthorizedException('Connecteur inconnu ou désactivé.');
    }
    req.syncConnector = connector;
    return true;
  }
}