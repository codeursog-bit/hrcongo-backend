// ============================================================================
// 📁 src/leaves/leaves-indemnity.service.ts
// ✅ Extrait de l'ancien leaves.service.ts monolithique (découpage Phase 7).
// ✅ Tout ce qui concerne le CALCUL DE L'INDEMNITÉ DE CONGÉ et son export
//    vers la paie : moyenne 12 mois (ou maintien du salaire courant, selon
//    la méthode choisie par l'entreprise), impact mensuel pour la paie,
//    provision comptable pour congés non pris. Logique inchangée depuis
//    l'original, seulement déplacée dans son propre service.
// ============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as WorkingDays from '../common/working-days.util';
import { getSeniorityDaysForConvention } from './config/leave-seniority-conventions';
import { resolveCycleWindow } from './leaves-common.util';
import {
  CONGO_LEAVE,
  LeaveImpactForPayroll,
  LeaveProvisionResult,
} from './leaves.constants';

@Injectable()
export class LeavesIndemnityService {
  private readonly logger = new Logger(LeavesIndemnityService.name);

  constructor(private prisma: PrismaService) {}

  // ============================================================================
  // 📅 CYCLES DE RÉFÉRENCE — glissants depuis le dernier retour de congé
  // ============================================================================
  // ✅ CORRECTIF (demande explicite) : remplace l'ancien système à 3 choix
  //    (JANUARY / JUNE / HIRE_DATE, calendaires fixes) par UNE seule règle
  //    universelle : la période de référence redémarre TOUJOURS le
  //    lendemain de la fin du dernier congé ANNUAL réellement pris (ou à la
  //    date d'embauche si jamais pris), puis avance par blocs de 12 mois.
  //    Un cycle calendaire fixe pouvait retomber sur un mois où l'employé
  //    était justement en congé (donc sans bulletin) — la règle glissante
  //    ne peut plus jamais recréer ce trou : on ne compte QUE des mois
  //    effectivement travaillés depuis le retour.
  //    Retourne tous les cycles de 12 mois "dus" (complétés ou en cours)
  //    entre sinceDate et le mois de paie (anchor).
  // ============================================================================
  private getAllDueCyclesRolling(
    sinceDate: Date,
    anchorYear: number,
    anchorMonth: number, // 1-12 — mois du bulletin où l'indemnité est payée
  ): Array<{ from: Date; to: Date }> {
    const anchor = new Date(anchorYear, anchorMonth - 1, 1);
    const windows: Array<{ from: Date; to: Date }> = [];
    let cursor = new Date(sinceDate);

    for (let i = 0; i < 10; i++) {
      const from = new Date(cursor);
      const to = new Date(
        cursor.getFullYear() + 1,
        cursor.getMonth(),
        cursor.getDate() - 1,
      );
      if (from > anchor) break; // ce cycle n'a pas encore commencé au mois de la paie
      windows.push({ from, to });
      cursor = new Date(
        cursor.getFullYear() + 1,
        cursor.getMonth(),
        cursor.getDate(),
      );
    }

    return windows;
  }

  /**
   * Calcule l'indemnité de congé selon la méthode choisie par l'entreprise.
   * - AVERAGE_12M (défaut) : 1/12e de la moyenne des 12 derniers bulletins (brut)
   * - CURRENT_SALARY       : maintien du dernier salaire brut connu
   */
  async calculateLeaveIndemnity(
    employeeId: string,
    daysCount: number,
    companyId?: string,
    anchorMonth?: number,
    anchorYear?: number,
    // ✅ CORRECTIF ("le trou") : le mois où l'indemnité est payée est
    // TOUJOURS le dernier mois du cycle de référence (12 mois glissants
    // depuis le retour de congé) — mais son propre bulletin n'existe pas
    // encore en base au moment de ce calcul (on est en train de le créer).
    // Sans ce paramètre, la moyenne ne trouve que 11 bulletins réels au
    // lieu de 12. On fait injecter par l'appelant le brut de TRAVAIL de ce
    // mois précis (base + heures sup + primes — JAMAIS l'indemnité
    // elle-même, ce qui recréerait une boucle) pour compléter le 12e mois.
    currentMonthWorkGross?: number,
  ): Promise<{
    indemnity: number;
    basedOnAverage: number;
    monthsUsed: number;
    cyclesCount: number;
    method: 'AVERAGE_12M' | 'CURRENT_SALARY';
    usedOpeningCumulative: boolean;
  }> {
    const refYear = anchorYear ?? new Date().getFullYear();
    const refMonth = anchorMonth ?? new Date().getMonth() + 1;

    let method: 'AVERAGE_12M' | 'CURRENT_SALARY' = 'AVERAGE_12M';
    // ✅ CORRECTIF (demande explicite) : plus de choix de cycle par
    // entreprise (JANUARY/JUNE/HIRE_DATE, calendaires fixes) — voir
    // getAllDueCyclesRolling() plus bas, toujours glissant depuis le
    // dernier retour de congé.
    // ✅ CORRECTIF : servent à calculer, PAR CYCLE traité plus bas, le vrai
    // plafond de jours (26 + bonus d'ancienneté DE CE CYCLE si l'entreprise
    // gère la convention — jamais un 26 fixe qui avalait silencieusement les
    // jours d'ancienneté, même pour un départ normal à un seul cycle).
    let appliesSeniorityBonus = true;
    let conventionKey = 'GENERALE';
    // 🆕 Mode ANNIVERSARY : voir plus bas (sinceDate + substitution des
    // mois de départ par paidIndemnityAmount).
    let cycleMode: 'ROLLING' | 'ANNIVERSARY' = 'ROLLING';

    if (companyId) {
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: {
          leaveIndemnityMethod: true,
          appliesSeniorityLeaveBonus: true,
          leaveConventionKey: true,
          leaveCycleMode: true,
        } as any,
      });
      if ((company as any)?.leaveIndemnityMethod === 'CURRENT_SALARY')
        method = 'CURRENT_SALARY';
      appliesSeniorityBonus =
        (company as any)?.appliesSeniorityLeaveBonus ?? true;
      conventionKey = (company as any)?.leaveConventionKey ?? 'GENERALE';
      cycleMode =
        ((company as any)?.leaveCycleMode as 'ROLLING' | 'ANNIVERSARY') ??
        'ROLLING';
    }

    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        hireDate: true,
        baseSalary: true,
        openingCumulativeGross: true,
        openingCumulativeMonths: true,
      },
    });
    const hireDate = emp?.hireDate ? new Date(emp.hireDate) : null;
    // ✅ Repli ultime (aucun historique Konza RH, aucun cumul d'onboarding
    // renseigné) : salaire de base actuel. Sert aussi de repli pour
    // CURRENT_SALARY, qui n'a pas besoin du mélange cumul+historique
    // ci-dessous (une seule valeur suffit pour cette méthode).
    const fallbackGross = Number(emp?.baseSalary ?? 0);
    // Taux mensuel moyen du cumul d'onboarding (si renseigné) — pour
    // proratiser au besoin (voir plafond 12 mois plus bas).
    const openingMonthlyRate =
      emp?.openingCumulativeGross && emp?.openingCumulativeMonths
        ? Number(emp.openingCumulativeGross) / emp.openingCumulativeMonths
        : 0;

    if (method === 'CURRENT_SALARY') {
      const last = await this.prisma.payroll.findFirst({
        where: {
          employeeId,
          status: { in: ['VALIDATED', 'PAID'] },
          OR: [
            { year: { lt: refYear } },
            { year: refYear, month: { lt: refMonth } },
          ],
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        select: { grossSalary: true },
      });
      const base = last ? Number(last.grossSalary) : (openingMonthlyRate || fallbackGross);
      const dailyRate = base / CONGO_LEAVE.WORK_DAYS_PER_MONTH;
      const indemnity = Math.round(dailyRate * daysCount);
      this.logger.log(
        `💰 Indemnité [CURRENT_SALARY]: ${daysCount}j × ${Math.round(dailyRate)} F/j = ${indemnity} F`,
      );
      return {
        indemnity,
        basedOnAverage: base,
        monthsUsed: last ? 1 : 0,
        cyclesCount: 1,
        method,
        usedOpeningCumulative: false,
      };
    }

    const lastAnnualLeave = await this.prisma.leave.findFirst({
      where: cycleMode === 'ANNIVERSARY'
        ? {
            employeeId,
            type: 'ANNUAL',
            status: 'APPROVED',
            // 🆕 En ANNIVERSARY, le cycle ne redémarre jamais sur un simple
            // retour de congé (la date réelle de retour n'a pas d'influence
            // sur l'ancre) — seul un cycle dont l'indemnité a VRAIMENT été
            // versée (paidIndemnityAmount renseigné, voir
            // payroll-generator.service.ts/payrolls.service.ts) marque le
            // début du décompte suivant. Sans ce filtre, on retomberait sur
            // le même comportement que ROLLING par erreur.
            paidIndemnityAmount: { not: null },
          }
        : { employeeId, type: 'ANNUAL', status: 'APPROVED' },
      orderBy: { endDate: 'desc' },
      select: { startDate: true, endDate: true },
    });

    // 🐛 CORRECTIF (trouvé en discussion produit) : en ANNIVERSARY, le
    // cycle suivant doit démarrer au 1er jour du MOIS DE DÉPART du dernier
    // congé payé (janvier, substitué) — PAS à sa date de retour (février).
    // Sinon janvier tombe avant le début de la fenêtre du cycle suivant et
    // la substitution paidIndemnityAmount ne le rattrape jamais : le cycle
    // ne compte plus que 10-11 mois réels, ET perd l'alignement d'année qui
    // fait fonctionner `cycleEndsOnAnchorMonth` (le "to" calculé retombe
    // dans l'année suivante par rapport au bulletin en cours de génération,
    // désactivant l'injection du mois courant). Utiliser `startDate` remet
    // le cycle en phase : [Jan1, Dec31] au lieu de [Fev1, Jan31 suivant].
    const sinceDateRaw =
      cycleMode === 'ANNIVERSARY' && lastAnnualLeave?.startDate
        ? new Date(
            lastAnnualLeave.startDate.getFullYear(),
            lastAnnualLeave.startDate.getMonth(),
            1,
          )
        : lastAnnualLeave?.endDate
          ? new Date(lastAnnualLeave.endDate)
          : (hireDate ?? new Date(refYear - 1, 0, 1));

    // ✅ CORRECTIF (trouvé par le test automatisé) : les bulletins Konza RH
    // sont mensuels, pas journaliers — une frontière de cycle au jour près
    // (ex: reprise un 31, cycle suivant qui redémarre le 31 aussi un an
    // plus tard) fait retomber DEUX frontières de cycles consécutifs dans
    // le MÊME mois calendaire. Le filtre `history` (mois/année) ramassait
    // alors le bulletin de ce mois-là pour LES DEUX cycles à la fois —
    // un mois compté deux fois, gonflant la moyenne du cycle suivant.
    // On aligne donc toujours le début de cycle sur le 1er du mois : si
    // sinceDate n'est pas déjà un 1er, on arrondit au 1er du mois SUIVANT
    // (le mois de la reprise, souvent partiel, reste hors des deux cycles
    // plutôt que dans les deux à la fois — jamais de double comptage).
    const sinceDate =
      sinceDateRaw.getDate() === 1
        ? sinceDateRaw
        : new Date(sinceDateRaw.getFullYear(), sinceDateRaw.getMonth() + 1, 1);

    const cycles = this.getAllDueCyclesRolling(sinceDate, refYear, refMonth);

    if (cycles.length === 0) {
      // Repli de sécurité (ne devrait plus arriver avec le modèle glissant,
      // mais évite un crash si sinceDate est incohérente) : un seul cycle
      // de 12 mois se terminant au mois de la paie.
      cycles.push({
        from: new Date(refYear - 1, refMonth - 1, 1),
        to: new Date(refYear, refMonth - 1, 0),
      });
    }

    this.logger.log(
      `📅 ${cycles.length} cycle(s) détecté(s) depuis ${sinceDate.toISOString().slice(0, 10)} (glissant)`,
    );

    // ✅ Garde-fou : une fois que l'employé a 12 vrais bulletins ou plus
    // QUELQUE PART dans son historique Konza RH (peu importe le cycle
    // interrogé), le cumul d'onboarding ne doit plus JAMAIS resservir —
    // même si un cycle précis (ex: après un changement de cycle de
    // référence JANUARY/JUNE/HIRE_DATE côté entreprise, ou un trou de
    // données) remonte moins de 12 bulletins pour SA fenêtre à lui. Sans
    // ça, un cumul saisi il y a 2 ans avec un salaire d'alors pourrait
    // ressurgir sur un cas limite, alors qu'il est censé n'avoir servi
    // qu'au tout début.
    const totalRealPayrollsEver = await this.prisma.payroll.count({
      where: { employeeId, status: { in: ['VALIDATED', 'PAID'] } },
    });
    const openingStillEligible = totalRealPayrollsEver < 12;

    // ✅ CORRECTIF : le plafond de 26j était appliqué IDENTIQUE sur chaque
    // cycle, même quand daysCount incluait déjà des jours d'ancienneté
    // (30, 32, 34...) — les jours au-delà de 26 étaient alors purement
    // perdus, y compris pour un départ normal à cycle unique. Chaque cycle
    // a maintenant son propre plafond = 26 + bonus d'ancienneté APPLICABLE
    // À CE CYCLE (l'ancienneté grandit dans le temps : un cycle ancien peut
    // avoir un plafond plus bas qu'un cycle récent) — 0 si l'entreprise ne
    // gère pas cette convention (`appliesSeniorityBonus` = false).
    let totalIndemnity = 0;
    let totalMonthsUsed = 0;
    let usedOpeningCumulative = false;
    let remainingDays = daysCount; // ✅ jamais dépasser le nombre de jours réellement demandés

    for (let i = 0; i < cycles.length; i++) {
      const { from, to } = cycles[i];

      const cycleSeniorityDays = appliesSeniorityBonus
        ? getSeniorityDaysForConvention(
            conventionKey,
            Math.max(
              0,
              hireDate
                ? (from.getTime() - hireDate.getTime()) /
                    (1000 * 60 * 60 * 24 * 365.25)
                : 0,
            ),
          )
        : 0;
      const daysPerCycle = CONGO_LEAVE.ANNUAL_DAYS + cycleSeniorityDays;

      const history = await this.prisma.payroll.findMany({
        where: {
          employeeId,
          status: { in: ['VALIDATED', 'PAID'] },
          AND: [
            {
              OR: [
                { year: { gt: from.getFullYear() } },
                {
                  year: from.getFullYear(),
                  month: { gte: from.getMonth() + 1 },
                },
              ],
            },
            {
              OR: [
                { year: { lt: to.getFullYear() } },
                { year: to.getFullYear(), month: { lte: to.getMonth() + 1 } },
              ],
            },
          ],
        },
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
        select: { grossSalary: true, month: true, year: true },
      });

      // 🆕 Mode ANNIVERSARY : substitution du/des mois de départ PASSÉS par
      // le montant d'indemnité déjà versé pour couvrir ce mois précis
      // (Leave.paidIndemnityAmount, figé par payroll-generator.service.ts /
      // payrolls.service.ts une fois le bulletin réellement généré). Sans
      // ça, ce mois (brut de travail quasi nul, l'employé étant en congé)
      // tirerait la moyenne vers le bas à chaque cycle, pour toujours — ce
      // montant EST par définition légale ce qu'il aurait gagné ce mois-là
      // (maintien de salaire), donc un substitut légitime, pas une
      // approximation. Ne concerne jamais LE cycle en cours (son propre
      // congé n'a pas encore paidIndemnityAmount renseigné à ce stade).
      // ⚠️ Un congé qui déborde sur 2 mois calendaires (ex: tout janvier +
      // quelques jours de février) ne substitue QUE le(s) mois entièrement
      // couverts (janvier) — le mois partiel (février) garde son vrai
      // bulletin, déjà correctement proratisé ailleurs (voir plus bas).
      const substitutedMonths = new Map<string, number>();
      if (cycleMode === 'ANNIVERSARY') {
        const overlappingPaidLeaves = await this.prisma.leave.findMany({
          where: {
            employeeId,
            type: 'ANNUAL',
            status: 'APPROVED',
            paidIndemnityAmount: { not: null },
            startDate: { lte: to },
            endDate: { gte: from },
          },
          select: { startDate: true, endDate: true, paidIndemnityAmount: true },
        });
        for (const pl of overlappingPaidLeaves) {
          // 🐛 CORRECTIF (exemple confirmé : congé débordant sur 2 mois —
          // ex. tout janvier + 5 jours de février) : on ne substitue QUE
          // les mois ENTIÈREMENT couverts par ce congé (aucun jour
          // travaillé). Un mois partiellement couvert (ex: février, avec un
          // retour le 6) a déjà son propre vrai bulletin, correctement
          // proratisé par le mécanisme d'absence (voir
          // attendance-summary.service.ts — daysOnLeaveAnnual exclu du
          // calcul, jours restants payés normalement) — le substituer
          // écraserait un vrai chiffre juste ET compterait l'indemnité une
          // 2e fois (une fois pour chaque mois touché), gonflant la
          // moyenne à tort.
          let cursorMonth = new Date(
            pl.startDate.getFullYear(),
            pl.startDate.getMonth(),
            1,
          );
          const lastMonth = new Date(
            pl.endDate.getFullYear(),
            pl.endDate.getMonth(),
            1,
          );
          while (cursorMonth <= lastMonth) {
            const monthStart = cursorMonth;
            const monthEnd = new Date(
              cursorMonth.getFullYear(),
              cursorMonth.getMonth() + 1,
              0,
            );
            const fullyCovered =
              pl.startDate <= monthStart && pl.endDate >= monthEnd;
            if (
              fullyCovered &&
              monthStart >= from &&
              monthStart <= to
            ) {
              substitutedMonths.set(
                `${cursorMonth.getFullYear()}-${cursorMonth.getMonth() + 1}`,
                Number(pl.paidIndemnityAmount),
              );
            }
            cursorMonth = new Date(
              cursorMonth.getFullYear(),
              cursorMonth.getMonth() + 1,
              1,
            );
          }
        }
      }
      const history_final =
        substitutedMonths.size === 0
          ? history
          : [
              // Mois réels NON substitués, tels quels.
              ...history.filter(
                (p) => !substitutedMonths.has(`${p.year}-${p.month}`),
              ),
              // Mois substitués (réel remplacé par le montant d'indemnité,
              // ou ajouté s'il n'y avait aucun bulletin réel ce mois-là).
              ...Array.from(substitutedMonths.values()).map((amount) => ({
                grossSalary: amount,
              })),
            ];

      // ✅ CORRECTIF ("le trou") : le dernier mois du cycle est justement le
      // mois de paie en cours (celui qu'on est en train de générer) — son
      // bulletin n'existe donc jamais encore en base à cet instant, et
      // `history` ne peut structurellement pas le contenir. Si l'appelant
      // nous a transmis le brut de travail de ce mois précis, on l'injecte
      // ici comme un mois de plus, uniquement s'il n'est pas déjà présent
      // (recalcul d'un bulletin déjà validé par ex.) et uniquement sur le
      // DERNIER cycle (celui qui se termine au mois de la paie).
      const isLastCycle = i === cycles.length - 1;
      const anchorAlreadyInHistory = history.some(
        (p) => p.month === refMonth && p.year === refYear,
      );
      const cycleEndsOnAnchorMonth =
        to.getFullYear() === refYear && to.getMonth() === refMonth - 1;
      const injectCurrentMonth =
        isLastCycle &&
        cycleEndsOnAnchorMonth &&
        !anchorAlreadyInHistory &&
        typeof currentMonthWorkGross === 'number' &&
        currentMonthWorkGross > 0;
      const historyCount = history_final.length + (injectCurrentMonth ? 1 : 0);

      // ✅ CORRECTIF (règle confirmée) : on divise TOUJOURS par 12, jamais
      // par le nombre de mois réellement trouvés. Ça se justifie : un congé
      // ANNUAL ne peut être dû qu'après 12 mois de présence
      // (CONGO_LEAVE.MIN_MONTHS_BEFORE_LEAVE) — "12 mois dus" n'est donc
      // jamais une supposition pour ce type de congé, c'est déjà garanti
      // ailleurs. Le numérateur ne contient que ce qu'on sait vraiment
      // (bulletins réels + substitution ANNIVERSARY + cumul d'onboarding
      // déclaré) — jamais une invention pour les mois pas encore atteints.
      // Résultat : le montant affiché est un compteur qui grandit en direct
      // au fil des bulletins validés (ex: à mi-cycle, seuls 6 mois sont
      // connus → la somme de ces 6 mois ÷ 12 donne un montant volontairement
      // bas, pas un faux "final") — jamais un repli sur le salaire de base
      // qui masquerait l'absence de vraies données.
      let avgBrut: number;
      const realTotal =
        history_final.reduce((s, p) => s + Number(p.grossSalary), 0) +
        (injectCurrentMonth ? currentMonthWorkGross! : 0);
      const declaredOpeningMonths = openingStillEligible
        ? (emp?.openingCumulativeMonths ?? 0)
        : 0;
      // Le cumul d'onboarding ne comble que les mois qui manquent pour
      // atteindre 12 (plafond légal "12 derniers mois") — jamais plus,
      // même si le cumul déclaré en couvre davantage.
      const openingMonthsUsed = Math.max(
        0,
        Math.min(declaredOpeningMonths, 12 - historyCount),
      );
      const openingGrossUsed =
        openingMonthsUsed > 0 && declaredOpeningMonths > 0
          ? Number(emp?.openingCumulativeGross ?? 0) *
            (openingMonthsUsed / declaredOpeningMonths)
          : 0;
      const monthsKnown = historyCount + openingMonthsUsed; // pour affichage/logs uniquement — jamais utilisé comme diviseur

      avgBrut = (realTotal + openingGrossUsed) / 12;
      totalMonthsUsed += historyCount; // compteur affiché = mois réels + mois courant injecté
      if (openingMonthsUsed > 0) {
        usedOpeningCumulative = true;
      }
      this.logger.log(
        `📎 Cycle ${i + 1}: ${history_final.length} bulletin(s) réel(s)` +
          (injectCurrentMonth ? ` + 1 mois courant (${currentMonthWorkGross!.toLocaleString('fr-FR')} F, pas encore en base)` : '') +
          (openingMonthsUsed > 0 ? ` + ${openingMonthsUsed} mois de cumul d'onboarding` : '') +
          ` — ${monthsKnown}/12 mois connus, somme ÷ 12 = ${Math.round(avgBrut).toLocaleString('fr-FR')} F`,
      );

      // ✅ On puise dans le solde de jours RESTANT à répartir, jamais plus —
      // avant : 26j pleins pour tout cycle non-final, quel que soit daysCount,
      // ce qui pouvait facturer bien plus de jours que la demande réelle dès
      // qu'il y avait plusieurs cycles "dus" sans historique de paie.
      const daysThisCycle = Math.min(daysPerCycle, remainingDays);
      remainingDays -= daysThisCycle;

      const dailyRate = avgBrut / CONGO_LEAVE.WORK_DAYS_PER_MONTH;
      const indemnityPartial = Math.round(dailyRate * daysThisCycle);
      totalIndemnity += indemnityPartial;

      this.logger.log(
        `💰 Cycle ${i + 1}/${cycles.length} [${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}]: ` +
          `${daysThisCycle}j × ${Math.round(dailyRate)} F/j (moy. ${Math.round(avgBrut).toLocaleString('fr-FR')} F sur ${history_final.length} mois, plafond cycle ${daysPerCycle}j${cycleSeniorityDays > 0 ? ` dont ${cycleSeniorityDays}j ancienneté` : ''}) = ${indemnityPartial} F`,
      );

      if (remainingDays <= 0) break; // plus rien à répartir sur les cycles suivants
    }

    // ✅ CORRECTIF (garde-fou) : si après avoir parcouru tous les cycles
    // trouvés il reste des jours non distribués (ex: daysCount transmis par
    // l'appelant supérieur au total réellement dû sur les cycles détectés —
    // incohérence de données en amont), on ne les laisse plus disparaître
    // silencieusement : on les indemnise sur le taux du DERNIER cycle traité
    // (le plus proche/pertinent disponible) et on log un avertissement
    // explicite pour que ce soit visible et investigable.
    if (remainingDays > 0 && cycles.length > 0) {
      const daysAlreadyPaid = daysCount - remainingDays;
      const avgDailyRateSoFar =
        daysAlreadyPaid > 0
          ? totalIndemnity / daysAlreadyPaid
          : fallbackGross / CONGO_LEAVE.WORK_DAYS_PER_MONTH;
      const indemnityPartial = Math.round(avgDailyRateSoFar * remainingDays);
      totalIndemnity += indemnityPartial;
      this.logger.warn(
        `⚠️ ${remainingDays}j restaient non distribués après ${cycles.length} cycle(s) trouvé(s) (daysCount=${daysCount} > total des plafonds de cycle) — indemnisés au taux moyen déjà calculé pour éviter une perte silencieuse, à vérifier.`,
      );
    }

    const basedOnAverage =
      totalIndemnity > 0
        ? Math.round(
            (totalIndemnity / daysCount) * CONGO_LEAVE.WORK_DAYS_PER_MONTH,
          )
        : fallbackGross;

    this.logger.log(
      `✅ Indemnité totale [${method}/glissant]: ${daysCount}j sur ${cycles.length} cycle(s) = ${totalIndemnity} F`,
    );

    return {
      indemnity: totalIndemnity,
      basedOnAverage,
      monthsUsed: totalMonthsUsed,
      cyclesCount: cycles.length,
      method,
      usedOpeningCumulative,
    };
  }

  // ============================================================================
  // 🔗 EXPORT VERS LA PAIE
  // ============================================================================

  async getLeaveImpactForPayroll(
    employeeId: string,
    month: number,
    year: number,
    // ✅ CORRECTIF ("le trou") : brut de travail du mois EN COURS (base +
    // heures sup + primes, jamais l'indemnité elle-même), transmis par
    // l'appelant quand il l'a déjà — voir calculateLeaveIndemnity().
    currentMonthWorkGross?: number,
  ): Promise<LeaveImpactForPayroll | null> {
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0);

    const leaves = await this.prisma.leave.findMany({
      where: {
        employeeId,
        status: 'APPROVED',
        OR: [
          { startDate: { gte: periodStart, lte: periodEnd } },
          { endDate: { gte: periodStart, lte: periodEnd } },
          { startDate: { lte: periodStart }, endDate: { gte: periodEnd } },
        ],
      },
    });

    // ✅ Congé ANNUAL dont le PAIEMENT est programmé sur ce mois (règle :
    // indemnité payée le mois précédant le départ, ex. décembre pour un
    // départ en janvier) — indépendant du fait que ses dates réelles
    // tombent ou non dans ce mois. C'est ce qui déclenche l'indemnité,
    // plus le chevauchement de dates.
    const payrollAnchoredLeave = await this.prisma.leave.findFirst({
      where: {
        employeeId,
        status: 'APPROVED',
        type: 'ANNUAL',
        plannedPayrollMonth: month,
        plannedPayrollYear: year,
      },
    });

    if (leaves.length === 0 && !payrollAnchoredLeave) return null;

    let leaveDays = 0;
    let anchoredLeaveDaysInPeriod = 0;
    let dominantType = leaves[0]?.type ?? payrollAnchoredLeave?.type;

    for (const leave of leaves) {
      const start =
        leave.startDate > periodStart ? leave.startDate : periodStart;
      const end = leave.endDate < periodEnd ? leave.endDate : periodEnd;
      const days = await WorkingDays.calculateWorkingDays(
        this.prisma,
        leave.companyId,
        start,
        end,
      );
      leaveDays += days;
      if (payrollAnchoredLeave && leave.id === payrollAnchoredLeave.id) {
        anchoredLeaveDaysInPeriod += days;
      }
      if (days > 0) dominantType = leave.type;
    }

    if (leaveDays === 0 && !payrollAnchoredLeave) return null;

    // ── Règle congés KonzaRH ────────────────────────────────────────────────────
    // ANNUAL       → l'indemnité n'est JAMAIS calculée sur le mois des dates
    //   réelles du congé : elle est payée UNE FOIS, sur le bulletin du mois
    //   programmé (plannedPayrollMonth, en principe le mois qui précède le
    //   départ). Sur ses dates réelles, le congé ANNUAL est neutre pour ce
    //   service (ni indemnité ni déduction ici) — la réduction de salaire liée
    //   aux jours non travaillés est déjà gérée en amont, via le module de
    //   pointage/présence (daysToPay), pas ici.
    // ANNUAL_ANTICIPATED → jamais d'indemnité à sa propre date non plus :
    //   "l'employé prend juste un repos", son coût est absorbé dans le
    //   paiement unique du congé ANNUAL qui clôt le cycle (payrollIndemnityDays
    //   = droit total du cycle, pas seulement le reliquat de CE congé-ci).
    // SICK / MATERNITY / PATERNITY / COMPENSATORY → valeurs historiques du
    //   modèle Leave, "maintien salaire" inchangé.
    // UNPAID       → déduction pure, aucune compensation (legacy également)
    const isAnnualFamily =
      dominantType === 'ANNUAL' || dominantType === 'ANNUAL_ANTICIPATED';
    const isMaintained = !isAnnualFamily && dominantType !== 'UNPAID';

    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        baseSalary: true,
        companyId: true,
      },
    });
    const companyId =
      leaves[0]?.companyId ?? payrollAnchoredLeave?.companyId ?? emp?.companyId ?? '';

    const lastPayroll = await this.prisma.payroll.findFirst({
      where: {
        employeeId,
        status: { in: ['VALIDATED', 'PAID'] },
        OR: [{ year: { lt: year } }, { year, month: { lt: month } }],
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: { grossSalary: true },
    });
    const referenceGross = lastPayroll
      ? Number(lastPayroll.grossSalary)
      : Number(emp?.baseSalary ?? 0);
    const dailyRate = referenceGross / CONGO_LEAVE.WORK_DAYS_PER_MONTH;
    // ⚠️ Ne sert plus qu'au "maintien salaire" (SICK/MATERNITY/...) — pour
    // ANNUAL/ANNUAL_ANTICIPATED on ne déduit plus jamais rien ici (voir
    // règle ci-dessus).
    const absenceDeduction = isAnnualFamily
      ? 0
      : Math.floor(dailyRate * leaveDays);

    let leaveIndemnity = 0;
    let leaveIndemnityBase = 0;
    let leaveIndemnitySeniority = 0;
    let shouldClearOpeningCumulative = false;
    let indemnifiedDays: number | undefined;
    let indemnifiedSeniorityDays: number | undefined;
    if (payrollAnchoredLeave) {
      // Mois de paiement programmé : indemnité calculée sur le droit TOTAL
      // du cycle (snapshot pris à la planification), pas sur daysCount du
      // seul congé qui clôt le cycle.
      const totalDays = payrollAnchoredLeave.payrollIndemnityDays
        ? Number(payrollAnchoredLeave.payrollIndemnityDays)
        : Number(payrollAnchoredLeave.daysCount);
      indemnifiedDays = totalDays; // ✅ pour le libellé du bulletin — pas
      // le même nombre que "leaveDays" ci-dessous, qui ne compte que les
      // jours d'absence PHYSIQUE de CE mois (ex: un congé anticipé
      // concomitant), potentiellement 0 ou très différent du droit total.
      const result = await this.calculateLeaveIndemnity(
        employeeId,
        totalDays,
        companyId,
        month,
        year,
        currentMonthWorkGross,
      );
      leaveIndemnity = result.indemnity;
      // ✅ Scinde l'indemnité en 2 (même taux journalier moyen pour les
      // deux) : "Indemnité de congé" sur les 26j de base, "Congé
      // supplémentaire" sur les jours d'ancienneté — pour 2 lignes
      // distinctes sur le bulletin, qui se suivent.
      const seniorityDays = Math.min(
        totalDays,
        Number(payrollAnchoredLeave.payrollSeniorityDays ?? 0),
      );
      indemnifiedSeniorityDays = seniorityDays; // ✅ pour la quantité de la ligne "Congé supplémentaire"
      const baseDays = Math.max(0, totalDays - seniorityDays);
      const dailyRate = totalDays > 0 ? leaveIndemnity / totalDays : 0;
      leaveIndemnityBase = Math.round(dailyRate * baseDays);
      leaveIndemnitySeniority = leaveIndemnity - leaveIndemnityBase; // ✅ pas d'arrondi qui fait perdre/gagner des F au total
      // ✅ Le cumul d'onboarding ne doit être vidé QUE quand ce calcul est
      // un vrai règlement de paie (appelé depuis la génération réelle du
      // bulletin), jamais depuis un simple aperçu (page "planning à
      // payer", qui appelle aussi cette fonction pour afficher un montant
      // estimé avant que la paie ne soit générée). C'est à l'appelant
      // (payroll-generator) de confirmer, via clearOpeningCumulativeAfterUse(),
      // une fois le bulletin réellement créé.
      shouldClearOpeningCumulative = result.usedOpeningCumulative;
    } else if (isMaintained) {
      leaveIndemnity = absenceDeduction;
      leaveIndemnityBase = absenceDeduction;
    }
    // isAnnualFamily && !payrollAnchoredLeave → leaveIndemnity reste à 0 :
    // c'est le cas "congé pris ce mois-ci mais déjà payé en décembre" (ou
    // "employé qui travaille pendant son congé") — neutre ici par design.

    // Le mois programmé (déc.) n'est pas un mois d'absence : l'employé
    // travaille normalement, l'indemnité s'ajoute à son salaire du mois,
    // elle ne le remplace pas. Si par coïncidence les dates réelles du
    // congé ancré chevauchent aussi ce mois, on retire sa propre
    // contribution de `leaveDays` — le reste (autre congé ce mois-là,
    // ex. un arrêt maladie) reste compté normalement.
    const displayLeaveDays = payrollAnchoredLeave
      ? Math.max(0, leaveDays - anchoredLeaveDaysInPeriod)
      : leaveDays;

    const presenceDays = CONGO_LEAVE.WORK_DAYS_PER_MONTH - displayLeaveDays;
    const transportRatio = Math.max(
      0,
      presenceDays / CONGO_LEAVE.WORK_DAYS_PER_MONTH,
    );

    return {
      employeeId,
      month,
      year,
      leaveDays: displayLeaveDays,
      leaveType: dominantType,
      isPaid: isAnnualFamily || isMaintained || !!payrollAnchoredLeave,
      leaveIndemnity,
      leaveIndemnityBase,
      leaveIndemnitySeniority,
      absenceDeduction,
      transportProrata: transportRatio,
      shouldClearOpeningCumulative,
      indemnifiedDays,
      indemnifiedSeniorityDays,
      leaveId: payrollAnchoredLeave?.id,
    };
  }

  /**
   * ✅ À appeler UNIQUEMENT après la création réelle et réussie d'un
   * bulletin de paie qui a consommé le cumul d'onboarding (shouldClear-
   * OpeningCumulative renvoyé par getLeaveImpactForPayroll ci-dessus).
   * JAMAIS depuis un aperçu/simulation (ex: page "planning à payer") — s'il
   * est vidé trop tôt, la vraie génération de paie qui doit encore s'en
   * servir se retrouverait sans donnée. Voir aussi : le nouveau cycle
   * démarré au retour de congé n'a de toute façon plus besoin de ce cumul,
   * qui ne représentait que "avant Konza RH" pour LE CYCLE QUI VIENT
   * D'ÊTRE RÉGLÉ.
   */
  async clearOpeningCumulativeAfterUse(employeeId: string) {
    await this.prisma.employee.update({
      where: { id: employeeId },
      data: { openingCumulativeGross: null, openingCumulativeMonths: null },
    });
  }

  // ============================================================================
  // 🔗 PROVISION POUR CONGÉS
  // ✅ CORRECTIF (demande explicite) : le but réel de cette page est double —
  //    1) dire à l'entreprise ce qu'elle devrait à l'employé sur ses congés
  //       NON PRIS s'il y avait rupture aujourd'hui (dette sociale), et
  //    2) alerter quand un employé n'a pris AUCUN congé annuel depuis trop
  //       longtemps, avec un vrai risque légal au-delà de 3 ans
  //       (CONGO_LEAVE.MAX_CUMUL_YEARS) sans départ.
  //    Avant ce correctif, seul le solde du cycle LE PLUS RÉCENT était compté
  //    (`findFirst` trié desc) — or un employé qui ne part jamais en congé
  //    accumule un NOUVEAU cycle (jusqu'à 26j + ancienneté) chaque année sans
  //    que l'ancien ne soit jamais soldé (`leaveCycleStartDate` ne bouge
  //    QUE sur un vrai congé ANNUAL validé — voir updateStatus()/createManual()).
  //    Un employé à 3 ans sans congé a donc en réalité 3 lignes LeaveBalance
  //    distinctes en base, chacune avec son propre solde non nul — la dette
  //    réelle est leur SOMME, pas seulement la plus récente. De même,
  //    l'alerte se basait sur le ratio du seul cycle courant (26-45j selon
  //    ancienneté) — un seuil qui n'a rien à voir avec le vrai risque légal
  //    des 3 ans, et qui ne se déclenchait donc quasiment jamais dans ce cas
  //    précis (voir aussi la même confusion corrigée sur /conges/soldes,
  //    qui elle reste volontairement sur le solde du cycle courant — objectif
  //    différent : "où en est ce cycle", pas "depuis quand n'est-il pas parti").
  // ============================================================================

  async getLeaveProvision(companyId: string): Promise<LeaveProvisionResult> {
    const employees = await this.prisma.employee.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        baseSalary: true,
        hireDate: true,
        leaveCycleStartDate: true,
        company: { select: { leaveCycleMode: true } },
      },
    });

    let totalProvision = 0;
    const details: LeaveProvisionResult['details'] = [];
    const now = new Date();

    for (const emp of employees) {
      // ✅ Toutes les lignes de solde, pas seulement la plus récente — un
      // cycle ancien jamais soldé (l'employé n'est jamais parti dessus)
      // reste une dette réelle tant qu'il n'a pas été consommé.
      const balances = await this.prisma.leaveBalance.findMany({
        where: { employeeId: emp.id },
      });
      const remainingDays = balances.reduce(
        (sum, b) => sum + Number(b.annualRemaining || 0),
        0,
      );
      if (remainingDays === 0) continue;

      const { basedOnAverage } = await this.calculateLeaveIndemnity(
        emp.id,
        1,
        companyId,
      );
      const dailyRate = basedOnAverage / CONGO_LEAVE.WORK_DAYS_PER_MONTH;
      const provision = Math.round(dailyRate * remainingDays);
      totalProvision += provision;

      // ✅ Ancre légale : date du dernier congé ANNUAL réellement pris (ou
      // date d'embauche si jamais pris) — c'est exactement ce que
      // `leaveCycleStartDate` représente déjà dans le reste du module.
      // 🆕 CORRECTIF : passe par resolveCycleWindow (mode-aware) au lieu de
      // lire `leaveCycleStartDate` en dur — en ANNIVERSARY, cette date de
      // retour n'est pas l'ancre pertinente pour "depuis combien de temps
      // sans congé" (c'est toujours hireDate qui fait foi).
      const cycleAnchor = resolveCycleWindow(
        new Date(emp.hireDate),
        emp.leaveCycleStartDate ? new Date(emp.leaveCycleStartDate) : null,
        undefined,
        ((emp as any)?.company?.leaveCycleMode as
          | 'ROLLING'
          | 'ANNIVERSARY') ?? 'ROLLING',
      ).cycleStartDate;
      const yearsWithoutLeave =
        (now.getTime() - cycleAnchor.getTime()) /
        (1000 * 60 * 60 * 24 * 365.25);
      const yearsRatio = yearsWithoutLeave / CONGO_LEAVE.MAX_CUMUL_YEARS;
      const alertLevel =
        yearsRatio >= CONGO_LEAVE.ALERT_THRESHOLD_CRITICAL
          ? 'CRITICAL'
          : yearsRatio >= CONGO_LEAVE.ALERT_THRESHOLD_WARNING
            ? 'WARNING'
            : 'OK';

      details.push({
        employeeId: emp.id,
        employeeName: `${emp.firstName} ${emp.lastName}`,
        remainingDays,
        dailyRate: Math.round(dailyRate),
        provision,
        alertLevel,
        yearsWithoutLeave: Math.round(yearsWithoutLeave * 10) / 10,
        maxCumulYears: CONGO_LEAVE.MAX_CUMUL_YEARS,
      });
    }

    details.sort((a, b) => b.provision - a.provision);
    return { totalProvision, currency: 'XAF', details };
  }
}