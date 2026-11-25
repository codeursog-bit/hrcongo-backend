import { Injectable } from '@nestjs/common';

@Injectable()
export class YtdCheckpointService {
  /** Les resets de congé sont désormais résolus depuis la date de reprise.
   * Conserve le contrat des appelants sans créer de reset lié au paiement.
   * Les checkpoints de reprise manuelle restent inchangés.
   */
  async reconcile(_tx: unknown, _employeeId: string, _month: number, _year: number, _hasCongesPaies: boolean): Promise<void> {}
}
