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
  async getProjectedBalanceAsOf(employeeId: string, asOfDate: Date) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        hireDate: true,
        leaveCycleStartDate: true,
        company: {
          select: {
            appliesSeniorityLeaveBonus: true,
            leaveConventionKey: true,
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
    );

    const existing = await this.prisma.leaveBalance.findUnique({
      where: { employeeId_cycleStartDate: { employeeId, cycleStartDate } },
    });

    const realNow = new Date();
    if (!existing && realNow < cycleStartDate) {
      return {
        reliable: false as const,
        cycleStartDate,
        cycleEndDate,
        reason:
          `Ce congé tombe après la fin du cycle actuel de l'employé, dont la ` +
          `date de clôture dépend elle-même de son prochain retour de congé ` +
          `(pas encore survenu). Planifiez d'abord son congé sur le cycle en ` +
          `cours, ou attendez que ce cycle se ferme avant de planifier au-delà.`,
      };
    }

    const effectiveNow = asOfDate < cycleEndDate ? asOfDate : cycleEndDate;
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
      cycleStartDate,
      cycleEndDate,
      totalEntitled,
      annualTaken,
      projectedRemaining: Math.round((totalEntitled - annualTaken) * 10) / 10,
    };
  }

  /**
   * Combine le solde (LeaveBalance) et l'éligibilité (mois travaillés, congé
   * annuel accessible ou non) pour un employé donné.
   */
  async getEmployeeBalanceDetails(employeeId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { hireDate: true, leaveCycleStartDate: true },
    });
    if (!employee) throw new EmployeeNotFoundException(employeeId);

    const balance = await this.getOrCreateLeaveBalance(employeeId);

    const { cycleStartDate, cycleEndDate } = resolveCycleWindow(
      new Date(employee.hireDate),
      employee.leaveCycleStartDate
        ? new Date(employee.leaveCycleStartDate)
        : null,
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
      select: { hireDate: true, leaveCycleStartDate: true },
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
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        hireDate: true,
        leaveCycleStartDate: true,
        status: true,
        firstName: true,
        lastName: true,
      },
    });
    if (!employee || employee.status !== 'ACTIVE') return;

    const { cycleStartDate, cycleEndDate } = resolveCycleWindow(
      new Date(employee.hireDate),
      employee.leaveCycleStartDate
        ? new Date(employee.leaveCycleStartDate)
        : null,
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
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        companyId: true,
        hireDate: true,
        leaveCycleStartDate: true,
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
    );
    const now = new Date();
    const monthsWorked =
      (now.getTime() - cycleStartDate.getTime()) /
      (1000 * 60 * 60 * 24 * 30.44);
    const remaining = Number(balance.annualRemaining);
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
          message: `${employee.firstName} ${employee.lastName} vient de compléter 12 mois de service. Il/Elle dispose de ${remaining} jours de congés annuels à planifier.`,
          link: `/employes/${employeeId}/conges`,
          metadata: { employeeId, remainingDays: remaining, provision },
        },
      );
    }

    const cycleMax =
      CONGO_LEAVE.ANNUAL_DAYS + Number(balance.seniorityDays ?? 0);
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
          message: `${employee.firstName} ${employee.lastName} a ${remaining} jours de congés non pris. Provision : ${provision.toLocaleString('fr-FR')} F CFA.`,
          link: `/employes/${employeeId}/conges`,
          metadata: {
            employeeId,
            remainingDays: remaining,
            provision,
            alertLevel: 'WARNING',
          },
        },
      );
    }

    if (ratio >= CONGO_LEAVE.ALERT_THRESHOLD_CRITICAL) {
      await this.notificationsService.createForGroup(
        employee.companyId,
        ['ADMIN', 'SUPER_ADMIN', 'HR_MANAGER'],
        {
          type: 'SYSTEM_ALERT',
          title: '🚨 URGENT — Plafond légal de congés approché',
          message: `${employee.firstName} ${employee.lastName} approche le plafond du cycle (${remaining}/${cycleMax} jours). Départ en congé OBLIGATOIRE. Provision : ${provision.toLocaleString('fr-FR')} F CFA.`,
          link: `/employes/${employeeId}/conges`,
          metadata: {
            employeeId,
            remainingDays: remaining,
            provision,
            alertLevel: 'CRITICAL',
          },
        },
      );
    }
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
          message: `${leave.employee.firstName} ${leave.employee.lastName} termine son congé le ${new Date(leave.endDate).toLocaleDateString('fr-FR')} — reprise prévue le lendemain.`,
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
          message: `${leave.employee.firstName} ${leave.employee.lastName} devait reprendre le travail le ${new Date(leave.endDate).toLocaleDateString('fr-FR')} (${daysOverdue}j) — merci de vérifier et confirmer son retour.`,
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