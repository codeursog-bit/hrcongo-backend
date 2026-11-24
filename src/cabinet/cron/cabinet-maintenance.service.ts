import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { CabinetWalletService } from '../services/cabinet-wallet.service';

@Injectable()
export class CabinetMaintenanceService {
  private readonly logger = new Logger(CabinetMaintenanceService.name);

  constructor(
    private prisma: PrismaService,
    private walletService: CabinetWalletService,
  ) {}

  // ==========================================================================
  // ⏰ NETTOYAGE DES ACCÈS EXPIRÉS (TOUS LES JOURS À 01:00 DU MATIN)
  // ==========================================================================
  @Cron('0 1 * * *', {
    name: 'cabinet-expiration-check',
    timeZone: 'Africa/Brazzaville',
  })
  async handleCabinetExpirations() {
    this.logger.log(
      '🔄 Vérification des expirations Cabinets (Brazzaville)...',
    );
    const now = new Date();

    try {
      // 1. Désactiver les forfaits mensuels à 45.000 F qui ont dépassé la date
      const expiredForfaits = await this.prisma.cabinetWallet.updateMany({
        where: {
          isForfait: true,
          forfaitExpiresAt: { lt: now },
        },
        data: {
          isForfait: false, // On coupe l'illimité
          // Le cabinet bascule en mode "bulletin", mais s'il n'a pas de solde, il sera bloqué.
        },
      });

      // 2. Désactiver les Trials (Essais gratuits de 3 mois) expirés
      const expiredTrials = await this.prisma.cabinetWallet.updateMany({
        where: {
          trialActive: true,
          trialExpiresAt: { lt: now },
        },
        data: {
          trialActive: false,
          bulletinsBalance: 0, // On retire les bulletins restants du cadeau
        },
      });

      this.logger.log(
        `✅ Maintenance terminée : ${expiredForfaits.count} forfaits coupés, ${expiredTrials.count} essais terminés.`,
      );
    } catch (error) {
      this.logger.error(
        '❌ Erreur lors de la maintenance des cabinets:',
        error,
      );
    }
  }

  // ==========================================================================
  // 🔔 ALERTES D'EXPIRATION PROCHE (TOUS LES JOURS À 10:00 DU MATIN)
  // ==========================================================================
  @Cron('0 10 * * *', {
    name: 'cabinet-expiration-alerts',
    timeZone: 'Africa/Brazzaville',
  })
  async sendExpirationAlerts() {
    this.logger.log('📧 Envoi des alertes expiration aux cabinets...');

    const inThreeDays = new Date();
    inThreeDays.setDate(inThreeDays.getDate() + 3);

    // Trouver les cabinets qui expirent exactement dans 3 jours
    const upcomingExpirations = await this.prisma.cabinetWallet.findMany({
      where: {
        OR: [
          {
            forfaitExpiresAt: { lte: inThreeDays, gt: new Date() },
            isForfait: true,
          },
          {
            trialExpiresAt: { lte: inThreeDays, gt: new Date() },
            trialActive: true,
          },
        ],
      },
      include: { cabinet: true },
    });

    for (const wallet of upcomingExpirations) {
      // ICI : Appelle ton service d'email pour prévenir Nathan
      this.logger.log(
        `Alerte : Le cabinet ${wallet.cabinet.name} expire bientôt.`,
      );
      // await this.mailService.sendExpirationWarning(wallet.cabinet.email);
    }
  }

  // ==========================================================================
  // 🧹 RÉINITIALISATION MENSUELLE (TOUS LES 1ERS DU MOIS À 00:01)
  // ==========================================================================
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async resetMonthlyStats() {
    this.logger.log('📅 Réinitialisation des compteurs mensuels...');
    await this.prisma.cabinetWallet.updateMany({
      data: {
        bulletinsUsedThisMonth: 0,
        lastResetAt: new Date(),
      },
    });
  }
}
