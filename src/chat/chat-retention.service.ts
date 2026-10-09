// ============================================================================
// 📁 chat/chat-retention.service.ts — Garde la base légère
// ----------------------------------------------------------------------------
// Supprime les messages plus vieux que CHAT_RETENTION_DAYS (défaut : 180 j),
// par lots de 2000 avec une petite pause, pour ne jamais verrouiller la table
// ni saturer Neon. Tourne à 03:00 (heure serveur), loin des pointages/paie.
// Les conversations et leurs participants restent (très légers).
//
// Si tu as plusieurs instances, protège ce cron avec ton système de verrou
// existant (table cron_locks) comme pour tes autres tâches planifiées.
// ============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
// ⚠️ ADAPTER le chemin si besoin
import { PrismaService } from '../prisma/prisma.service';

const BATCH = 2000;
const MAX_BATCHES = 50;

@Injectable()
export class ChatRetentionService {
  private readonly logger = new Logger(ChatRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 3 * * *')
  async purgeOldMessages() {
    const days = Math.max(Number(process.env.CHAT_RETENTION_DAYS) || 180, 7);
    const cutoff = new Date(Date.now() - days * 86_400_000);
    let total = 0;

    for (let i = 0; i < MAX_BATCHES; i++) {
      const n = await this.prisma.$executeRaw`
        DELETE FROM "chat_messages"
        WHERE "id" IN (
          SELECT "id" FROM "chat_messages" WHERE "createdAt" < ${cutoff} LIMIT ${BATCH}
        )`;
      total += n;
      if (n < BATCH) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (total) this.logger.log(`Messagerie : ${total} message(s) de plus de ${days} jours supprimé(s).`);
  }
}