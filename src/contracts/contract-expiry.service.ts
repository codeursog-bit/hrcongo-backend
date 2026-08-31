// ============================================================================
// 📁 src/contracts/contract-expiry.service.ts
// ✅ Logique DYNAMIQUE basée sur la durée totale du contrat
//    Ex: contrat 6 mois → alertes à 60%, 80%, 90% de la durée écoulée
//    puis SILENCE total une fois la date passée (sauf prolongation)
// ✅ Prolongation détectée → réinitialise les alertes
// ✅ Utilise NotificationsService existant
// ✅ Pas d'email, pas d'auth
//
// 🔧 Corrigé : le check "déjà notifié ?" puis la création n'étaient pas
//    atomiques. Si le backend tourne sur plusieurs instances/replicas
//    (Render en plusieurs dynos), chacune exécute sa propre copie du cron
//    et fait son check avant qu'aucune n'ait fini d'insérer → toutes
//    passent le test et créent chacune leur doublon, au même moment (voir
//    capture : 3 notifications identiques "J-61", même horodatage 09:00).
//    Un verrou consultatif Postgres (pg_advisory_xact_lock), scope à la
//    transaction et à l'employé, sérialise ça : la 2e/3e instance attend
//    que la 1re ait fini avant de faire son propre check.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { differenceInDays, startOfDay, addDays } from 'date-fns';
import { ContractType } from '@prisma/client';

// Types de contrats temporaires
const TEMP_CONTRACTS: ContractType[] = [
  ContractType.CDD,
  ContractType.STAGE,
  ContractType.INTERIM,
  ContractType.CONSULTANT,
  ContractType.PRESTATAIRE,
];

// Seuils fixes en jours (pour contrats longs > 90j)
const FIXED_THRESHOLDS = [60, 30, 7];

@Injectable()
export class ContractExpiryService {
  private readonly logger = new Logger(ContractExpiryService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  // ============================================================================
  // 🔁 MÉTHODE PRINCIPALE
  // ============================================================================

  async checkExpiringContracts(companyId?: string): Promise<void> {
    const today = startOfDay(new Date());

    const employees = await this.prisma.employee.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        status: 'ACTIVE',
        contractType: { in: TEMP_CONTRACTS },
        contractEndDate: {
          not: null,
          gte: today, // ← UNIQUEMENT les contrats pas encore expirés → SILENCE après
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
        position: true,
        contractType: true,
        contractEndDate: true,
        hireDate: true,
        companyId: true,
        department: { select: { name: true } },
        company: {
          select: {
            users: {
              where: {
                role: { in: ['ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'] },
                isActive: true,
              },
              select: { id: true },
            },
          },
        },
      },
    });

    this.logger.log(`🔍 ${employees.length} contrat(s) temporaire(s) actif(s) à vérifier`);

    for (const emp of employees) {
      await this.processEmployee(emp, today);
    }
  }

  // ============================================================================
  // 🧠 LOGIQUE PRINCIPALE PAR EMPLOYÉ
  // ============================================================================

  private async processEmployee(emp: any, today: Date): Promise<void> {
    const endDate    = startOfDay(new Date(emp.contractEndDate));
    const hireDate   = startOfDay(new Date(emp.hireDate));
    const totalDays  = differenceInDays(endDate, hireDate);   // durée totale du contrat
    const daysLeft   = differenceInDays(endDate, today);       // jours restants

    // Calculer les seuils d'alerte adaptés à la durée du contrat
    const thresholds = this.computeThresholds(totalDays);

    // Trouver quel seuil est atteint aujourd'hui (tolérance ±1j)
    const hitThreshold = thresholds.find(
      (t) => daysLeft >= t - 1 && daysLeft <= t + 1,
    );

    if (!hitThreshold) return;

    // ✅ Check "déjà notifié ?" + création de l'alerte dans UNE SEULE
    // transaction, protégée par un verrou consultatif Postgres scope à cet
    // employé. Élimine la race condition entre instances/replicas.
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `contract-expiry:${emp.id}`);

      const alreadyNotified = await this.hasNotifiedThisThreshold(tx, emp.id, hitThreshold, emp.contractEndDate);
      if (alreadyNotified) return;

      await this.sendAlert(tx, emp, daysLeft, hitThreshold, totalDays);
    });
  }

  // ============================================================================
  // 📐 CALCUL DYNAMIQUE DES SEUILS selon durée totale du contrat
  //
  //  Durée ≤ 30j  → alertes à J-7, J-3, J-1
  //  Durée ≤ 90j  → alertes à J-14, J-7, J-3
  //  Durée > 90j  → alertes fixes à J-60, J-30, J-7 (comme avant)
  // ============================================================================

  private computeThresholds(totalDays: number): number[] {
    if (totalDays <= 30) {
      // Contrat très court (stage 1 mois, intérim) → alertes rapprochées
      return [7, 3, 1];
    }
    if (totalDays <= 90) {
      // Contrat moyen (3 mois) → alertes intermédiaires
      return [14, 7, 3];
    }
    // Contrat long (6 mois, 1 an...) → seuils fixes standards
    return FIXED_THRESHOLDS;
  }

  // ============================================================================
  // 🔒 ANTI-DOUBLON INTELLIGENT
  // La clé inclut contractEndDate → si prolongation (nouvelle endDate),
  // les alertes repartent de zéro automatiquement
  // ⚠️ Prend désormais `tx` (client de transaction) au lieu de `this.prisma`
  // — doit s'exécuter DANS la même transaction que le verrou et la création,
  // sinon le verrou ne protège rien.
  // ============================================================================

  private async hasNotifiedThisThreshold(
    tx: any,
    employeeId: string,
    threshold: number,
    contractEndDate: Date,
  ): Promise<boolean> {
    const endDateStr = new Date(contractEndDate).toISOString().split('T')[0];

    const existing = await tx.notification.findFirst({
      where: {
        type: 'ATTENDANCE_ALERT',
        metadata: {
          path: ['employeeId'],
          equals: employeeId,
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });

    if (!existing) return false;

    const meta = existing.metadata as any;
    // Double vérification : même seuil ET même date de fin
    // Si la date a changé (prolongation) → false → nouvelles alertes
    return (
      meta?.threshold === threshold &&
      meta?.contractEndDate?.split('T')[0] === endDateStr
    );
  }

  // ============================================================================
  // 🔔 ENVOYER L'ALERTE
  // ⚠️ Utilise `tx.notification.create(...)` directement (pas
  // notificationsService.create()) pour rester DANS la transaction verrouillée
  // — appeler le service passerait par sa propre connexion Prisma, hors
  // transaction, et le verrou ne protégerait plus rien.
  // ============================================================================

  private async sendAlert(
    tx: any,
    emp: any,
    daysLeft: number,
    threshold: number,
    totalDays: number,
  ): Promise<void> {
    const endDate = new Date(emp.contractEndDate);
    const urgencyEmoji = threshold <= 7 ? '🔴' : threshold <= 14 ? '🟠' : '🟡';
    const contractLabel = this.contractLabel(emp.contractType);
    const endDateFormatted = endDate.toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    // Calcul pourcentage de la période écoulée (info contexte)
    const elapsed = totalDays - daysLeft;
    const pctElapsed = Math.round((elapsed / totalDays) * 100);

    const title = `${urgencyEmoji} ${contractLabel} expirant — ${emp.firstName} ${emp.lastName}`;
    const message = `Le contrat de ${emp.firstName} ${emp.lastName} (${emp.employeeNumber}${emp.department?.name ? ` · ${emp.department.name}` : ''}) expire dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}, le ${endDateFormatted}. Durée totale : ${totalDays}j (${pctElapsed}% écoulé).`;

    const metadata = {
      employeeId: emp.id,
      threshold,
      daysLeft,
      totalDays,
      contractEndDate: emp.contractEndDate, // ← clé anti-doublon prolongation
      contractType: emp.contractType,
      notificationType: 'CONTRACT_EXPIRY',
    };

    if (emp.company.users.length > 0) {
      await tx.notification.createMany({
        data: emp.company.users.map((adminUser: { id: string }) => ({
          userId: adminUser.id,
          type: 'ATTENDANCE_ALERT' as const,
          title,
          message,
          link: `/employes/${emp.id}`,
          metadata,
          read: false,
        })),
      });
    }

    this.logger.log(
      `✅ Alerte J-${threshold} envoyée — ${emp.firstName} ${emp.lastName} (${emp.contractType}, ${totalDays}j total, expire le ${endDate.toISOString().split('T')[0]})`,
    );
  }

  // ============================================================================
  // 📊 LISTE POUR LE DASHBOARD (lecture seule, sans notifier)
  // ============================================================================

  async getExpiringList(companyId: string) {
    const today = startOfDay(new Date());

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        contractType: { in: TEMP_CONTRACTS },
        contractEndDate: {
          not: null,
          gte: today, // Uniquement contrats pas encore expirés
          lte: addDays(today, 92), // Max ~3 mois dans le futur
        },
      },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        position: true,
        contractType: true,
        contractEndDate: true,
        hireDate: true,
        department: { select: { name: true } },
      },
      orderBy: { contractEndDate: 'asc' },
    });

    return employees.map((emp) => {
      const endDate   = startOfDay(new Date(emp.contractEndDate!));
      const hireDate  = startOfDay(new Date(emp.hireDate));
      const totalDays = differenceInDays(endDate, hireDate);
      const daysLeft  = differenceInDays(endDate, today);
      const pctElapsed = Math.round(((totalDays - daysLeft) / totalDays) * 100);

      return {
        ...emp,
        daysLeft,
        totalDays,
        pctElapsed,
        urgency:
          daysLeft <= 7  ? 'CRITICAL'
          : daysLeft <= 14 ? 'HIGH'
          : daysLeft <= 30 ? 'MEDIUM'
          : 'LOW',
      };
    });
  }

  // ─── Helper ────────────────────────────────────────────────────────────────
  private contractLabel(type: string): string {
    return (
      {
        CDD: 'CDD',
        STAGE: 'Stage',
        INTERIM: 'Intérim',
        CONSULTANT: 'Consultant',
        PRESTATAIRE: 'Prestataire',
      }[type] ?? 'Contrat'
    );
  }
}