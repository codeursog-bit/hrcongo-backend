// ============================================================================
// 📁 src/holidays/holidays-cron.service.ts
// 🇨🇬 Maintenance automatique des jours fériés légaux du Congo.
//
// Objectif : chaque entreprise a TOUJOURS les fériés jusqu'à (année en cours + 5).
// Quand l'année change, la nouvelle année "+5" est ajoutée toute seule.
//
// Conçu pour ne jamais gêner le serveur :
//   • 1 exécution par semaine (dimanche 03h30, heure de Brazzaville) — la
//     plupart du temps il n'y a RIEN à faire (1 seule requête de lecture).
//   • Verrou anti-doublon (CronLockService) : jamais 2 exécutions en parallèle,
//     même avec plusieurs instances du serveur.
//   • Traitement par lots de 100 entreprises, un échec sur une entreprise
//     n'arrête pas les autres, aucune erreur ne remonte jusqu'au serveur.
//   • 100 % idempotent : n'écrase et ne supprime JAMAIS rien (createMany +
//     skipDuplicates sur l'unique companyId+date). Compatible avec le SQL de
//     rattrapage et avec tes fériés personnalisés.
//   • Interrupteur : HOLIDAYS_AUTO_TOPUP=false dans le .env désactive la tâche.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../cron-lock/cron-lock.service';
import { seedCongoPublicHolidays } from '../common/congo-public-holidays';

const LOCK = 'holidays:topup';
const LOCK_TTL_SECONDS = 600;
const YEARS_AHEAD = 5;
const BATCH_SIZE = 100;

@Injectable()
export class HolidaysCronService {
  private readonly logger = new Logger('🇨🇬 Fériés');

  constructor(
    private readonly prisma: PrismaService,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('30 3 * * 0', { timeZone: 'Africa/Brazzaville' })
  async handleTopUp(): Promise<void> {
    if (process.env.HOLIDAYS_AUTO_TOPUP === 'false') return;

    let locked = false;
    try {
      if (!(await this.cronLock.acquire(LOCK, LOCK_TTL_SECONDS))) {
        this.logger.debug(`⏭️ ${LOCK} déjà en cours ailleurs, exécution sautée`);
        return;
      }
      locked = true;
      await this.topUpAllCompanies();
    } catch (err) {
      // Ne jamais laisser remonter : un échec ici ne doit pas affecter le serveur
      this.logger.error('Mise à jour des jours fériés échouée', err as any);
    } finally {
      if (locked) await this.cronLock.release(LOCK);
    }
  }

  /**
   * Complète, pour toutes les entreprises qui n'ont aucun férié en
   * (année en cours + 5), les années [année en cours → +5].
   * Retourne { companies, failed } (utile pour les logs / tests).
   */
  async topUpAllCompanies(): Promise<{ companies: number; failed: number }> {
    const year = new Date().getFullYear();
    const target = year + YEARS_AHEAD;

    let cursor: string | undefined;
    let companies = 0;
    let failed = 0;

    // Pagination par id croissant : chaque entreprise n'est examinée qu'UNE fois
    // par exécution (pas de boucle infinie même si l'une d'elles échoue).
    for (;;) {
      const batch = await this.prisma.company.findMany({
        where: {
          publicHolidays: { none: { year: target } },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;

      for (const c of batch) {
        try {
          await seedCongoPublicHolidays(this.prisma, c.id, year, target);
          companies++;
        } catch (err) {
          failed++;
          this.logger.error(`Fériés non créés pour company ${c.id}`, err as any);
        }
      }
      cursor = batch[batch.length - 1].id;
    }

    if (companies > 0 || failed > 0) {
      this.logger.log(
        `✅ Fériés ${year}-${target} complétés : ${companies} entreprise(s)` +
          (failed > 0 ? `, ${failed} échec(s)` : ''),
      );
    }
    return { companies, failed };
  }
}