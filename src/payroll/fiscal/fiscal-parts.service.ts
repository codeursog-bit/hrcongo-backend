// ============================================================================
// 📁 src/payroll/fiscal/fiscal-parts.service.ts
// 🇨🇬 CONGO : Service de calcul des parts fiscales (MODE IRPP_LEGACY)
// ============================================================================
//
// ✅ TABLE DES PARTS OFFICIELLE — Source : Gnanga HEG-Brazza / CGI Art. 91
//
//   Situation       | 0 enf | 1 enf | 2 enf | 3 enf | 4 enf
//   Célibataire/Div |   1   |   2   |  2,5  |   3   |  3,5
//   Marié(e)        |   2   |  2,5  |   3   |  3,5  |   4
//   Veuf/Veuve      |   1   |  2,5  |   3   |  3,5  |   4
//
// ⚠️  EN 2026 : Les parts fiscales sont supprimées (passage à l'ITS)
//     Ce service reste actif pour le mode IRPP_LEGACY uniquement.
//
// ============================================================================
import { Injectable } from '@nestjs/common';
import { MAX_FISCAL_PARTS } from './tax-brackets.constant';

export enum MaritalStatus {
  SINGLE = 'SINGLE',
  MARRIED = 'MARRIED',
  DIVORCED = 'DIVORCED',
  WIDOWED = 'WIDOWED',
}

@Injectable()
export class FiscalPartsService {
  /**
   * Calcule le nombre de parts fiscales selon la table officielle Congo.
   *
   * Table officielle (CGI Art. 91, source Gnanga HEG-Brazza) :
   *
   *   Célibataire/Divorcé :
   *     0 enf = 1  |  1 enf = 2  |  2+ = 2 + (n-1)×0.5
   *   Marié :
   *     0 enf = 2  |  n enf = 2 + n×0.5
   *   Veuf/Veuve :
   *     0 enf = 1  |  1 enf = 2.5  |  2+ = 2.5 + (n-1)×0.5
   *
   * Maximum légal : 6.5 parts
   */
  calculateFiscalParts(
    maritalStatus: MaritalStatus,
    numberOfChildren: number,
  ): number {
    let parts: number;
    const n = Math.max(0, numberOfChildren);

    switch (maritalStatus) {
      case MaritalStatus.MARRIED:
        // Marié : 2 parts + 0.5 par enfant
        parts = 2 + n * 0.5;
        break;

      case MaritalStatus.WIDOWED:
        // Veuf/Veuve : 1 part sans enfant
        //              2.5 avec 1 enfant
        //              +0.5 par enfant supplémentaire
        if (n === 0) {
          parts = 1;
        } else {
          parts = 2.5 + (n - 1) * 0.5;
        }
        break;

      case MaritalStatus.SINGLE:
      case MaritalStatus.DIVORCED:
      default:
        // Célibataire/Divorcé : 1 part sans enfant
        //                       2 parts avec 1 enfant
        //                       +0.5 par enfant supplémentaire
        if (n === 0) {
          parts = 1;
        } else {
          parts = 2 + (n - 1) * 0.5;
        }
        break;
    }

    return Math.min(parts, MAX_FISCAL_PARTS);
  }

  validateNumberOfChildren(numberOfChildren: number): void {
    if (numberOfChildren < 0) {
      throw new Error("Le nombre d'enfants ne peut pas être négatif");
    }
    if (numberOfChildren > 20) {
      throw new Error("Le nombre d'enfants semble anormalement élevé (max 20)");
    }
  }
}
