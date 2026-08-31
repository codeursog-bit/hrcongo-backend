// ============================================================================
// src/cabinet/services/cabinet-batch-closure.service.ts
//
// Lance la paie de toutes les PME d'un cabinet en une seule opération.
// Utilise Server-Sent Events pour envoyer la progression en temps réel
// au frontend (barre de progression live).
// ============================================================================

import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CabinetWalletService } from './cabinet-wallet.service';
import { Response } from 'express';

export interface BatchProgress {
  batchId: string;
  status: string;
  totalCompanies: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  currentCompany: string | null;
  items: BatchItemResult[];
}

export interface BatchItemResult {
  companyId: string;
  companyName: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  bulletinsGenerated: number;
  errorMessage?: string;
}

@Injectable()
export class CabinetBatchClosureService {
  constructor(
    private prisma: PrismaService,
    private walletService: CabinetWalletService,
  ) {}

  // ── Initialiser une clôture groupée ───────────────────────────────────────

  async initBatchClosure(
    cabinetId: string,
    month: number,
    year: number,
    companyIds?: string[], // si vide = toutes les PME du cabinet
  ) {
    // Récupérer les PME actives du cabinet
    const links = await this.prisma.cabinetCompany.findMany({
      where: {
        cabinetId,
        isActive: true,
        ...(companyIds?.length ? { companyId: { in: companyIds } } : {}),
      },
      include: {
        company: { select: { id: true, legalName: true, tradeName: true } },
      },
    });

    if (links.length === 0) {
      throw new NotFoundException('Aucune PME active trouvée pour ce cabinet');
    }

    // Vérifier que le cabinet a assez de bulletins
    const totalEmployees = await this.estimateTotalBulletins(
      links.map((l) => l.companyId),
    );

    const walletCheck = await this.walletService.canGenerateBulletin(cabinetId);
    if (!walletCheck.allowed) {
      throw new ForbiddenException(walletCheck.reason);
    }

    // Vérifier si une clôture existe déjà pour ce mois
    const existing = await this.prisma.cabinetBatchClosure.findFirst({
      where: { cabinetId, month, year, status: { in: ['PENDING', 'RUNNING'] } },
    });
    if (existing) {
      throw new ForbiddenException(
        `Une clôture est déjà en cours pour ${month}/${year}`,
      );
    }

    // Créer la clôture
    const batch = await this.prisma.cabinetBatchClosure.create({
      data: {
        cabinetId,
        month,
        year,
        totalCompanies: links.length,
        items: {
          create: links.map((link) => ({
            companyId: link.companyId,
            status: 'PENDING',
          })),
        },
      },
      include: { items: true },
    });

    return {
      batchId: batch.id,
      totalCompanies: links.length,
      estimatedBulletins: totalEmployees,
      companies: links.map((l) => ({
        companyId: l.companyId,
        companyName: l.company.tradeName ?? l.company.legalName,
      })),
    };
  }

  // ── Exécuter la clôture (appelé en arrière-plan) ──────────────────────────

  async executeBatchClosure(
    cabinetId: string,
    batchId: string,
  ): Promise<BatchProgress> {
    // Charger le batch avec month/year depuis la DB (sauvegardés à l'init)
    // Ne jamais utiliser new Date() — le mois choisi par l'user peut différer
    const batch = await this.prisma.cabinetBatchClosure.findUnique({
      where: { id: batchId },
      include: {
        items: {
          include: {
            company: { select: { id: true, legalName: true, tradeName: true } },
          },
        },
      },
    });

    if (!batch) throw new NotFoundException('Clôture introuvable');
    if (batch.cabinetId !== cabinetId)
      throw new ForbiddenException('Accès refusé');

    // Lire month/year depuis l'enregistrement DB — pas depuis new Date()
    const month = batch.month;
    const year = batch.year;

    // Marquer comme RUNNING
    await this.prisma.cabinetBatchClosure.update({
      where: { id: batchId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    const progress: BatchProgress = {
      batchId,
      status: 'RUNNING',
      totalCompanies: batch.totalCompanies,
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      currentCompany: null,
      items: batch.items.map((item) => ({
        companyId: item.companyId,
        companyName: item.company.tradeName ?? item.company.legalName,
        status: 'PENDING' as const,
        bulletinsGenerated: 0,
      })),
    };

    // Traiter chaque PME séquentiellement
    for (let i = 0; i < batch.items.length; i++) {
      const item = batch.items[i];
      const companyName = item.company.tradeName ?? item.company.legalName;

      progress.currentCompany = companyName;
      progress.items[i].status = 'RUNNING';

      await this.prisma.cabinetBatchClosureItem.update({
        where: { id: item.id },
        data: { status: 'RUNNING', processedAt: new Date() },
      });

      try {
        // Récupérer les employés actifs de cette PME
        const employees = await this.prisma.employee.findMany({
          where: { companyId: item.companyId, status: 'ACTIVE' },
          select: { id: true },
        });

        if (employees.length === 0) {
          await this.prisma.cabinetBatchClosureItem.update({
            where: { id: item.id },
            data: { status: 'SKIPPED', bulletinsGenerated: 0 },
          });
          progress.items[i].status = 'SKIPPED';
          progress.processedCount++;
          continue;
        }

        // Compter les payrolls DRAFT déjà saisis pour cette PME ce mois
        // La clôture valide UNIQUEMENT ce qui a été calculé via la page de saisie.
        // Si aucun bulletin n'a été calculé → SKIPPED avec message explicite.
        const draftCount = await this.prisma.payroll.count({
          where: { companyId: item.companyId, month, year, status: 'DRAFT' },
        });

        if (draftCount === 0) {
          // Vérifier si déjà tous validés ce mois (double clôture)
          const validatedCount = await this.prisma.payroll.count({
            where: {
              companyId: item.companyId,
              month,
              year,
              status: 'VALIDATED',
            },
          });
          const msg =
            validatedCount > 0
              ? `Déjà clôturée (${validatedCount} bulletins validés)`
              : 'Aucune variable saisie — allez sur Saisie variables pour calculer la paie';
          await this.prisma.cabinetBatchClosureItem.update({
            where: { id: item.id },
            data: { status: 'SKIPPED', errorMessage: msg },
          });
          progress.items[i].status = 'SKIPPED';
          progress.items[i].errorMessage = msg;
          progress.processedCount++;
          continue;
        }

        // Valider tous les bulletins DRAFT de cette PME pour ce mois
        const updated = await this.prisma.payroll.updateMany({
          where: { companyId: item.companyId, month, year, status: 'DRAFT' },
          data: { status: 'VALIDATED' },
        });

        // Débiter les bulletins du wallet cabinet
        const payrolls = await this.prisma.payroll.findMany({
          where: {
            companyId: item.companyId,
            month,
            year,
            status: 'VALIDATED',
          },
          select: { id: true },
          take: updated.count,
        });
        for (const p of payrolls) {
          await this.walletService
            .debitBulletin(cabinetId, item.companyId, p.id)
            .catch(() => null); // ne pas bloquer si le débit échoue
        }

        await this.prisma.cabinetBatchClosureItem.update({
          where: { id: item.id },
          data: { status: 'SUCCESS', bulletinsGenerated: updated.count },
        });

        progress.items[i].status = 'SUCCESS';
        progress.items[i].bulletinsGenerated = updated.count;
        progress.successCount++;
        progress.processedCount++;
      } catch (err: any) {
        await this.prisma.cabinetBatchClosureItem.update({
          where: { id: item.id },
          data: {
            status: 'FAILED',
            errorMessage: err.message ?? 'Erreur inconnue',
          },
        });
        progress.items[i].status = 'FAILED';
        progress.items[i].errorMessage = err.message ?? 'Erreur inconnue';
        progress.failedCount++;
        progress.processedCount++;
      }
    }

    // Finaliser
    const finalStatus =
      progress.failedCount === 0
        ? 'COMPLETED'
        : progress.successCount === 0
          ? 'FAILED'
          : 'PARTIAL';

    progress.status = finalStatus;
    progress.currentCompany = null;

    await this.prisma.cabinetBatchClosure.update({
      where: { id: batchId },
      data: {
        status: finalStatus as any,
        processedCount: progress.processedCount,
        successCount: progress.successCount,
        failedCount: progress.failedCount,
        completedAt: new Date(),
      },
    });

    return progress;
  }

  // ── Statut pour polling frontend ────────────────────────────────────────

  async getBatchStatus(
    cabinetId: string,
    batchId: string,
  ): Promise<BatchProgress> {
    const batch = await this.prisma.cabinetBatchClosure.findUnique({
      where: { id: batchId },
      include: {
        items: {
          include: {
            company: { select: { legalName: true, tradeName: true } },
          },
        },
      },
    });
    if (!batch) throw new NotFoundException('Clôture introuvable');
    if (batch.cabinetId !== cabinetId)
      throw new ForbiddenException('Accès refusé');
    return {
      batchId: batch.id,
      status: batch.status,
      totalCompanies: batch.totalCompanies,
      processedCount: batch.processedCount,
      successCount: batch.successCount,
      failedCount: batch.failedCount,
      currentCompany: null,
      items: batch.items.map((item) => ({
        companyId: item.companyId,
        companyName:
          (item.company as any).tradeName ?? (item.company as any).legalName,
        status: item.status,
        bulletinsGenerated: (item as any).bulletinsGenerated ?? 0,
        errorMessage: item.errorMessage ?? undefined,
      })),
    };
  }

  // ── Historique des clôtures ───────────────────────────────────────────────

  async getBatchHistory(cabinetId: string) {
    return this.prisma.cabinetBatchClosure.findMany({
      where: { cabinetId },
      orderBy: { createdAt: 'desc' },
      take: 24, // 2 ans
      include: {
        items: {
          include: {
            company: { select: { legalName: true, tradeName: true } },
          },
        },
      },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async estimateTotalBulletins(companyIds: string[]): Promise<number> {
    const counts = await this.prisma.employee.groupBy({
      by: ['companyId'],
      where: { companyId: { in: companyIds }, status: 'ACTIVE' },
      _count: true,
    });
    return counts.reduce((acc, c) => acc + c._count, 0);
  }
}
