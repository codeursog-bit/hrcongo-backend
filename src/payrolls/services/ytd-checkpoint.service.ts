// ============================================================================
// src/payrolls/services/ytd-checkpoint.service.ts
//
// ✅ NOUVEAU FICHIER
// Service partagé — pose OU retire le YtdCheckpoint de reset post-congé.
// Utilisé par ManualPayrollService.save() ET PayrollsService.recalculatePayroll(),
// pour que le checkpoint reflète TOUJOURS l'état courant du bulletin, jamais
// un état orphelin d'une version précédente (ex: prime "congé" ajoutée puis
// retirée lors d'une édition).
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class YtdCheckpointService {
  private readonly logger = new Logger(YtdCheckpointService.name);

  /**
   * Réconcilie le YtdCheckpoint du mois de retour (month+1) pour un employé.
   *
   * - Si hasCongesPaies === true  → pose (ou repose) le checkpoint à 0.
   * - Si hasCongesPaies === false → supprime le checkpoint s'il existe déjà
   *   (cas d'une édition qui retire la prime congé d'un bulletin précédemment
   *   sauvegardé avec congé).
   *
   * Doit être appelé à CHAQUE sauvegarde d'un bulletin manuel — création ET
   * édition — dans la même transaction Prisma que le reste de la sauvegarde.
   */
  async reconcile(
    tx: any,
    employeeId: string,
    month: number,
    year: number,
    hasCongesPaies: boolean,
  ): Promise<void> {
    const returnMonth = month === 12 ? 1 : month + 1;
    const returnYear = month === 12 ? year + 1 : year;
    const effectiveDate = new Date(returnYear, returnMonth - 1, 1);

    if (hasCongesPaies) {
      // Idempotent — supprime l'éventuel doublon (re-save du même bulletin)
      await tx.ytdCheckpoint.deleteMany({
        where: { employeeId, effectiveDate },
      });
      await tx.ytdCheckpoint.create({
        data: {
          employeeId,
          effectiveDate,
          brut: 0,
          netImp: 0,
          netSalary: 0,
          chargesSal: 0,
          chargesPat: 0,
        },
      });
      this.logger.log(
        `✅ YtdCheckpoint posé → retour ${returnMonth}/${returnYear} (employé ${employeeId})`,
      );
    } else {
      const deleted = await tx.ytdCheckpoint.deleteMany({
        where: { employeeId, effectiveDate },
      });
      if (deleted.count > 0) {
        this.logger.log(
          `🗑️ YtdCheckpoint orphelin supprimé → ${returnMonth}/${returnYear} (employé ${employeeId})`,
        );
      }
    }
  }
}