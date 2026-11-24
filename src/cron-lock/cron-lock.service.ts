// ============================================================================
// Fichier: backend/src/cron-lock/cron-lock.service.ts
// Verrou anti-chevauchement pour les crons, basé sur une table en base —
// fonctionne aussi bien en instance unique qu'en plusieurs instances.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CronLockService {
  private readonly logger = new Logger(CronLockService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Tente de prendre le verrou `name` pour `ttlSeconds` secondes.
   * Retourne true si acquis (le cron peut tourner), false s'il est déjà
   * pris par une autre exécution encore en cours.
   */
  async acquire(name: string, ttlSeconds: number): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    try {
      await this.prisma.cronLock.create({ data: { name, expiresAt } });
      return true;
    } catch (err: any) {
      if (err.code !== 'P2002') throw err; // erreur inattendue → on la laisse remonter

      // Le verrou existe déjà — s'il est expiré (process précédent planté
      // sans le libérer), on essaie de le reprendre. `updateMany` avec la
      // condition `expiresAt < now` dans le WHERE garantit qu'un seul
      // process gagne la reprise si plusieurs essaient en même temps.
      const takeover = await this.prisma.cronLock.updateMany({
        where: { name, expiresAt: { lt: now } },
        data: { lockedAt: now, expiresAt },
      });
      if (takeover.count > 0) {
        this.logger.warn(`🔓 Verrou "${name}" repris (l'exécution précédente n'a pas libéré le verrou)`);
        return true;
      }
      return false; // toujours pris par une exécution en cours et valide
    }
  }

  /** Libère le verrou — à appeler dans un `finally`, jamais bloquant. */
  async release(name: string): Promise<void> {
    try {
      await this.prisma.cronLock.delete({ where: { name } });
    } catch {
      // déjà libéré / expiré / repris par un autre — rien à faire
    }
  }
}