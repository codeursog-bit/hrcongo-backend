// ============================================================================
// 📁 src/echelon-suggestions/dto/echelon-suggestion.dto.ts
// ============================================================================

export class EchelonSuggestionView {
  id: string;
  employeeId: string;
  employeeName: string;
  conventionCode: string;
  currentEchelonIndex: number;
  currentEchelonLabel: string;
  suggestedEchelonIndex: number;
  suggestedEchelonLabel: string;
  yearsCompleted: number;
  anniversaryDate: Date;
  scheduledNotifyDate: Date;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}

export class EchelonBulkAcceptResultItem {
  employeeId: string;
  employeeName: string;
  oldEchelonLabel: string;
  newEchelonLabel: string;
}