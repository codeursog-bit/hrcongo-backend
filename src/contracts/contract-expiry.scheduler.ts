// ============================================================================
// 📁 src/contracts/contract-expiry.scheduler.ts
// ============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ContractExpiryService } from './contract-expiry.service';

@Injectable()
export class ContractExpiryScheduler {
  private readonly logger = new Logger(ContractExpiryScheduler.name);

  constructor(private contractExpiryService: ContractExpiryService) {}

  // Chaque jour à 8h00 heure Brazzaville
  @Cron('0 8 * * *', { timeZone: 'Africa/Brazzaville' })
  async handleDailyCheck() {
    this.logger.log('⏰ Vérification quotidienne des contrats expirants...');
    try {
      await this.contractExpiryService.checkExpiringContracts();
      this.logger.log('✅ Vérification terminée');
    } catch (err) {
      this.logger.error('❌ Erreur vérification contrats:', err);
    }
  }
}