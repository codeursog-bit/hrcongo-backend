// ============================================================================
// 📁 src/leaves/leaves-indemnity.service.spec.ts
// ✅ Test d'intégration (Prisma entièrement mocké — aucune vraie base
//    nécessaire, tourne n'importe où avec `jest`) pour vérifier que
//    calculateLeaveIndemnity() se comporte réellement comme discuté :
//
//    1) Moyenne 1/12e sur des bruts qui VARIENT d'un mois à l'autre
//       (pas un salaire constant — sinon un bug de division pourrait
//       passer inaperçu si le résultat "a l'air juste" par coïncidence).
//    2) Jours d'ancienneté payés en plus, au même taux journalier (÷26).
//    3) Le diviseur est TOUJOURS 12, jamais le nombre de mois réellement
//       trouvés — règle confirmée : un congé ANNUAL n'est de toute façon
//       dû qu'après 12 mois de présence, donc "12 mois dus" n'est jamais
//       une supposition. Le montant est un compteur qui grandit en direct
//       au fil des bulletins validés (RH peut le consulter à tout instant,
//       même en cours de cycle) — currentMonthWorkGross permet juste
//       d'inclure le mois en cours dans ce compteur, même si son propre
//       bulletin n'est pas encore enregistré en base.
//    4) 3 ans sans congé : chaque cycle est moyenné indépendamment sur ses
//       12 mois à lui (avec son propre bonus d'ancienneté, qui grandit
//       dans le temps) — jamais une seule moyenne sur 36 mois.
//    5) Reprise en milieu de mois : deux cycles consécutifs ne doivent
//       jamais compter le même mois calendaire deux fois. Ce test a
//       RÉELLEMENT trouvé ce bug (frontière de cycle au jour près alors
//       que les bulletins sont mensuels) en cours d'écriture de ce
//       fichier — corrigé dans calculateLeaveIndemnity() (arrondi au 1er
//       du mois suivant quand la reprise ne tombe pas déjà un 1er).
//
//    Chaque "expected" est recalculé ICI avec une formule volontairement
//    simple et indépendante (somme ÷ nombre de mois ÷ 26 × jours), pour que
//    le test soit un vrai filet de sécurité et pas juste une copie du code
//    qu'il vérifie.
// ============================================================================

import { LeavesIndemnityService } from './leaves-indemnity.service';
import { getSeniorityDaysForConvention } from './config/leave-seniority-conventions';

// ── Petit évaluateur de clause `where` Prisma (AND/OR/gt/gte/lt/lte/in/égalité) ──
// Suffisant pour reproduire fidèlement les filtres utilisés par le vrai
// service sur `payroll.findMany` (filtre par plage année/mois).
function matchesWhere(record: any, where: any): boolean {
  if (!where) return true;
  if (Array.isArray(where.AND)) return where.AND.every((w: any) => matchesWhere(record, w));
  if (Array.isArray(where.OR)) return where.OR.some((w: any) => matchesWhere(record, w));
  return Object.entries(where).every(([field, cond]: [string, any]) => {
    const val = record[field];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('gt' in cond) return val > cond.gt;
      if ('gte' in cond) return val >= cond.gte;
      if ('lt' in cond) return val < cond.lt;
      if ('lte' in cond) return val <= cond.lte;
      if ('in' in cond) return cond.in.includes(val);
      return true;
    }
    return val === cond;
  });
}

interface FakePayroll {
  year: number;
  month: number; // 1-12
  grossSalary: number;
  status: 'VALIDATED' | 'PAID' | 'DRAFT';
}

interface ScenarioConfig {
  hireDate: Date;
  baseSalary?: number;
  appliesSeniorityBonus?: boolean;
  conventionKey?: string;
  lastAnnualLeaveEndDate?: Date | null;
  payrolls: FakePayroll[];
}

function buildMockPrisma(config: ScenarioConfig) {
  return {
    company: {
      findUnique: jest.fn(async () => ({
        leaveIndemnityMethod: 'AVERAGE_12M',
        appliesSeniorityLeaveBonus: config.appliesSeniorityBonus ?? false,
        leaveConventionKey: config.conventionKey ?? 'GENERALE',
      })),
    },
    employee: {
      findUnique: jest.fn(async () => ({
        hireDate: config.hireDate,
        baseSalary: config.baseSalary ?? 0,
        openingCumulativeGross: null,
        openingCumulativeMonths: null,
      })),
    },
    leave: {
      findFirst: jest.fn(async () =>
        config.lastAnnualLeaveEndDate ? { endDate: config.lastAnnualLeaveEndDate } : null,
      ),
    },
    payroll: {
      count: jest.fn(
        async ({ where }: any) =>
          config.payrolls.filter((p) => matchesWhere(p, where)).length,
      ),
      findMany: jest.fn(async ({ where }: any) => {
        const filtered = config.payrolls
          .filter((p) => matchesWhere(p, where))
          .sort((a, b) => (a.year - b.year) || (a.month - b.month));
        return filtered.map((p) => ({ grossSalary: p.grossSalary, month: p.month, year: p.year }));
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const filtered = config.payrolls.filter((p) => matchesWhere(p, where));
        return filtered[0] ?? null;
      }),
    },
  } as any;
}

// Formule de référence INDÉPENDANTE (pas copiée du service) : ✅ diviseur
// TOUJOURS 12 (règle confirmée — un congé ANNUAL n'est de toute façon dû
// qu'après 12 mois de présence, donc "12 mois dus" n'est jamais une
// supposition pour ce type de congé). Le numérateur ne contient que les
// mois réellement connus — jamais une invention pour le reste.
const naiveIndemnity = (knownGrosses: number[], days: number) => {
  const sum = knownGrosses.reduce((a, b) => a + b, 0);
  return Math.round((sum / 12 / 26) * days);
};

const monthsOf = (year: number, values: number[]): FakePayroll[] =>
  values.map((grossSalary, i) => ({
    year,
    month: i + 1,
    grossSalary,
    status: 'VALIDATED' as const,
  }));

describe('LeavesIndemnityService.calculateLeaveIndemnity — méthode 1/12e', () => {
  // ==========================================================================
  // Scénario A — cycle simple, bruts variables, PAS d'ancienneté
  // ==========================================================================
  it('calcule la moyenne sur 12 mois réels avec des bruts qui varient', async () => {
    const grosses = [280000, 280000, 300000, 300000, 320000, 300000, 310000, 290000, 300000, 305000, 295000, 315000];
    const prisma = buildMockPrisma({
      hireDate: new Date(2020, 0, 1),
      appliesSeniorityBonus: false,
      payrolls: monthsOf(2020, grosses.slice(0, 11)), // 11 mois déjà en base
    });
    const service = new LeavesIndemnityService(prisma);

    const result = await service.calculateLeaveIndemnity(
      'emp-A',
      26, // daysCount = 26j de base, pas d'ancienneté
      'company-A',
      12, // anchorMonth = décembre (mois de paie)
      2020, // anchorYear
      grosses[11], // ✅ 12e mois injecté (brut de travail de décembre, sans indemnité)
    );

    expect(result.indemnity).toBe(naiveIndemnity(grosses, 26));
    expect(result.monthsUsed).toBe(12);
    expect(result.cyclesCount).toBe(1);
  });

  // ==========================================================================
  // Scénario A-bis — le MÊME cas mais avec seulement 11 des 12 mois connus
  // (pas de 12e mois injecté). ✅ Comportement voulu : le diviseur reste 12
  // (jamais 11) — la somme des mois connus ÷ 12 donne un montant
  // volontairement plus bas, comme un compteur qui grandit en direct au fil
  // des bulletins validés — jamais une "moyenne" recalculée sur ce qui est
  // disponible, qui donnerait un faux air de résultat final.
  // ==========================================================================
  it('avec seulement 11 mois connus sur 12, le diviseur reste 12 (compteur qui grandit en direct)', async () => {
    const grosses = [280000, 280000, 300000, 300000, 320000, 300000, 310000, 290000, 300000, 305000, 295000];
    const prisma = buildMockPrisma({
      hireDate: new Date(2020, 0, 1),
      appliesSeniorityBonus: false,
      payrolls: monthsOf(2020, grosses),
    });
    const service = new LeavesIndemnityService(prisma);

    const result = await service.calculateLeaveIndemnity(
      'emp-A2',
      26,
      'company-A',
      12,
      2020,
      // ❌ pas de currentMonthWorkGross — seuls 11 mois sont connus à cet instant
    );

    expect(result.monthsUsed).toBe(11);
    // La somme des 11 mois connus, divisée par 12 (jamais par 11) :
    expect(result.indemnity).toBe(naiveIndemnity(grosses, 26));
    // Contrôle négatif : surtout PAS le résultat qu'on aurait avec un
    // diviseur de 11 (l'ancien comportement, à ne plus jamais revoir).
    const wrongDivideBy11 = Math.round((grosses.reduce((a, b) => a + b, 0) / 11 / 26) * 26);
    expect(result.indemnity).not.toBe(wrongDivideBy11);
  });

  // ==========================================================================
  // Scénario A-ter — "suivi en direct" : on est en mars, seuls janvier à
  // mars sont déjà payés (3 mois sur 12). Le RH doit pouvoir consulter à cet
  // instant où en est l'indemnité — un montant bas et cohérent, jamais 0 ni
  // une estimation inventée sur les 9 mois restants.
  // ==========================================================================
  it("suivi en direct à mi-cycle : 3 mois connus sur 12 donnent un montant proportionnellement bas", async () => {
    const janFevMar = [280000, 285000, 290000];
    const prisma = buildMockPrisma({
      hireDate: new Date(2020, 0, 1),
      appliesSeniorityBonus: false,
      payrolls: monthsOf(2020, janFevMar),
    });
    const service = new LeavesIndemnityService(prisma);

    const result = await service.calculateLeaveIndemnity(
      'emp-A3',
      26,
      'company-A',
      12,
      2020,
    );

    expect(result.monthsUsed).toBe(3);
    expect(result.indemnity).toBe(naiveIndemnity(janFevMar, 26));
    // Le montant doit être nettement inférieur à ce qu'on obtiendrait avec
    // 12 mois au même niveau de salaire — preuve que rien n'est "inventé"
    // pour les 9 mois restants.
    expect(result.indemnity).toBeLessThan(naiveIndemnity(Array(12).fill(285000), 26));
  });

  // ==========================================================================
  // Scénario B — ancienneté active (12 ans, convention GENERALE → 10j bonus)
  // ==========================================================================
  it("paie les jours d'ancienneté en plus, au même taux journalier (÷26, jamais ÷(26+bonus))", async () => {
    const grosses = [280000, 280000, 300000, 300000, 320000, 300000, 310000, 290000, 300000, 305000, 295000, 315000];
    const hireDate = new Date(2008, 0, 1);
    const lastAnnualLeaveEndDate = new Date(2020, 0, 1); // exactement 12 ans plus tard
    const prisma = buildMockPrisma({
      hireDate,
      appliesSeniorityBonus: true,
      conventionKey: 'GENERALE',
      lastAnnualLeaveEndDate,
      payrolls: monthsOf(2020, grosses.slice(0, 11)),
    });
    const service = new LeavesIndemnityService(prisma);

    // Jours réellement dus ce cycle = 26 + bonus d'ancienneté à la date du
    // début de cycle (calculé indépendamment ici, pas copié du service).
    const yearsAtCycleStart =
      (lastAnnualLeaveEndDate.getTime() - hireDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    const seniorityDays = getSeniorityDaysForConvention('GENERALE', yearsAtCycleStart);
    const totalDays = 26 + seniorityDays;

    const result = await service.calculateLeaveIndemnity(
      'emp-B',
      totalDays,
      'company-B',
      12,
      2020,
      grosses[11],
    );

    expect(seniorityDays).toBeGreaterThan(0); // le test doit vraiment couvrir un bonus non nul
    expect(result.indemnity).toBe(naiveIndemnity(grosses, totalDays));
    // Le taux journalier implicite doit rester avg/26, jamais avg/totalDays.
    const avg = grosses.reduce((a, b) => a + b, 0) / 12;
    const impliedDailyRate = result.indemnity / totalDays;
    expect(Math.round(impliedDailyRate)).toBe(Math.round(avg / 26));
  });

  // ==========================================================================
  // Scénario C — 3 ans sans congé : chaque cycle moyenné indépendamment,
  // avec son propre bonus d'ancienneté (qui grandit d'un cycle à l'autre),
  // et le "trou" du 12e mois sur le DERNIER cycle seulement.
  // ==========================================================================
  it('3 ans sans congé : 3 cycles moyennés séparément (jamais une seule moyenne sur 36 mois)', async () => {
    const hireDate = new Date(2009, 10, 1); // ancienneté confortable avant le 1er cycle dû
    const lastAnnualLeaveEndDate = new Date(2018, 0, 1); // dernier congé pris, retour 1er janvier 2018

    const cycle1Gross = [240000, 240000, 245000, 245000, 250000, 250000, 250000, 255000, 255000, 260000, 260000, 260000]; // 2018 — complet
    const cycle2Gross = [270000, 270000, 275000, 275000, 280000, 280000, 285000, 285000, 290000, 290000, 295000, 295000]; // 2019 — complet
    const cycle3Gross11 = [300000, 300000, 305000, 305000, 310000, 310000, 315000, 315000, 320000, 320000, 325000]; // 2020 — 11 mois seulement
    const cycle3DecInjected = 330000; // le "trou" : décembre 2020, pas encore en base

    const prisma = buildMockPrisma({
      hireDate,
      appliesSeniorityBonus: true,
      conventionKey: 'GENERALE',
      lastAnnualLeaveEndDate,
      payrolls: [
        ...monthsOf(2018, cycle1Gross),
        ...monthsOf(2019, cycle2Gross),
        ...monthsOf(2020, cycle3Gross11),
      ],
    });
    const service = new LeavesIndemnityService(prisma);

    // Bonus d'ancienneté attendu à CHAQUE début de cycle (indépendant du service).
    const yearsAt = (from: Date) => (from.getTime() - hireDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    const bonus1 = getSeniorityDaysForConvention('GENERALE', yearsAt(new Date(2018, 0, 1)));
    const bonus2 = getSeniorityDaysForConvention('GENERALE', yearsAt(new Date(2019, 0, 1)));
    const bonus3 = getSeniorityDaysForConvention('GENERALE', yearsAt(new Date(2020, 0, 1)));

    expect([bonus1, bonus2, bonus3]).toEqual([5, 5, 10]); // vérifie que le scénario couvre bien un changement de palier
    const totalDays = (26 + bonus1) + (26 + bonus2) + (26 + bonus3);

    const result = await service.calculateLeaveIndemnity(
      'emp-C',
      totalDays,
      'company-C',
      12,
      2020,
      cycle3DecInjected, // ✅ complète le 12e mois du DERNIER cycle uniquement
    );

    const expectedTotal =
      naiveIndemnity(cycle1Gross, 26 + bonus1) +
      naiveIndemnity(cycle2Gross, 26 + bonus2) +
      naiveIndemnity([...cycle3Gross11, cycle3DecInjected], 26 + bonus3);

    expect(result.cyclesCount).toBe(3);
    expect(result.monthsUsed).toBe(36); // 12 mois × 3 cycles, jamais 37/38 (bug de frontière)
    expect(result.indemnity).toBe(expectedTotal);

    // Contrôle négatif : la moyenne globale à NE PAS obtenir (36 mois divisés
    // en un seul bloc, l'erreur qu'on a écartée avec l'article Code du travail).
    const wrongSingleAverage = Math.round(
      ([...cycle1Gross, ...cycle2Gross, ...cycle3Gross11, cycle3DecInjected].reduce((a, b) => a + b, 0) / 12 / 26) *
        totalDays,
    );
    expect(result.indemnity).not.toBe(wrongSingleAverage);
  });

  // ==========================================================================
  // Scénario E — reprise en MILIEU DE MOIS (le 15, pas le 1er). Ce test a
  // réellement fait échouer une première version du code : la frontière du
  // cycle suivant retombait dans le même mois calendaire que la fin de
  // l'ancien cycle, et le bulletin de ce mois était compté dans les DEUX
  // cycles à la fois. Corrigé en arrondissant le départ de cycle au 1er du
  // mois suivant quand la reprise ne tombe pas déjà un 1er.
  // ==========================================================================
  it('reprise un 15 du mois : aucun mois calendaire compté deux fois entre deux cycles', async () => {
    const hireDate = new Date(2018, 0, 1);
    const lastAnnualLeaveEndDate = new Date(2019, 5, 15); // reprise le 15 juin 2019

    // Bulletins déjà en base pour TOUTE l'année 2019 (y compris juin 2019) —
    // le test vérifie qu'on ne va PAS piocher juin 2019 dans le cycle
    // suivant, alors que le cycle démarre bien le 1er juillet 2019.
    const year2019 = monthsOf(2019, Array(12).fill(300000));
    const year2020Partial = monthsOf(2020, Array(5).fill(320000)); // janv-mai 2020 (5 mois — juin 2020 est l'ancre, pas encore en base)

    const prisma = buildMockPrisma({
      hireDate,
      appliesSeniorityBonus: false,
      lastAnnualLeaveEndDate,
      payrolls: [...year2019, ...year2020Partial],
    });
    const service = new LeavesIndemnityService(prisma);

    const result = await service.calculateLeaveIndemnity(
      'emp-E',
      26,
      'company-E',
      6, // anchorMonth = juin 2020 (mois de paie, juste avant un départ en juillet)
      2020,
      340000, // ✅ juin 2020 injecté (le 12e mois, pas encore en base)
    );

    // Cycle attendu : 1er juillet 2019 → 30 juin 2020 (12 mois pleins :
    // juil-déc 2019 + janv-mai 2020 + juin 2020 injecté — jamais juin 2019,
    // jamais 13 mois avec un mois compté en double).
    expect(result.monthsUsed).toBe(12);
    const expectedAvg = (300000 * 6 + 320000 * 5 + 340000) / 12;
    expect(result.indemnity).toBe(Math.round((expectedAvg / 26) * 26));
  });
});