// ============================================================================
// 📁 src/leaves/leaves-balance.service.ts
// ✅ Extrait de l'ancien leaves.service.ts monolithique (découpage Phase 7).
// ✅ Tout ce qui concerne le SOLDE et le CYCLE D'ACQUISITION d'un employé :
//    calcul/création du solde courant, éligibilité, migration (reprise du
//    solde via le dernier congé connu), ajustement manuel, "mon solde",
//    tendance annuelle. Le moteur cycle-based est décrit en détail dans les
//    docblocks de chaque méthode ci-dessous (inchangés depuis l'original).
// ============================================================================

import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeNotFoundException } from '../exceptions/business.exceptions';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '@prisma/client';
import * as WorkingDays from '../common/working-days.util';
import { getSeniorityDaysForConvention } from './config/leave-seniority-conventions';
import {
  getUserWithCompany,
  getManagerDepartmentId,
  resolveCycleWindow,
  isLeaveEligibleContract,
} from './leaves-common.util';
import { CONGO_LEAVE } from './leaves.constants';
import { LeavesIndemnityService } from './leaves-indemnity.service';

@Injectable()
export class LeavesBalanceService {
  private readonly logger = new Logger(LeavesBalanceService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private indemnityService: LeavesIndemnityService,
  ) {}

  // ============================================================================
  // 🎫 ÉLIGIBILITÉ — stagiaires : jamais de congé ; prestataires/consultants :
  // seulement si l'entreprise l'a activé (Company.leaveAppliesToContractors).
  // ============================================================================
  async getLeaveEligibility(employeeId: string): Promise<{
    eligible: boolean;
    reason: 'STAGIAIRE' | 'PRESTATAIRE' | null;
  }> {
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        contractType: true,
        company: { select: { leaveAppliesToContractors: true } },
      },
    });
    if (!emp) throw new EmployeeNotFoundException(employeeId);
    const eligible = isLeaveEligibleContract(
      emp.contractType as string,
      !!emp.company?.leaveAppliesToContractors,
    );
    return {
      eligible,
      reason: eligible
        ? null
        : emp.contractType === 'STAGE'
          ? 'STAGIAIRE'
          : 'PRESTATAIRE',
    };
  }

  /**
   * Éligibilité de l'utilisateur connecté (menu "Mes congés", tableau de bord).
   * Un utilisateur sans fiche employé (ex: admin pur) n'est jamais restreint.
   */
  async getMyLeaveEligibility(userId: string) {
    const user = await getUserWithCompany(this.prisma, userId);
    const employee = await this.prisma.employee.findFirst({
      where: { email: user.email ?? undefined, companyId: user.companyId },
      select: { id: true },
    });
    if (!employee) return { eligible: true, reason: null };
    return this.getLeaveEligibility(employee.id);
  }

  async assertLeaveEligible(employeeId: string): Promise<void> {
    const { eligible, reason } = await this.getLeaveEligibility(employeeId);
    if (eligible) return;
    throw new BadRequestException(
      reason === 'STAGIAIRE'
        ? "Les stagiaires n'ont pas droit aux congés."
        : "Les prestataires ne bénéficient pas de congés dans cette entreprise (option désactivée dans les paramètres).",
    );
  }

  // ============================================================================
  // ✅ CORRECTIF (bug récurrent trouvé à plusieurs endroits : bulletins,
  //    simulation paie manuelle, vérification de solde à la création d'un
  //    congé...) — toutes ces lectures ne prenaient que le cycle LE PLUS
  //    RÉCENT (`findFirst` trié desc), exactement le même bug que celui
  //    déjà corrigé sur la page Provision. Un employé qui n'a pas pris
  //    congé depuis plusieurs cycles a plusieurs lignes LeaveBalance non
  //    soldées en base — son vrai solde total est leur SOMME, pas
  //    seulement la plus récente. Ce helper centralise le bon calcul, à
  //    réutiliser partout où un solde "vrai" doit être affiché ou figé
  //    (snapshot de bulletin, simulation, vérification avant congé...).
  // ============================================================================
  async getTotalLeaveBalanceSummary(employeeId: string) {
    await this.applyDueLeaveDebits(employeeId).catch(() => 0);
    // Inéligible (stagiaire / prestataire sans option) : aucun solde, et
    // surtout aucune ligne LeaveBalance créée au passage.
    if (!(await this.getLeaveEligibility(employeeId)).eligible) {
      return {
        annualEntitled: 0,
        annualTaken: 0,
        annualRemaining: 0,
        seniorityDays: 0,
        carriedForward: 0,
        cyclesCount: 0,
        cycleEndDate: null,
        canTakeAnnualLeave: false,
      };
    }
    // S'assure que le cycle actuellement ouvert existe/est à jour avant de sommer.
    await this.getOrCreateLeaveBalance(employeeId).catch(() => null);

    const rows = await this.prisma.leaveBalance.findMany({
      where: { employeeId },
    });

    const annualEntitled = rows.reduce((s, r) => s + Number(r.annualEntitled), 0);
    const annualTaken = rows.reduce((s, r) => s + Number(r.annualTaken), 0);
    const annualRemaining = rows.reduce((s, r) => s + Number(r.annualRemaining), 0);
    const seniorityDays = rows.reduce((s, r) => s + Number(r.seniorityDays || 0), 0);
    const carriedForward = rows.reduce((s, r) => s + Number(r.carriedForward || 0), 0);
    // Cycle le plus récent — utile pour l'affichage de la date de fin de cycle en cours.
    const latest = [...rows].sort(
      (a, b) =>
        (b.cycleStartDate ? new Date(b.cycleStartDate).getTime() : 0) -
        (a.cycleStartDate ? new Date(a.cycleStartDate).getTime() : 0),
    )[0];

    return {
      annualEntitled: Math.round(annualEntitled * 10) / 10,
      annualTaken: Math.round(annualTaken * 10) / 10,
      annualRemaining: Math.round(annualRemaining * 10) / 10,
      seniorityDays: Math.round(seniorityDays * 10) / 10,
      carriedForward: Math.round(carriedForward * 10) / 10,
      cyclesCount: rows.length,
      cycleEndDate: latest?.cycleEndDate ?? null,
      canTakeAnnualLeave: !!latest && annualEntitled > 0,
    };
  }

  /**
   * Solde de congé annuel — moteur basé sur le CYCLE D'ACQUISITION propre à
   * chaque employé (12 mois glissants depuis l'embauche ou le dernier retour
   * de congé Annuel), et non plus sur l'année calendaire.
   *
   * ✅ Un cycle est autonome : il démarre à 0, accumule jusqu'à 26j (+ jours
   *    d'ancienneté éventuels) sur ses 12 mois, et se clôture quand l'employé
   *    part effectivement en congé Annuel (pas Anticipé). Pas de report
   *    calendaire type "31 décembre" — la notion n'existe plus, elle est
   *    remplacée par la clôture naturelle du cycle.
   * ✅ La création automatique ne concerne que le cycle actuellement OUVERT.
   *    Un cycle déjà clos et déjà en base est lu tel quel, jamais recréé.
   * ✅ Le plafond de cumul sur plusieurs cycles non pris (ex. un employé qui
   *    n'est pas parti en congé depuis 5 ans) est un cas à part, volontairement
   *    laissé de côté pour l'instant (Phase 8 du plan : plafond légal de repos
   *    physique) — ce moteur gère un cycle à la fois.
   *
   * @param referenceDate Date à laquelle évaluer le solde — "maintenant" par
   *   défaut. Utile pour retrouver le solde tel qu'il était à une date passée
   *   dans le cycle actuel (n'a pas d'effet sur la recherche du cycle
   *   lui-même, qui est toujours le cycle en cours de l'employé).
   */
  async getOrCreateLeaveBalance(
    employeeId: string,
    referenceDate: Date = new Date(),
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        hireDate: true,
        leaveCycleStartDate: true,
        companyId: true,
        firstName: true,
        lastName: true,
        company: {
          select: {
            appliesSeniorityLeaveBonus: true,
            leaveConventionKey: true,
            leaveCycleMode: true,
          },
        },
      },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);

    const { cycleStartDate, cycleEndDate } = resolveCycleWindow(
      new Date(employee.hireDate),
      employee.leaveCycleStartDate
        ? new Date(employee.leaveCycleStartDate)
        : null,
      // ✅ résout le MÊME cycle que celui demandé par l'appelant (ex: un cycle
      //    futur, 09/08/2026), au lieu de toujours retomber sur le cycle
      //    ouvert aujourd'hui. Rétrocompatible : referenceDate vaut déjà
      //    `new Date()` par défaut pour tous les appels existants qui ne le
      //    précisent pas, donc leur comportement est inchangé.
      referenceDate,
      (employee.company?.leaveCycleMode as 'ROLLING' | 'ANNIVERSARY') ??
        'ROLLING',
    );

    let balance = await this.prisma.leaveBalance.findUnique({
      where: { employeeId_cycleStartDate: { employeeId, cycleStartDate } },
    });

    if (!balance) {
      const effectiveNow =
        referenceDate < cycleEndDate ? referenceDate : cycleEndDate;
      const msElapsed = Math.max(
        0,
        effectiveNow.getTime() - cycleStartDate.getTime(),
      );
      const monthsElapsed = Math.min(
        12,
        msElapsed / (1000 * 60 * 60 * 24 * 30.44),
      );

      const baseAcquired = Math.min(
        CONGO_LEAVE.ANNUAL_DAYS,
        Math.floor(monthsElapsed * CONGO_LEAVE.MONTHLY_RATE * 10) / 10,
      );

      const appliesBonus = employee.company?.appliesSeniorityLeaveBonus ?? true;
      const conventionKey = employee.company?.leaveConventionKey ?? 'GENERALE';
      const yearsWorked =
        (cycleStartDate.getTime() - new Date(employee.hireDate).getTime()) /
        (1000 * 60 * 60 * 24 * 365.25);
      // ✅ CORRECTIF : les jours d'ancienneté sont accordés EN BLOC dès la
      // création du cycle, pas au prorata de `monthsElapsed` comme avant.
      // L'ancienneté est connue à l'avance (elle ne dépend que de la date
      // d'embauche, pas du temps déjà passé dans le cycle en cours) —
      // contrairement aux 26j de base qui, eux, continuent de s'accumuler
      // mois par mois (moteur légal interne, notamment pour le prorata en
      // cas de rupture avant la fin du cycle).
      // ⚠️ Ça corrige au passage un bug latent : si cette ligne de solde
      // était créée tôt dans un cycle (ex: premier accès à "mon solde" en
      // tout début de cycle), `monthsElapsed` valait ~0 et figeait
      // `seniorityDays` à ~0 pour tout le cycle — le cron mensuel
      // n'incrémente jamais ce champ après coup, seulement la base 26j.
      const seniorityDays = appliesBonus
        ? getSeniorityDaysForConvention(conventionKey, Math.max(0, yearsWorked))
        : 0;

      // ✅ baseAcquired et seniorityDays sont chacun déjà arrondis à 1
      // décimale, mais leur SOMME peut retomber sur un artefact de virgule
      // flottante binaire (ex: 26 + 2.8 = 28.799999999999997) — on arrondit
      // le total pour que ce qui remonte au front (et aux exports xlsx/docx)
      // soit toujours propre.
      const totalEntitled =
        Math.round((baseAcquired + seniorityDays) * 10) / 10;

      const cyclesCount = await this.prisma.leaveBalance.count({
        where: { employeeId },
      });

      // ✅ CORRECTIF (bug "programme des départs futurs") : si le cycle
      // calculé n'a pas encore réellement commencé (cas typique : un congé
      // Annuel vient d'être approuvé avec une date de retour future — voir
      // updateStatus() — donc `leaveCycleStartDate` pointe déjà sur ce futur
      // cycle), on NE PERSISTE PAS de ligne LeaveBalance ici. On renvoie un
      // solde calculé à la volée (0j si referenceDate = "maintenant", ou le
      // solde complet si referenceDate est une date de projection future,
      // ex: /leaves/departure-program qui interroge un cycle 2027).
      // Sans ce garde-fou, la première consultation AVANT le vrai début du
      // cycle (ex: la page "Solde" de l'employé consultée pendant qu'il est
      // encore en congé) fige en base annualEntitled=0/annualRemaining=0
      // pour de bon — la ligne existe déjà, donc plus jamais recalculée,
      // et l'employé disparaît silencieusement de tout calcul futur
      // (planning théorique, alertes...) qui se base sur ce solde.
      const realNow = new Date();
      if (realNow < cycleStartDate) {
        return {
          id: `virtual-${employeeId}-${cycleStartDate.toISOString()}`,
          employeeId,
          year: cycleStartDate.getFullYear(),
          cycleNumber: cyclesCount + 1,
          cycleStartDate,
          cycleEndDate,
          annualEntitled: totalEntitled,
          annualTaken: 0,
          annualRemaining: totalEntitled,
          seniorityDays,
          carriedForward: 0,
          adjustmentNote: null,
          lastCalculated: realNow,
        } as any;
      }

      balance = await this.prisma.leaveBalance.create({
        data: {
          employeeId,
          year: cycleStartDate.getFullYear(),
          cycleNumber: cyclesCount + 1,
          cycleStartDate,
          cycleEndDate,
          annualEntitled: totalEntitled,
          annualTaken: 0,
          annualRemaining: totalEntitled,
          seniorityDays,
          carriedForward: 0,
        },
      });

      this.logger.log(
        `✅ Cycle #${balance.cycleNumber} créé pour ${employee.firstName} ${employee.lastName} ` +
          `(${cycleStartDate.toISOString().slice(0, 10)} → ${cycleEndDate.toISOString().slice(0, 10)}): ` +
          `${totalEntitled}j (base: ${baseAcquired}j + ancienneté: ${seniorityDays}j)`,
      );
    }

    return balance;
  }

  /**
   * 🆕 Date de référence du cycle à DÉBITER pour un départ en congé Annuel.
   *
   * Règle métier : un congé Annuel clôt le cycle qu'on vient de TRAVAILLER.
   * Un départ à la date anniversaire, juste après (ex: jour férié → premier
   * jour ouvré) ou reporté (besoin de l'entreprise) reste donc imputé sur le
   * cycle qui s'est terminé à l'anniversaire, tant que ce cycle n'a pas
   * encore été consommé par un congé Annuel. Reporter ne déplace jamais le
   * cycle ni son droit (26j + ancienneté).
   *
   * Renvoie `departureDate` inchangée quand la règle ne s'applique pas
   * (congé anticipé, 1er cycle de l'employé, cycle précédent déjà soldé).
   * Sinon renvoie la FIN du cycle précédent, qui se résout exactement sur ce
   * cycle via resolveCycleWindow() (`cycleEndDate < referenceDate` strict).
   */
  async resolveDebitReferenceDate(
    employeeId: string,
    departureDate: Date,
    leaveType: string = 'ANNUAL',
    excludeLeaveId?: string,
  ): Promise<Date> {
    if (leaveType === 'ANNUAL_ANTICIPATED') return departureDate;

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        hireDate: true,
        leaveCycleStartDate: true,
        company: { select: { leaveCycleMode: true } },
      },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);

    const mode =
      (employee.company?.leaveCycleMode as 'ROLLING' | 'ANNIVERSARY') ??
      'ROLLING';
    const hire = new Date(employee.hireDate);
    const leaveCycleStart = employee.leaveCycleStartDate
      ? new Date(employee.leaveCycleStartDate)
      : null;
    const chainStart = mode === 'ANNIVERSARY' ? hire : (leaveCycleStart ?? hire);

    const current = resolveCycleWindow(
      hire,
      leaveCycleStart,
      departureDate,
      mode,
    );
    // 1er cycle : il n'existe pas de cycle précédent à clore.
    if (current.cycleStartDate.getTime() <= chainStart.getTime()) {
      return departureDate;
    }

    // Cycle précédent = fenêtre qui se termine pile au début de l'actuelle.
    const previous = resolveCycleWindow(
      hire,
      leaveCycleStart,
      current.cycleStartDate,
      mode,
    );
    if (previous.cycleEndDate.getTime() !== current.cycleStartDate.getTime()) {
      return departureDate;
    }

    const alreadyClosed = await this.prisma.leave.findFirst({
      where: {
        employeeId,
        type: 'ANNUAL',
        status: { in: ['APPROVED'] },
        carriedFromLeaveId: null,
        debitedCycleStartDate: previous.cycleStartDate,
        ...(excludeLeaveId ? { id: { not: excludeLeaveId } } : {}),
      },
      select: { id: true },
    });
    return alreadyClosed ? departureDate : previous.cycleEndDate;
  }

  /**
   * 🆕 DÉBIT DIFFÉRÉ DU SOLDE — règle métier : planifier un congé à l'avance
   * ne touche PAS au solde. Le solde continue de s'incrémenter chaque mois
   * (2,16 j) et ne retombe qu'à la DATE DE DÉPART du congé planifié.
   *
   * Applique, pour chaque congé Annuel/Anticipé validé dont le départ est
   * arrivé et qui n'a pas encore été débité (Leave.balanceDebitedAt = null) :
   *  - le débit du solde (cycle re-résolu à la date de départ — exact même si
   *    le cycle a bougé depuis la planification, notamment en mode ROLLING) ;
   *  - la fermeture du cycle ROLLING (leaveCycleStartDate = fin du congé),
   *    qui n'est plus avancée dès la planification.
   * Idempotent et sûr en multi-instances : le congé est "réservé" par un
   * updateMany conditionnel avant toute écriture.
   * @param employeeId limite le traitement à un employé (appels paresseux).
   */
  async applyDueLeaveDebits(employeeId?: string): Promise<number> {
    const due = await this.prisma.leave.findMany({
      where: {
        status: 'APPROVED',
        type: { in: ['ANNUAL', 'ANNUAL_ANTICIPATED'] },
        carriedFromLeaveId: null,
        balanceDebitedAt: null,
        startDate: { lte: new Date() },
        ...(employeeId ? { employeeId } : {}),
      },
      orderBy: { startDate: 'asc' },
    });

    let applied = 0;
    for (const leave of due) {
      const claim = await this.prisma.leave.updateMany({
        where: { id: leave.id, balanceDebitedAt: null },
        data: { balanceDebitedAt: new Date() },
      });
      if (claim.count !== 1) continue; // une autre instance l'a déjà pris

      try {
        const ref = await this.resolveDebitReferenceDate(
          leave.employeeId,
          leave.startDate,
          leave.type,
          leave.id,
        );
        const balance = await this.ensureBalanceRowForDebit(
          leave.employeeId,
          ref,
        );
        await this.prisma.leaveBalance.update({
          where: { id: balance.id },
          data: {
            annualTaken: { increment: leave.daysCount },
            annualRemaining: { decrement: leave.daysCount },
          },
        });
        await this.prisma.leave.update({
          where: { id: leave.id },
          data: { debitedCycleStartDate: balance.cycleStartDate },
        });
        if (leave.type === 'ANNUAL') {
          await this.prisma.employee.update({
            where: { id: leave.employeeId },
            data: { leaveCycleStartDate: leave.endDate },
          });
        }
        applied++;
      } catch (err: any) {
        // On libère la réservation : le prochain passage réessaiera.
        await this.prisma.leave
          .update({ where: { id: leave.id }, data: { balanceDebitedAt: null } })
          .catch(() => null);
        this.logger.error(
          `❌ Débit différé du congé ${leave.id} impossible : ${err?.message ?? err}`,
        );
      }
    }
    return applied;
  }

  /**
   * 🆕 Ligne LeaveBalance RÉELLE à débiter pour une planification/validation.
   * getOrCreateLeaveBalance() renvoie un solde "virtuel" (id `virtual-…`,
   * non persisté) pour un cycle qui n'a pas encore commencé — impossible à
   * décrémenter. Ici on le persiste avec le droit COMPLET du cycle (calculé
   * à sa date de fin), pas le droit proratisé d'aujourd'hui : ainsi la ligne
   * n'est jamais figée à 0j (voir le commentaire de getOrCreateLeaveBalance).
   */
  async ensureBalanceRowForDebit(employeeId: string, referenceDate: Date) {
    const balance = await this.getOrCreateLeaveBalance(
      employeeId,
      referenceDate,
    );
    if (!String(balance.id).startsWith('virtual-')) return balance;

    const full = await this.getOrCreateLeaveBalance(
      employeeId,
      new Date(balance.cycleEndDate),
    );
    const existing = await this.prisma.leaveBalance.findUnique({
      where: {
        employeeId_cycleStartDate: {
          employeeId,
          cycleStartDate: full.cycleStartDate,
        },
      },
    });
    if (existing) return existing;
    return this.prisma.leaveBalance.create({
      data: {
        employeeId,
        year: full.year,
        cycleNumber: full.cycleNumber,
        cycleStartDate: full.cycleStartDate,
        cycleEndDate: full.cycleEndDate,
        annualEntitled: full.annualEntitled,
        annualTaken: 0,
        annualRemaining: full.annualRemaining,
        seniorityDays: full.seniorityDays,
        carriedForward: 0,
      },
    });
  }

  /**
   * Projette le solde d'un employé TEL QU'IL SERA à une date future donnée
   * (asOfDate), sur le cycle auquel cette date appartient — au lieu du solde
   * accumulé "aujourd'hui" que renvoie getOrCreateLeaveBalance() par défaut.
   *
   * ✅ Sert à valider une PLANIFICATION faite à l'avance (ex: le RH pose en
   *    janvier un congé prévu en octobre) : à la date du départ, l'employé
   *    aura accumulé plus de jours qu'au moment où on planifie — comparer au
   *    solde du jour de la planification bloque à tort des plannings
   *    pourtant parfaitement valides.
   *
   * ⚠️ Ne couvre que le cycle actuellement ouvert, ou un cycle futur déjà
   *    persisté en base (ex: un autre congé y a déjà été planifié). Un cycle
   *    qui n'a pas encore démarré dans la réalité ET n'existe pas encore en
   *    base a une date de début elle-même spéculative — elle dépend du
   *    retour de congé (pas encore survenu) qui clôturera le cycle actuel.
   *    Dans ce cas `reliable` vaut false : à l'appelant de refuser la
   *    planification avec un message clair plutôt que de faire confiance à
   *    une date de cycle non garantie.
   */
  async getProjectedBalanceAsOf(
    employeeId: string,
    departureDate: Date,
    leaveType: string = 'ANNUAL',
  ) {
    // 🆕 Un départ posé APRÈS la date anniversaire (ex: 04/01/2027 pour un
    // cycle clos le 01/01/2027, ou un congé reporté) consomme le droit du
    // cycle qui vient de se fermer — pas celui du cycle suivant, qui est
    // encore vide. `asOfDate` = date de référence du cycle débité.
    const asOfDate = await this.resolveDebitReferenceDate(
      employeeId,
      departureDate,
      leaveType,
    );
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        hireDate: true,
        leaveCycleStartDate: true,
        company: {
          select: {
            appliesSeniorityLeaveBonus: true,
            leaveConventionKey: true,
            leaveCycleMode: true,
          },
        },
      },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);

    const { cycleStartDate, cycleEndDate } = resolveCycleWindow(
      new Date(employee.hireDate),
      employee.leaveCycleStartDate
        ? new Date(employee.leaveCycleStartDate)
        : null,
      asOfDate,
      (employee.company?.leaveCycleMode as 'ROLLING' | 'ANNIVERSARY') ??
        'ROLLING',
    );

    const existing = await this.prisma.leaveBalance.findUnique({
      where: { employeeId_cycleStartDate: { employeeId, cycleStartDate } },
    });

    const realNow = new Date();
    // 🆕 PLANIFICATION À L'AVANCE (ANNIVERSARY *et* ROLLING) : on ne bloque
    // plus un cycle qui n'a pas encore démarré. Planifier ne modifie NI le
    // solde NI le cycle ouvert (débit et fermeture du cycle ROLLING sont
    // différés à la date de départ — voir applyDueLeaveDebits) ; le cycle
    // réellement débité est re-résolu à ce moment-là. Le seul refus restant
    // est une date de départ antérieure à l'embauche (donnée aberrante).
    if (departureDate < new Date(employee.hireDate)) {
      return {
        reliable: false as const,
        debitReferenceDate: asOfDate,
        cycleStartDate,
        cycleEndDate,
        reason:
          "La date de départ est antérieure à la date d'embauche de l'employé.",
      };
    }

    // Cycle pas encore démarré dans la réalité : on projette le droit
    // COMPLET (un congé planifié sur un cycle futur se prend à sa clôture).
    const effectiveNow =
      realNow < cycleStartDate
        ? cycleEndDate
        : asOfDate < cycleEndDate
          ? asOfDate
          : cycleEndDate;
    const msElapsed = Math.max(
      0,
      effectiveNow.getTime() - cycleStartDate.getTime(),
    );
    const monthsElapsed = Math.min(
      12,
      msElapsed / (1000 * 60 * 60 * 24 * 30.44),
    );

    const baseAcquired = Math.min(
      CONGO_LEAVE.ANNUAL_DAYS,
      Math.floor(monthsElapsed * CONGO_LEAVE.MONTHLY_RATE * 10) / 10,
    );

    const appliesBonus = employee.company?.appliesSeniorityLeaveBonus ?? true;
    const conventionKey = employee.company?.leaveConventionKey ?? 'GENERALE';
    const yearsWorked =
      (cycleStartDate.getTime() - new Date(employee.hireDate).getTime()) /
      (1000 * 60 * 60 * 24 * 365.25);
    // ✅ Même correctif que getOrCreateLeaveBalance() : ancienneté en bloc,
    // pas proratée sur monthsElapsed (voir commentaire là-bas).
    const seniorityDays = appliesBonus
      ? getSeniorityDaysForConvention(conventionKey, Math.max(0, yearsWorked))
      : 0;

    const totalEntitled =
      Math.round((baseAcquired + seniorityDays) * 10) / 10;
    const annualTaken = existing ? Number(existing.annualTaken) : 0;

    return {
      reliable: true as const,
      // Date à repasser à ensureBalanceRowForDebit() pour débiter ce cycle.
      debitReferenceDate: asOfDate,
      cycleStartDate,
      cycleEndDate,
      totalEntitled,
      // ✅ AJOUT (planification) : exposé pour répartir base/ancienneté.
      seniorityDays,
      annualTaken,
      projectedRemaining: Math.round((totalEntitled - annualTaken) * 10) / 10,
    };
  }

  /**
   * 🆕 SYNCHRO DATE D'EMBAUCHE → CYCLES DE CONGÉ.
   * À appeler par le service employés APRÈS une modification de `hireDate`
   * (le cycle et le solde se comptent depuis l'embauche : 1er cycle surtout).
   *
   * - Supprime les lignes LeaveBalance DÉRIVÉES de l'ancienne date et non
   *   consommées (annualTaken = 0, aucun congé n'y est imputé, ni reliquat,
   *   ni ajustement manuel) : elles sont recréées à la demande, à la bonne
   *   date, par getOrCreateLeaveBalance().
   * - Ne touche JAMAIS un cycle déjà débité ni un congé planifié/validé :
   *   ils sont renvoyés dans `warnings` pour que le RH les revoie (aucun
   *   déplacement silencieux).
   * - Renvoie le prochain départ théorique ("prévu") recalculé.
   */
  async syncAfterHireDateChange(employeeId: string, oldHireDate: Date) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        hireDate: true,
        leaveCycleStartDate: true,
        company: { select: { leaveCycleMode: true } },
      },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);

    const newHire = new Date(employee.hireDate);
    if (newHire.getTime() === new Date(oldHireDate).getTime()) {
      return { changed: false as const, resetCycles: 0, warnings: [] };
    }

    // ROLLING : un cycle ancré sur l'ancienne embauche (aucun congé pris
    // depuis) doit suivre la nouvelle date ; un cycle ancré sur un vrai
    // retour de congé ne bouge pas.
    if (
      employee.leaveCycleStartDate &&
      new Date(employee.leaveCycleStartDate).getTime() ===
        new Date(oldHireDate).getTime()
    ) {
      await this.prisma.employee.update({
        where: { id: employeeId },
        data: { leaveCycleStartDate: newHire },
      });
    }

    const rows = await this.prisma.leaveBalance.findMany({
      where: { employeeId },
    });
    const taken = await this.prisma.leave.findMany({
      where: {
        employeeId,
        type: 'ANNUAL',
        status: { in: ['APPROVED', 'PENDING'] as any },
        debitedCycleStartDate: { not: null },
      },
      select: { debitedCycleStartDate: true },
    });
    const debited = new Set(
      taken.map((l) => new Date(l.debitedCycleStartDate as Date).getTime()),
    );

    const resettable = rows.filter(
      (r) =>
        Number(r.annualTaken) === 0 &&
        Number(r.carriedForward || 0) === 0 &&
        !(r as any).adjustmentNote &&
        !debited.has(new Date(r.cycleStartDate as Date).getTime()),
    );
    if (resettable.length) {
      await this.prisma.leaveBalance.deleteMany({
        where: { id: { in: resettable.map((r) => r.id) } },
      });
    }

    // Congés déjà planifiés/validés/en attente non terminés : à revoir.
    const pending = await this.prisma.leave.findMany({
      where: {
        employeeId,
        type: { in: ['ANNUAL', 'ANNUAL_ANTICIPATED'] as any },
        status: { in: ['APPROVED', 'PENDING'] as any },
        endDate: { gte: new Date() },
      },
      select: { id: true, startDate: true, endDate: true, status: true },
      orderBy: { startDate: 'asc' },
    });

    const mode =
      (employee.company?.leaveCycleMode as 'ROLLING' | 'ANNIVERSARY') ??
      'ROLLING';
    const { cycleEndDate } = resolveCycleWindow(
      newHire,
      employee.leaveCycleStartDate && mode === 'ROLLING'
        ? new Date(employee.leaveCycleStartDate)
        : null,
      new Date(),
      mode,
    );

    return {
      changed: true as const,
      resetCycles: resettable.length,
      expectedNextDeparture: cycleEndDate,
      warnings: pending.map((l) => ({
        leaveId: l.id,
        status: l.status,
        startDate: l.startDate,
        endDate: l.endDate,
        message:
          "La date d'embauche a changé : ce congé a été planifié avec l'ancien calendrier, vérifiez sa date de départ.",
      })),
    };
  }

  /**
   * Combine le solde (LeaveBalance) et l'éligibilité (mois travaillés, congé
   * annuel accessible ou non) pour un employé donné.
   */
  async getEmployeeBalanceDetails(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        hireDate: true,
        leaveCycleStartDate: true,
        company: { select: { leaveCycleMode: true } },
      },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);

    // Débits différés dont le départ est arrivé : appliqués avant lecture.
    await this.applyDueLeaveDebits(employeeId).catch(() => 0);
    const balance = await this.getOrCreateLeaveBalance(employeeId);

    const { cycleStartDate, cycleEndDate } = resolveCycleWindow(
      new Date(employee.hireDate),
      employee.leaveCycleStartDate
        ? new Date(employee.leaveCycleStartDate)
        : null,
      undefined,
      (employee.company?.leaveCycleMode as 'ROLLING' | 'ANNIVERSARY') ??
        'ROLLING',
    );
    const now = new Date();
    const monthsWorked =
      (now.getTime() - cycleStartDate.getTime()) /
      (1000 * 60 * 60 * 24 * 30.44);

    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    const daysUntilAccrual = daysInMonth - dayOfMonth + 1;

    return {
      ...balance,
      monthlyRate: CONGO_LEAVE.MONTHLY_RATE,
      annualMax: CONGO_LEAVE.ANNUAL_DAYS,
      cycleStartDate,
      cycleEndDate,
      monthsWorked: Math.floor(monthsWorked),
      canTakeAnnualLeave: monthsWorked >= CONGO_LEAVE.MIN_MONTHS_BEFORE_LEAVE,
      monthsUntilEligible: Math.max(
        0,
        Math.ceil(CONGO_LEAVE.MIN_MONTHS_BEFORE_LEAVE - monthsWorked),
      ),
      daysUntilNextAccrual: daysUntilAccrual,
      isNearCumulLimit:
        Number(balance.annualRemaining) >=
        CONGO_LEAVE.ANNUAL_DAYS * CONGO_LEAVE.ALERT_THRESHOLD_CRITICAL,
      // ✅ Vue "cycle de congé" — pensée pour un affichage qui ne raisonne
      // plus en solde qui grimpe chaque mois, mais en droit total du cycle
      // (26j + ancienneté) déjà connu à l'avance, avec ce qui a déjà été
      // pris dessus. Les champs ci-dessus (monthlyRate, daysUntilNextAccrual)
      // restent en place pour ne rien casser côté existant — c'est un ajout,
      // pas un remplacement. Le calcul mensuel continue de tourner en
      // interne (accrueMonthlyLeaveForEmployee) : il reste la source de
      // vérité légale pour le prorata en cas de rupture avant fin de cycle.
      // ⚠️ Champs arrondis à l'entier exprès : un employé ne raisonne pas en
      // "17,3 jours", et le detail à virgule ne sert qu'au calcul légal
      // interne (accrual mensuel, prorata rupture) — jamais à l'affichage.
      cycle: {
        startDate: cycleStartDate,
        endDate: cycleEndDate,
        isComplete: monthsWorked >= 12,
        entitlementTotal: Math.round(Number(balance.annualEntitled)),
        daysTaken: Math.round(Number(balance.annualTaken)),
        daysRemaining: Math.round(Number(balance.annualRemaining)),
        seniorityDays: Math.round(Number(balance.seniorityDays ?? 0)),
        // Formulation pensée pour l'employé : pas de jargon "2,16j/mois",
        // juste "il vous reste Xj pour atteindre vos 26" tant que le cycle
        // n'est pas complet (0 une fois les 26j de base acquis).
        daysUntilFullBaseEntitlement: Math.max(
          0,
          Math.round(
            CONGO_LEAVE.ANNUAL_DAYS -
              (Number(balance.annualEntitled) -
                Number(balance.seniorityDays ?? 0)),
          ),
        ),
      },
    };
  }

  /**
   * Reprise du solde à la migration vers Konza — on demande le DERNIER congé
   * connu de l'employé (départ + retour) plutôt qu'un solde figé. Le moteur
   * normal (cycle glissant, accumulation mensuelle) prend le relais à partir
   * de là.
   *
   * - Dernier congé NORMAL → redémarre le cycle à sa date de retour, repart
   *   de 0, s'accumule tout seul.
   * - Dernier congé ANTICIPÉ → cycle inchangé ; seul `remainingDays` est
   *   saisi, le système déduit ce qui a été consommé et laisse l'accumulation
   *   continuer par-dessus.
   *
   * Crée aussi un enregistrement Leave APPROVED (`isMigrated: true`) pour
   * traçabilité dans l'historique/planning.
   */
  async seedBalanceFromLastLeave(
    employeeId: string,
    lastLeaveType: 'ANNUAL' | 'ANNUAL_ANTICIPATED',
    startDate: Date,
    endDate: Date,
    remainingDays?: number,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { hireDate: true, leaveCycleStartDate: true, companyId: true },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);
    if (endDate < startDate)
      throw new BadRequestException(
        'La date de retour doit être après la date de départ.',
      );

    const workingDays = await WorkingDays.calculateWorkingDays(
      this.prisma,
      employee.companyId,
      startDate,
      endDate,
    );

    // ✅ CORRECTIF (doublon à la correction) : la reprise à la migration est
    // une PHOTO à un instant T, pas un historique qui s'empile — si le RH
    // corrige une saisie (mauvaise date, mauvais solde...), on remplace
    // l'ancienne reprise au lieu d'en accumuler une nouvelle à côté.
    const previousMigratedLeave = await this.prisma.leave.findFirst({
      where: { employeeId, isMigrated: true },
    });
    if (previousMigratedLeave) {
      // Le solde créé pour l'ancien cycle (basé sur l'ancienne date de
      // retour) n'a plus lieu d'être une fois la reprise corrigée — supprimé
      // seulement s'il n'a pas encore été entamé (annualTaken=0), pour ne
      // jamais effacer un solde déjà consommé par un vrai congé entre-temps.
      await this.prisma.leaveBalance.deleteMany({
        where: {
          employeeId,
          cycleStartDate: previousMigratedLeave.endDate,
          annualTaken: 0,
        },
      });
      await this.prisma.leave.delete({
        where: { id: previousMigratedLeave.id },
      });
    }

    const migratedLeave = await this.prisma.leave.create({
      data: {
        employeeId,
        companyId: employee.companyId,
        type: lastLeaveType,
        startDate,
        endDate,
        daysCount: workingDays,
        status: 'APPROVED',
        isMigrated: true,
        reason:
          'Dernier congé connu — repris lors de la migration vers Konza RH',
      },
    });

    if (lastLeaveType === 'ANNUAL') {
      await this.prisma.employee.update({
        where: { id: employeeId },
        data: { leaveCycleStartDate: endDate },
      });
      const balance = await this.getOrCreateLeaveBalance(employeeId);
      return { leave: migratedLeave, balance };
    }

    const currentBalance = await this.getOrCreateLeaveBalance(employeeId);
    if (remainingDays !== undefined && remainingDays !== null) {
      if (remainingDays < 0)
        throw new BadRequestException(
          'Le solde restant ne peut pas être négatif.',
        );
      const entitled = Number(currentBalance.annualEntitled);
      const taken = Math.max(0, entitled - remainingDays);
      const updated = await this.prisma.leaveBalance.update({
        where: { id: currentBalance.id },
        data: {
          annualTaken: taken,
          annualRemaining: remainingDays,
          adjustmentNote:
            'Solde restant repris depuis le dernier congé anticipé connu (migration Konza RH)',
          lastCalculated: new Date(),
        },
      });
      return { leave: migratedLeave, balance: updated };
    }

    return { leave: migratedLeave, balance: currentBalance };
  }

  /**
   * Ajustement manuel direct du solde (entitled/taken) — utile pour une
   * correction ponctuelle. Pour la reprise à la migration, préférer
   * `seedBalanceFromLastLeave` qui laisse le moteur calculer le solde à
   * partir d'une date réelle plutôt qu'un chiffre figé.
   */
  async setManualBalance(
    employeeId: string,
    annualEntitled: number,
    annualTaken: number = 0,
    note?: string,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        hireDate: true,
        leaveCycleStartDate: true,
        company: { select: { leaveCycleMode: true } },
      },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);
    if (annualEntitled < 0 || annualTaken < 0) {
      throw new BadRequestException(
        'Les valeurs de solde ne peuvent pas être négatives.',
      );
    }

    const { cycleStartDate, cycleEndDate } = resolveCycleWindow(
      new Date(employee.hireDate),
      employee.leaveCycleStartDate
        ? new Date(employee.leaveCycleStartDate)
        : null,
      undefined,
      (employee.company?.leaveCycleMode as 'ROLLING' | 'ANNIVERSARY') ??
        'ROLLING',
    );
    const annualRemaining = Math.max(0, annualEntitled - annualTaken);
    const cyclesCount = await this.prisma.leaveBalance.count({
      where: { employeeId },
    });

    return this.prisma.leaveBalance.upsert({
      where: { employeeId_cycleStartDate: { employeeId, cycleStartDate } },
      create: {
        employeeId,
        year: cycleStartDate.getFullYear(),
        cycleNumber: cyclesCount + 1,
        cycleStartDate,
        cycleEndDate,
        annualEntitled,
        annualTaken,
        annualRemaining,
        adjustmentNote: note,
        lastCalculated: new Date(),
      },
      update: {
        annualEntitled,
        annualTaken,
        annualRemaining,
        adjustmentNote: note,
        lastCalculated: new Date(),
      },
    });
  }

  /** Mon solde (employé connecté) */
  async getMyBalance(userId: string) {
    const user = await getUserWithCompany(this.prisma, userId);

    const employee = await this.prisma.employee.findFirst({
      where: { email: user.email ?? undefined, companyId: user.companyId },
      select: { id: true },
    });
    if (!employee) throw new EmployeeNotFoundException();
    await this.assertLeaveEligible(employee.id);

    return this.getEmployeeBalanceDetails(employee.id);
  }

  /** Agrégat mensuel sur une année — alimente le graphique de tendance sur "Suivi de congé". */
  async getYearlyLeaveTrend(
    userId: string,
    year: number,
    overrideCompanyId?: string,
  ) {
    const user = await getUserWithCompany(
      this.prisma,
      userId,
      overrideCompanyId,
    );
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59);

    const whereClause: any = {
      companyId: user.companyId,
      status: 'APPROVED',
      startDate: { gte: startOfYear, lte: endOfYear },
    };
    if (user.role === 'MANAGER') {
      const deptId = await getManagerDepartmentId(
        this.prisma,
        userId,
        user.companyId,
      );
      if (!deptId) return [];
      whereClause.employee = { departmentId: deptId };
    }

    const leaves = await this.prisma.leave.findMany({
      where: whereClause,
      select: { startDate: true, daysCount: true },
    });

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      count: 0,
      totalDays: 0,
    }));
    for (const l of leaves) {
      const m = new Date(l.startDate).getMonth();
      months[m].count++;
      months[m].totalDays += Number(l.daysCount);
    }
    return months;
  }

  /**
   * Acquisition mensuelle — s'applique au cycle en cours de l'employé (12
   * mois glissants). Le plafond est 26j de base (+ jours d'ancienneté du
   * cycle) par cycle.
   *
   * ✅ month/year = la période du BULLETIN traité (pas l'horloge serveur) —
   * une saisie a posteriori en août pour un bulletin d'avril doit tester le
   * cycle sur avril, pas sur août.
   *
   * ✅ Idempotent par mois/année : si ce mois a déjà été crédité pour ce
   * cycle (ex: on régénère/re-sauvegarde le même bulletin), on ne rajoute
   * pas +2,16j une seconde fois.
   */
  async accrueMonthlyLeaveForEmployee(
    employeeId: string,
    month: number,
    year: number,
  ): Promise<void> {
    if (!(await this.getLeaveEligibility(employeeId)).eligible) return;
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        hireDate: true,
        leaveCycleStartDate: true,
        status: true,
        firstName: true,
        lastName: true,
        company: { select: { leaveCycleMode: true } },
      },
    });
    if (!employee || employee.status !== 'ACTIVE') return;

    const { cycleStartDate, cycleEndDate } = resolveCycleWindow(
      new Date(employee.hireDate),
      employee.leaveCycleStartDate
        ? new Date(employee.leaveCycleStartDate)
        : null,
      undefined,
      (employee.company?.leaveCycleMode as 'ROLLING' | 'ANNIVERSARY') ??
        'ROLLING',
    );

    const targetDate = new Date(year, month - 1, 1);
    if (targetDate < cycleStartDate) return;
    if (targetDate > cycleEndDate) return;

    const balance = await this.prisma.leaveBalance.findUnique({
      where: { employeeId_cycleStartDate: { employeeId, cycleStartDate } },
    });

    if (!balance) {
      await this.getOrCreateLeaveBalance(employeeId);
      return;
    }

    // ✅ Déjà crédité pour ce mois/année — évite le double accrual si on
    // régénère ou re-sauvegarde le même bulletin.
    if (
      (balance as any).lastAccrualMonth === month &&
      (balance as any).lastAccrualYear === year
    ) {
      this.logger.log(
        `⏭️ ${employee.firstName} ${employee.lastName} — Accrual déjà fait pour ${month}/${year}`,
      );
      return;
    }

    // ✅ Nombre de mois pleins écoulés depuis le début du cycle jusqu'au
    // mois du bulletin traité (0-12) — sert à calculer la cible ENTIÈRE
    // attendue, pas un incrément fractionnaire.
    const monthsElapsed = Math.max(
      0,
      Math.min(
        12,
        (year - cycleStartDate.getFullYear()) * 12 +
          (month - (cycleStartDate.getMonth() + 1)) +
          1, // le mois de cycleStartDate lui-même compte comme mois 1
      ),
    );

    // ✅ Cible ENTIÈRE pour ce nombre de mois — jamais de virgule, et pile
    // 26 au 12e mois (2, 4, 6, 9, 11, 13, 15, 17, 20, 22, 24, 26).
    // On FIXE la base (pas un +=) : auto-corrige toute dérive passée
    // (double accrual d'avant le fix, mois sauté...) au lieu de l'empiler.
    const targetBase = Math.min(
      Math.round((monthsElapsed * CONGO_LEAVE.ANNUAL_DAYS) / 12),
      CONGO_LEAVE.ANNUAL_DAYS,
    );

    const currentBase =
      Number(balance.annualEntitled) - Number(balance.seniorityDays);

    if (targetBase === currentBase) {
      // Rien à changer ce mois-ci — juste marquer le mois comme traité
      await this.prisma.leaveBalance.update({
        where: { id: balance.id },
        data: { lastAccrualMonth: month, lastAccrualYear: year } as any,
      });
      return;
    }

    const diff = targetBase - currentBase; // peut être négatif si on corrige une dérive
    const newEntitled = Number(balance.seniorityDays) + targetBase;
    const newRemaining = Math.max(
      0,
      Number(balance.annualRemaining) + diff,
    );

    await this.prisma.leaveBalance.update({
      where: { id: balance.id },
      data: {
        annualEntitled: newEntitled,
        annualRemaining: newRemaining,
        lastCalculated: new Date(),
        lastAccrualMonth: month,
        lastAccrualYear: year,
      } as any,
    });
    this.logger.log(
      `✅ Acquisition: ${employee.firstName} ${employee.lastName} — mois ${monthsElapsed}/12 → base cycle: ${targetBase}j/26j` +
        (diff !== currentBase ? ` (ajustement ${diff >= 0 ? '+' : ''}${diff}j)` : ''),
    );
  }

  /**
   * Alertes RH — employé qui vient d'atteindre ses 12 mois, ou dont le solde
   * approche/dépasse le plafond du cycle sans avoir été pris.
   */
  async checkAndSendLeaveAlerts(employeeId: string): Promise<void> {
    if (!(await this.getLeaveEligibility(employeeId)).eligible) return;
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        companyId: true,
        hireDate: true,
        leaveCycleStartDate: true,
        company: { select: { leaveCycleMode: true } },
      },
    });
    if (!employee) return;

    const balance = await this.prisma.leaveBalance.findFirst({
      where: { employeeId },
      orderBy: { cycleStartDate: 'desc' },
    });
    if (!balance) return;

    const { cycleStartDate } = resolveCycleWindow(
      new Date(employee.hireDate),
      employee.leaveCycleStartDate
        ? new Date(employee.leaveCycleStartDate)
        : null,
      undefined,
      (employee.company?.leaveCycleMode as 'ROLLING' | 'ANNIVERSARY') ??
        'ROLLING',
    );
    const now = new Date();
    const monthsWorked =
      (now.getTime() - cycleStartDate.getTime()) /
      (1000 * 60 * 60 * 24 * 30.44);
    const remaining = Number(balance.annualRemaining);
    // 🆕 Affichage : jours arrondis à l'entier dans les messages de
    // notification (26, pas 25.9) — le calcul du ratio/provision juste
    // en dessous continue d'utiliser la valeur précise `remaining`.
    const remainingDisplay = Math.round(remaining);
    const { basedOnAverage } =
      await this.indemnityService.calculateLeaveIndemnity(
        employeeId,
        1,
        employee.companyId,
      );
    const provision = Math.round(
      (basedOnAverage / CONGO_LEAVE.WORK_DAYS_PER_MONTH) * remaining,
    );

    if (
      Math.floor(monthsWorked) === CONGO_LEAVE.MIN_MONTHS_BEFORE_LEAVE &&
      remaining > 0
    ) {
      await this.notificationsService.createForGroup(
        employee.companyId,
        ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'],
        {
          type: 'SYSTEM_ALERT',
          title: '🎉 Employé éligible aux congés annuels',
          message: `${employee.firstName} ${employee.lastName} vient de compléter 12 mois de service. Il/Elle dispose de ${remainingDisplay} jours de congés annuels à planifier.`,
          link: `/employes/${employeeId}/conges`,
          metadata: { employeeId, remainingDays: remaining, provision },
        },
        { excludeEmployeeIds: [employeeId] },
      );
    }

    const cycleMax =
      CONGO_LEAVE.ANNUAL_DAYS + Number(balance.seniorityDays ?? 0);
    const cycleMaxDisplay = Math.round(cycleMax);
    const ratio = cycleMax > 0 ? remaining / cycleMax : 0;
    if (
      ratio >= CONGO_LEAVE.ALERT_THRESHOLD_WARNING &&
      ratio < CONGO_LEAVE.ALERT_THRESHOLD_CRITICAL
    ) {
      await this.notificationsService.createForGroup(
        employee.companyId,
        ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'],
        {
          type: 'SYSTEM_ALERT',
          title: '⚠️ Congés non pris — Provision importante',
          message: `${employee.firstName} ${employee.lastName} a ${remainingDisplay} jours de congés non pris. Provision : ${provision.toLocaleString('fr-FR')} F CFA.`,
          link: `/employes/${employeeId}/conges`,
          metadata: {
            employeeId,
            remainingDays: remaining,
            provision,
            alertLevel: 'WARNING',
          },
        },
        { excludeEmployeeIds: [employeeId] },
      );
    }

    if (ratio >= CONGO_LEAVE.ALERT_THRESHOLD_CRITICAL) {
      await this.notificationsService.createForGroup(
        employee.companyId,
        ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'],
        {
          type: 'SYSTEM_ALERT',
          title: '🚨 URGENT — Plafond légal de congés approché',
          message: `${employee.firstName} ${employee.lastName} approche le plafond du cycle (${remainingDisplay}/${cycleMaxDisplay} jours). Départ en congé OBLIGATOIRE. Provision : ${provision.toLocaleString('fr-FR')} F CFA.`,
          link: `/employes/${employeeId}/conges`,
          metadata: {
            employeeId,
            remainingDays: remaining,
            provision,
            alertLevel: 'CRITICAL',
          },
        },
        { excludeEmployeeIds: [employeeId] },
      );
    }
  }

  /**
   * 🆕 Date de REPRISE (jj/mm/aaaa) = premier jour travaillé après le dernier jour de
   * congé : repos hebdomadaires et jours fériés de l'entreprise sautés.
   */
  private async resumptionLabel(companyId: string, endDate: Date): Promise<string> {
    const workDays = await WorkingDays.getCompanyWorkDays(this.prisma, companyId);
    const holidays = await this.prisma.publicHoliday.findMany({ where: { companyId }, select: { date: true } });
    const iso = WorkingDays.nextWorkingDay(new Date(endDate), workDays, new Set(holidays.map((h) => h.date)));
    return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR');
  }

  /**
   * Rappels de retour de congé — congés qui se terminent dans 3 jours, et
   * retours dépassés sans confirmation.
   */
  async checkLeaveReturnReminders(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Clé du jour, utilisée pour l'idempotence ci-dessous (format AAAA-MM-JJ)
    const todayKey = today.toISOString().slice(0, 10);

    const in3Days = new Date(today);
    in3Days.setDate(in3Days.getDate() + 3);

    const endingSoon = await this.prisma.leave.findMany({
      where: {
        status: 'APPROVED',
        type: { in: ['ANNUAL', 'ANNUAL_ANTICIPATED'] },
        endDate: {
          gte: in3Days,
          lt: new Date(in3Days.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      include: {
        employee: {
          select: { firstName: true, lastName: true, companyId: true },
        },
      },
    });

    for (const leave of endingSoon) {
      // 🐛 CORRIGÉ : ce cron tourne chaque jour sur CHAQUE instance backend
      // (Render en plusieurs dynos/replicas) sans aucune garde — chaque
      // instance créait donc son propre doublon, à la même seconde. On
      // utilise le même registre d'idempotence que unpaid-salary.service.ts
      // (NotificationsService.tryClaim), scopé par jour puisque c'est un
      // rappel quotidien tant que le retour n'est pas confirmé.
      const claimed = await this.notificationsService.tryClaim(
        `leave-return:ending-soon:${leave.id}:${todayKey}`,
      );
      if (!claimed) continue;

      await this.notificationsService.createForGroup(
        leave.employee.companyId,
        ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'],
        {
          type: 'SYSTEM_ALERT',
          title: '📅 Fin de congé proche',
          message: `${leave.employee.firstName} ${leave.employee.lastName} termine son congé le ${new Date(leave.endDate).toLocaleDateString('fr-FR')} — reprise prévue le ${await this.resumptionLabel(leave.employee.companyId, leave.endDate)}.`,
          link: `/conges/${leave.id}`,
          metadata: {
            leaveId: leave.id,
            employeeId: leave.employeeId,
            endDate: leave.endDate,
          },
        },
      );
    }

    const overdue = await this.prisma.leave.findMany({
      where: {
        status: 'APPROVED',
        type: { in: ['ANNUAL', 'ANNUAL_ANTICIPATED'] },
        endDate: { lt: today },
        returnConfirmed: false,
      },
      include: {
        employee: {
          select: { firstName: true, lastName: true, companyId: true },
        },
      },
    });

    for (const leave of overdue) {
      const daysOverdue = Math.floor(
        (today.getTime() - new Date(leave.endDate).getTime()) /
          (1000 * 60 * 60 * 24),
      );

      // ✅ Même correctif anti-doublon que ci-dessus (rappel quotidien tant
      // que le retour n'est pas confirmé → clé scopée par jour)
      const claimed = await this.notificationsService.tryClaim(
        `leave-return:overdue:${leave.id}:${todayKey}`,
      );
      if (!claimed) continue;

      await this.notificationsService.createForGroup(
        leave.employee.companyId,
        ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'],
        {
          type: 'SYSTEM_ALERT',
          title: '❓ Retour de congé à confirmer',
          message: `${leave.employee.firstName} ${leave.employee.lastName} devait reprendre le travail le ${await this.resumptionLabel(leave.employee.companyId, leave.endDate)} (${Math.round(daysOverdue)}j) — merci de vérifier et confirmer son retour.`,
          link: `/conges/${leave.id}`,
          metadata: {
            leaveId: leave.id,
            employeeId: leave.employeeId,
            daysOverdue,
          },
        },
      );
    }

    this.logger.log(
      `🔔 Rappels retour congé : ${endingSoon.length} fin proche, ${overdue.length} retour à confirmer`,
    );
  }

  /** RH/Admin confirme que l'employé est bien revenu de congé. */
  /**
   * Confirme le retour de congé — gère aussi le RETOUR ANTICIPÉ (l'employé
   * reprend avant la date de retour prévue).
   *
   * ⚠️ Ce n'est PAS un congé anticipé (ANNUAL_ANTICIPATED, qui puise dans un
   * solde pas encore clos) — ici le congé était déjà normal/validé, il est
   * juste écourté dans les faits. Les jours ouvrables entre la reprise
   * réelle et la date de retour initialement prévue sont marqués PERDUS :
   * ils ne sont PAS reversés au solde (le solde a déjà été décompté en
   * totalité à la validation, et le Code du travail ne prévoit pas de
   * report automatique sur le cycle suivant) — seulement conservés pour
   * traçabilité/visibilité RH ("4j de ce congé n'ont pas été pris").
   *
   * @param actualReturnDate Date réelle de reprise. Omise ou égale/postérieure
   *   à `endDate` → comportement inchangé (simple confirmation, 0j perdu).
   */
  async confirmLeaveReturn(
    leaveId: string,
    userId: string,
    actualReturnDate?: Date,
    overrideCompanyId?: string,
  ) {
    const user = await getUserWithCompany(
      this.prisma,
      userId,
      overrideCompanyId,
    );
    const leave = await this.prisma.leave.findUnique({
      where: { id: leaveId },
    });
    if (!leave) throw new NotFoundException('Demande de congé introuvable.');
    // ✅ CORRECTIF SÉCURITÉ : aucune vérification d'entreprise n'existait ici —
    // un RH d'une AUTRE entreprise pouvait confirmer/modifier le retour d'un
    // congé qui ne lui appartenait pas.
    if (leave.companyId !== user.companyId) {
      throw new ForbiddenException('Accès refusé');
    }

    const data: any = {
      returnConfirmed: true,
      returnConfirmedAt: new Date(),
      returnConfirmedBy: userId,
    };

    if (actualReturnDate) {
      if (actualReturnDate < leave.startDate) {
        throw new BadRequestException(
          'La date de retour réelle ne peut pas être avant la date de départ.',
        );
      }
      data.actualReturnDate = actualReturnDate;

      if (actualReturnDate < leave.endDate) {
        // Jour ouvré suivant la reprise → dernier jour prévu du congé
        const dayAfterReturn = new Date(actualReturnDate);
        dayAfterReturn.setDate(dayAfterReturn.getDate() + 1);

        if (dayAfterReturn <= leave.endDate) {
          const forfeited = await WorkingDays.calculateWorkingDays(
            this.prisma,
            leave.companyId,
            dayAfterReturn,
            leave.endDate,
          );
          data.forfeitedDays = forfeited;
          this.logger.log(
            `↩️ Retour anticipé — congé ${leaveId} : ${forfeited}j posés non pris (perdus, non reversés au solde)`,
          );
        } else {
          data.forfeitedDays = 0;
        }
      } else {
        data.forfeitedDays = 0;
      }
    }

    return this.prisma.leave.update({
      where: { id: leaveId },
      data,
    });
  }
}