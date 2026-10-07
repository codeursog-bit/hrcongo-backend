// ============================================================================
// 📁 src/companies/ip-sighting-cleanup.service.ts  (NOUVEAU)
// Nettoyage des observations d'IP expirées (> 24 h) — IP apprise du wifi du site.
// Une seule requête DELETE toutes les 6 h, indexée, sur une table minuscule : aucun impact serveur.
// ============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CompanySiteService } from './company-site.service';

@Injectable()
export class IpSightingCleanupService {
  private readonly logger = new Logger(IpSightingCleanupService.name);

  constructor(private readonly sites: CompanySiteService) {}

  @Cron('15 */6 * * *', { timeZone: 'Africa/Brazzaville' })
  async purge() {
    try {
      const n = await this.sites.purgeOldSightings();
      if (n > 0) this.logger.log(`IP apprises : ${n} observation(s) expirée(s) supprimée(s)`);
    } catch (e: any) {
      this.logger.warn(`Nettoyage des IP apprises impossible : ${e?.message ?? e}`);
    }
  }
}