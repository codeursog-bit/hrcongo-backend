// ============================================================================
// Fichier: backend/src/system-logs/system-logs.service.ts
// Service partagé — écriture de logs système persistés (crons, jobs planifiés).
// N'importe quel module (attendance, leaves, cnss, etc.) peut l'utiliser pour
// écrire ; le module admin l'utilise pour lire/afficher.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type SystemLogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'ALERT';

export interface SystemLogSkip {
  employeeId?: string;
  name?: string;
  reason: string;
}

export interface SystemLogEntry {
  source: string; // ex: "attendance-cron:pre-shift"
  level?: SystemLogLevel;
  message: string; // résumé lisible (ex: "12 évalués, 3 notifiés, 1 skip")
  details?: {
    evaluated?: number;
    notified?: number;
    skipped?: SystemLogSkip[];
    errors?: string[];
    [key: string]: any;
  };
  companyId?: string;
  durationMs?: number;
}

@Injectable()
export class SystemLogsService {
  private readonly logger = new Logger(SystemLogsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Écrit un log système. Ne lève jamais d'exception — un problème de
   * logging ne doit jamais faire planter le cron/job appelant.
   */
  async log(entry: SystemLogEntry): Promise<void> {
    try {
      await this.prisma.systemLog.create({
        data: {
          source: entry.source,
          level: entry.level ?? 'INFO',
          message: entry.message,
          details: (entry.details as any) ?? undefined,
          companyId: entry.companyId,
          durationMs: entry.durationMs,
        },
      });
    } catch (err) {
      this.logger.error(`Impossible d'écrire le SystemLog (${entry.source}) :`, err);
    }
  }
}