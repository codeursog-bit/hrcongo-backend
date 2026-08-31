// ============================================================================
// 📁 loans.service.ts
// ✅ v4 — Façade fine. La logique est répartie en 4 services spécialisés :
//      - loans-requests.service.ts   → création / listing / édition / suppression
//      - loans-decision.service.ts   → validation/refus (workflow PARALLÈLE)
//      - loans-repayment.service.ts  → déductions / remboursement espèces / historique
//      - loans-documents.service.ts  → données imprimables / autorisation d'impression
//    Cette façade ne fait qu'orchestrer : elle garde exactement les mêmes
//    méthodes publiques qu'avant pour que le controller et les autres
//    modules (ex: payrolls.module.ts qui injecte LoansService) n'aient rien
//    à changer. Le but : pouvoir modifier un seul domaine (ex: ajouter un
//    seuil mensuel de prêt) sans toucher aux 3 autres.
// ============================================================================

import { Injectable } from '@nestjs/common';
import { CreateLoanDto } from './dto/create-loan.dto';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { UpdateAdvanceDto } from './dto/update-advance.dto';
import { LoansRequestsService } from './loans-requests.service';
import { LoansDecisionService } from './loans-decision.service';
import { LoansRepaymentService } from './loans-repayment.service';
import { LoansDocumentsService } from './loans-documents.service';
import { LoansOrcaExportService } from './loans-orca-export.service';
import { LoansGenericExportService } from './loans-generic-export.service';

@Injectable()
export class LoansService {
  constructor(
    private requests: LoansRequestsService,
    private decision: LoansDecisionService,
    private repayment: LoansRepaymentService,
    private documents: LoansDocumentsService,
    private orcaExport: LoansOrcaExportService,
    private genericExport: LoansGenericExportService,
  ) {}

  // ── Prêts : demandes / CRUD ─────────────────────────────────────────────
  createLoan(data: CreateLoanDto, userId: string) { return this.requests.createLoan(data, userId); }
  findAllLoans(userId: string, status?: string) { return this.requests.findAllLoans(userId, status); }
  findMyLoans(userId: string) { return this.requests.findMyLoans(userId); }
  findOneLoan(id: string, userId: string) { return this.requests.findOneLoan(id, userId); }
  updateLoan(id: string, dto: UpdateLoanDto, userId: string) { return this.requests.updateLoan(id, dto, userId); }
  deleteLoan(id: string, userId: string) { return this.requests.deleteLoan(id, userId); }
  cancelLoan(id: string, userId: string) { return this.requests.cancelLoan(id, userId); }
  forceLoanStatus(id: string, userId: string, status: string, recoverViaPayroll?: boolean) {
    return this.requests.forceLoanStatus(id, userId, status, recoverViaPayroll);
  }

  // ── Avances : demandes / CRUD ────────────────────────────────────────────
  createAdvance(data: CreateAdvanceDto, userId: string) { return this.requests.createAdvance(data, userId); }
  findAllAdvances(userId: string, status?: string) { return this.requests.findAllAdvances(userId, status); }
  findMyAdvances(userId: string) { return this.requests.findMyAdvances(userId); }
  findOneAdvance(id: string, userId: string) { return this.requests.findOneAdvance(id, userId); }
  updateAdvance(id: string, dto: UpdateAdvanceDto, userId: string) { return this.requests.updateAdvance(id, dto, userId); }
  deleteAdvance(id: string, userId: string) { return this.requests.deleteAdvance(id, userId); }
  cancelAdvance(id: string, userId: string) { return this.requests.cancelAdvance(id, userId); }

  // ── Décisions (workflow parallèle) ───────────────────────────────────────
  decideLoan(id: string, decision: 'OUI' | 'NON', userId: string, rejectionReason?: string, recoverViaPayroll = true) {
    return this.decision.decideLoan(id, decision, userId, rejectionReason, recoverViaPayroll);
  }
  decideAdvance(id: string, decision: 'APPROVED' | 'REJECTED', userId: string, rejectionReason?: string, recoverViaPayroll = true) {
    return this.decision.decideAdvance(id, decision, userId, rejectionReason, recoverViaPayroll);
  }

  // ── Remboursement / déduction / historique ───────────────────────────────
  processMonthlyDeduction(loanId: string) { return this.repayment.processMonthlyDeduction(loanId); }
  recordCashRepayment(loanId: string, amount: number, userId: string) {
    return this.repayment.recordCashRepayment(loanId, amount, userId);
  }
  deleteCashRepayment(loanId: string, logId: string, userId: string) {
    return this.repayment.deleteCashRepayment(loanId, logId, userId);
  }
  getLoanHistory(loanId: string, userId: string) { return this.repayment.getLoanHistory(loanId, userId); }
  recordAdvanceCashRepayment(advanceId: string, amount: number, userId: string) {
    return this.repayment.recordAdvanceCashRepayment(advanceId, amount, userId);
  }
  deleteAdvanceCashRepayment(advanceId: string, logId: string, userId: string) {
    return this.repayment.deleteAdvanceCashRepayment(advanceId, logId, userId);
  }
  getAdvanceHistory(advanceId: string, userId: string) { return this.repayment.getAdvanceHistory(advanceId, userId); }
  markAdvancePaidInCash(id: string, userId: string) { return this.repayment.markAdvancePaidInCash(id, userId); }
  markAdvanceAsDeducted(advanceId: string) { return this.repayment.markAdvanceAsDeducted(advanceId); }

  // ── Documents imprimables ─────────────────────────────────────────────────
  getLoanDocumentData(id: string) { return this.documents.getLoanDocumentData(id); }
  getAdvanceDocumentData(id: string) { return this.documents.getAdvanceDocumentData(id); }
  setLoanPrintAuthorization(id: string, authorized: boolean, userId: string) {
    return this.documents.setLoanPrintAuthorization(id, authorized, userId);
  }
  setAdvancePrintAuthorization(id: string, authorized: boolean, userId: string) {
    return this.documents.setAdvancePrintAuthorization(id, authorized, userId);
  }

  // ── Export fiche Excel Orca (écriture directe dans le fichier client) ────
  exportLoanXlsx(id: string, userId: string) { return this.orcaExport.exportLoanXlsx(id, userId); }
  exportAdvanceXlsx(id: string, userId: string) { return this.orcaExport.exportAdvanceXlsx(id, userId); }
  // ── Export PDF (impression depuis l'app) ──────────────────────────────────
  exportLoanPdf(id: string, userId: string) { return this.orcaExport.exportLoanPdf(id, userId); }
  exportAdvancePdf(id: string, userId: string) { return this.orcaExport.exportAdvancePdf(id, userId); }
  // ── Rendu HTML fidèle (aperçu + impression, aucune dépendance serveur) ───
  exportLoanHtml(id: string, userId: string) { return this.orcaExport.exportLoanHtml(id, userId); }
  exportAdvanceHtml(id: string, userId: string) { return this.orcaExport.exportAdvanceHtml(id, userId); }

  // ── Export Excel générique du suivi des dettes (indépendant du format Orca) ──
  exportDebtTrackingXlsx(userId: string, filters: { month?: number; year: number; department?: string; type?: string }) {
    return this.genericExport.exportDebtTrackingXlsx(userId, filters);
  }
}