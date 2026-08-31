// prisma/seeds/konza-demo-pointage.ts
// ============================================================================
// 🌱 SEED DE DÉMO — "KONZA DEMO SARL"
//    Objectif : 100 employés + 1 admin, avec UNIQUEMENT des pointages bruts
//    (checkIn/checkOut) du 01/09/2025 au 21/08/2026 — aucune heure normale,
//    aucune heure sup n'est pré-calculée ici : c'est à l'app de les
//    déterminer via AttendanceSummaryService au moment où vous générez
//    les résumés mensuels / la paie.
//
//    Hypothèse : l'entreprise est fondée le 01/09/2025. Tous les employés
//    sont embauchés entre le 01/09/2025 et le 15/06/2026 (vague de
//    fondation en sept-oct 2025, puis recrutements étalés).
//
//    Chaque employé reçoit un PROFIL qui détermine son pointage :
//
//    • NORMAL   (~40 employés) — présent tous les jours ouvrés (lun-sam),
//                08:00 → 16:00 (= 8h pile, donc 0 HS attendu).
//
//    • ABSENT   (~20 employés) — 1 ou 2 mois choisis où ~35% des jours
//                ouvrés n'ont AUCUN pointage (absence non justifiée —
//                aucun Leave/AbsenceRequest créé exprès, pour tester que
//                l'app les compte bien en ABSENT_UNPAID par défaut).
//                Le reste du temps : journée normale 08:00→16:00.
//
//    • OVERTIME (~20 employés) — 1 ou 2 mois choisis où ~40% des jours
//                ouvrés ont une sortie tardive (+2h à +5h), pour générer
//                des heures sup de jour (ot10/ot25) et, quand la sortie
//                dépasse 20h, des heures de nuit (ot50). Certains de ces
//                employés travaillent aussi un dimanche (jour de repos,
//                hors workDays) dans leur mois HS pour tester ot50/ot100
//                "jour de repos".
//
//    • MIXED    (~20 employés) — un mois d'absences + un mois (différent)
//                d'heures sup, pour tester les deux cas chez la même
//                personne sur l'année.
//
// Usage : npx ts-node prisma/seeds/konza-demo-pointage.ts
// ============================================================================

import {
  PrismaClient,
  Gender,
  MaritalStatus,
  ContractType,
  AttendanceStatus,
  SubscriptionPlan,
  SubscriptionStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ────────────────────────────────────────────────────────────────────────
// Fenêtre de temps
// ────────────────────────────────────────────────────────────────────────
const COMPANY_FOUNDED = new Date('2025-09-01');
const HIRE_WINDOW_END = new Date('2026-06-15'); // dernier hireDate possible
const ATTENDANCE_CUTOFF = new Date('2026-08-21'); // on s'arrête un peu avant "aujourd'hui"
const WORK_DAYS = [1, 2, 3, 4, 5, 6]; // lun-sam (convention Congo), dimanche = repos

const MONTHS: { year: number; month: number }[] = [
  { year: 2025, month: 9 },
  { year: 2025, month: 10 },
  { year: 2025, month: 11 },
  { year: 2025, month: 12 },
  { year: 2026, month: 1 },
  { year: 2026, month: 2 },
  { year: 2026, month: 3 },
  { year: 2026, month: 4 },
  { year: 2026, month: 5 },
  { year: 2026, month: 6 },
  { year: 2026, month: 7 },
  { year: 2026, month: 8 },
];

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomChoice<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}
function addDays(d: Date, days: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + days);
  return nd;
}
function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function maxDate(a: Date, b: Date): Date {
  return a > b ? a : b;
}
function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, '0');
}
function ymKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}
function pickMonths(
  eligible: { year: number; month: number }[],
  count: number,
): { year: number; month: number }[] {
  const pool = [...eligible];
  const picked: { year: number; month: number }[] = [];
  for (let k = 0; k < count && pool.length > 0; k++) {
    const idx = randomInt(0, pool.length - 1);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}
function inMonths(
  months: { year: number; month: number }[],
  year: number,
  month: number,
): boolean {
  return months.some((m) => m.year === year && m.month === month);
}

// ────────────────────────────────────────────────────────────────────────
// Données pour générer des employés variés
// ────────────────────────────────────────────────────────────────────────
const FIRST_NAMES_M = [
  'Jean', 'Pierre', 'Paul', 'Serge', 'Christian', 'Patrick', 'Rodrigue',
  'Fabrice', 'Ghislain', 'Landry', 'Merlin', 'Aristide', 'Brice', 'Fidèle',
  'Gervais', 'Herve', 'Ignace', 'Judicael', 'Kevin', 'Loic', 'Modeste',
  'Narcisse', 'Octave', 'Prince', 'Saturnin', 'Ulrich', 'Vianney', 'Wilfrid',
  'Bertrand', 'Cedric',
];
const FIRST_NAMES_F = [
  'Marie', 'Grace', 'Chancelvie', 'Benie', 'Divine', 'Prisca', 'Rosette',
  'Sandrine', 'Vanessa', 'Yvonne', 'Ange', 'Clarisse', 'Bienvenue', 'Christelle',
  'Danielle', 'Edwige', 'Fabiola', 'Gaelle', 'Huguette', 'Josiane', 'Laurentine',
  'Mireille', 'Nadege', 'Olga', 'Pelagie', 'Rachel', 'Sylvie', 'Therese',
  'Ursule', 'Viviane',
];
const LAST_NAMES = [
  'Mabiala', 'Nkounkou', 'Moukala', 'Bikindou', 'Loubassou', 'Malonga',
  'Mouyabi', 'Ngoma', 'Ondongo', 'Batantou', 'Miakassissa', 'Kaya',
  'Mavoungou', 'Bemba', 'Nzaba', 'Samba', 'Loemba', 'Mbemba', 'Tati', 'Ganga',
  'Foutou', 'Mackosso', 'Loufoua', 'Bantsimba', 'Bouiti', 'Ekouma',
  'Mabounda', 'Massamba', 'Poaty', 'Tchicaya', 'Diata', 'Kimbembe',
  'Bakekolo', 'Obami', 'Yhombi', 'Ossebi', 'Mbou', 'Ngouala', 'Elenga',
  'Nsona',
];

const DEPARTMENTS = [
  { name: 'Ressources Humaines', code: 'RH', positions: ['Assistant RH', 'Chargé de recrutement', 'Responsable RH'] },
  { name: 'Finance & Comptabilité', code: 'FIN', positions: ['Comptable', 'Contrôleur de gestion', 'Caissier'] },
  { name: 'Commercial', code: 'COM', positions: ['Chargé de clientèle', 'Commercial terrain', 'Responsable commercial'] },
  { name: 'Logistique', code: 'LOG', positions: ['Magasinier', 'Chauffeur-livreur', 'Responsable logistique'] },
  { name: 'Informatique', code: 'IT', positions: ['Développeur', 'Technicien support', 'Administrateur système'] },
  { name: 'Production & Opérations', code: 'PROD', positions: ['Agent de production', 'Superviseur d\'atelier', 'Technicien de maintenance'] },
];

type Profile = 'NORMAL' | 'ABSENT' | 'OVERTIME' | 'MIXED';

interface EmployeeSeed {
  matricule: string;
  firstName: string;
  lastName: string;
  gender: 'MALE' | 'FEMALE';
  departmentIndex: number;
  position: string;
  baseSalary: number;
  hireDate: Date;
  dateOfBirth: Date;
  maritalStatus: 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED';
  numberOfChildren: number;
  profile: Profile;
}

// ────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  🌱 Seed — KONZA DEMO (100 employés + pointages)  ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  const passwordHash = await bcrypt.hash('KonzaDemo2026!', 10);

  // ══════════════════════════════════════════════════════════════════
  // 1️⃣  ENTREPRISE
  // ══════════════════════════════════════════════════════════════════
  const company = await prisma.company.upsert({
    where: { rccmNumber: 'CG-PNR-01-2025-B99-01000' },
    update: { isActive: true },
    create: {
      legalName: 'KONZA DEMO SARL',
      tradeName: 'Konza Demo',
      rccmNumber: 'CG-PNR-01-2025-B99-01000',
      taxNumber: 'M2025B01000',
      cnssNumber: '100-1000-1',
      address: 'Avenue Charles de Gaulle',
      city: 'Pointe-Noire',
      country: 'CG',
      phone: '06 100 00 00',
      email: 'admin@konza-demo.cg',
      primaryColor: '#0EA5E9',
      secondaryColor: '#10B981',
      collectiveAgreement: 'COMMERCE',
      foundedDate: COMPANY_FOUNDED,
      workDaysPerMonth: 26,
      workHoursPerDay: 8,
      defaultAppliesCnss: true,
      defaultAppliesIrpp: true,
      appliesCnssEmployer: true,
      payrollPaymentDay: 30,
      payrollCloseDay: 25,
      isActive: true,
    },
  });
  console.log(`✅ Entreprise   : ${company.legalName} (id: ${company.id})`);

  // ══════════════════════════════════════════════════════════════════
  // 2️⃣  ABONNEMENT PRO
  // ══════════════════════════════════════════════════════════════════
  const periodStart = new Date('2025-09-01T00:00:00Z');
  const periodEnd = new Date('2026-12-31T23:59:59Z');

  await prisma.subscription.upsert({
    where: { companyId: company.id },
    update: {
      plan: SubscriptionPlan.PRO,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      pricePerMonth: 65000,
      currency: 'XAF',
    },
    create: {
      companyId: company.id,
      plan: SubscriptionPlan.PRO,
      status: SubscriptionStatus.ACTIVE,
      startDate: periodStart,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      pricePerMonth: 65000,
      currency: 'XAF',
    },
  });
  console.log('✅ Abonnement   : PRO — ACTIVE');

  // ══════════════════════════════════════════════════════════════════
  // 3️⃣  PARAMÈTRES DE PAIE / POINTAGE
  //     officialStartHour=8 + workHoursPerDay=8 → fin officielle = 16h
  //     (c'est CE calcul, pas officialEndHour, qui sert de référence HS)
  // ══════════════════════════════════════════════════════════════════
  const existingSettings = await prisma.payrollSettings.findFirst({
    where: { companyId: company.id },
  });
  if (!existingSettings) {
    await prisma.payrollSettings.create({
      data: {
        companyId: company.id,
        cnssSalarialRate: 4,
        cnssEmployerRate: 20.28,
        cnssPensionCeiling: 1200000,
        cnssSocialCeiling: 600000,
        overtimeRate10: 10,
        overtimeRate25: 25,
        overtimeRate50: 50,
        overtimeRate100: 100,
        workDaysPerMonth: 26,
        workHoursPerDay: 8,
        officialStartHour: 8,
        officialEndHour: 16,
        lateToleranceMinutes: 15,
        overtimeEnabled: true,
        nightShiftEnabled: true,
        cnssRounding: 'UP',
        itsRounding: 'UP',
        fiscalMode: 'AUTO',
        forfaitItsRate: 0.08,
        workDays: WORK_DAYS,
      },
    });
    console.log('✅ PayrollSettings créés (08:00→16:00, lun-sam)');
  } else {
    console.log('ℹ️  PayrollSettings déjà présents — skipped');
  }

  // ══════════════════════════════════════════════════════════════════
  // 4️⃣  ADMIN
  // ══════════════════════════════════════════════════════════════════
  await prisma.user.upsert({
    where: { email: 'admin@konza-demo.cg' },
    update: {},
    create: {
      email: 'admin@konza-demo.cg',
      password: passwordHash,
      firstName: 'Admin',
      lastName: 'Demo',
      role: 'ADMIN',
      companyId: company.id,
    },
  });
  console.log('✅ Admin        : admin@konza-demo.cg / KonzaDemo2026!');

  // ══════════════════════════════════════════════════════════════════
  // 5️⃣  DÉPARTEMENTS
  // ══════════════════════════════════════════════════════════════════
  const departmentIds: string[] = [];
  for (const dept of DEPARTMENTS) {
    const d = await prisma.department.upsert({
      where: { companyId_code: { companyId: company.id, code: dept.code } },
      update: {},
      create: { name: dept.name, code: dept.code, companyId: company.id },
    });
    departmentIds.push(d.id);
  }
  console.log(`✅ Départements : ${DEPARTMENTS.length} créés`);

  // ══════════════════════════════════════════════════════════════════
  // 6️⃣  GÉNÉRATION DES 100 EMPLOYÉS (profils + hireDate étalées)
  // ══════════════════════════════════════════════════════════════════
  const TOTAL_EMPLOYEES = 100;
  const employeeSeeds: EmployeeSeed[] = [];

  for (let i = 0; i < TOTAL_EMPLOYEES; i++) {
    const gender: 'MALE' | 'FEMALE' = i % 2 === 0 ? 'MALE' : 'FEMALE';
    const firstName =
      gender === 'MALE'
        ? FIRST_NAMES_M[i % FIRST_NAMES_M.length]
        : FIRST_NAMES_F[i % FIRST_NAMES_F.length];
    const lastName = LAST_NAMES[(i * 7) % LAST_NAMES.length];

    const deptIndex = i % DEPARTMENTS.length;
    const position = randomChoice(DEPARTMENTS[deptIndex].positions);

    // ── hireDate étalée : vague de fondation, puis recrutements progressifs
    let hireDate: Date;
    if (i < 30) {
      // vague de fondation : sept-oct 2025
      hireDate = addDays(COMPANY_FOUNDED, randomInt(0, 60));
    } else if (i < 70) {
      // nov 2025 → mars 2026
      hireDate = addDays(new Date('2025-11-01'), randomInt(0, 150));
    } else {
      // avr → mi-juin 2026
      hireDate = addDays(new Date('2026-04-01'), randomInt(0, 75));
    }
    if (hireDate > HIRE_WINDOW_END) hireDate = HIRE_WINDOW_END;

    // ── profil (répartition ~40 NORMAL / 20 ABSENT / 20 OVERTIME / 20 MIXED)
    const profileRoll = i % 5;
    const profile: Profile =
      profileRoll === 0 ? 'OVERTIME' : profileRoll === 1 ? 'ABSENT' : profileRoll === 2 ? 'MIXED' : 'NORMAL';

    employeeSeeds.push({
      matricule: `KRH-${String(i + 1).padStart(3, '0')}`,
      firstName,
      lastName,
      gender,
      departmentIndex: deptIndex,
      position,
      baseSalary: 150000 + randomInt(0, 70) * 5000, // 150k → 500k
      hireDate,
      dateOfBirth: new Date(1970 + randomInt(0, 30), randomInt(0, 11), randomInt(1, 28)),
      maritalStatus: randomChoice(['SINGLE', 'MARRIED', 'SINGLE', 'DIVORCED']),
      numberOfChildren: randomInt(0, 4),
      profile,
    });
  }

  console.log('');
  console.log('── Création des employés ────────────────────────────');

  const employeeIds: Record<string, string> = {};

  for (const emp of employeeSeeds) {
    const phoneSuffix = String(600000 + parseInt(emp.matricule.slice(4), 10)).padStart(6, '0');
    const phone = `+242 06 ${phoneSuffix.slice(0, 3)} ${phoneSuffix.slice(3)}`;
    const email = `${emp.matricule.toLowerCase()}@konza-demo.cg`;

    const employee = await prisma.employee.upsert({
      where: {
        employeeNumber_companyId: {
          employeeNumber: emp.matricule,
          companyId: company.id,
        },
      },
      update: {
        hireDate: emp.hireDate,
        baseSalary: emp.baseSalary,
      },
      create: {
        employeeNumber: emp.matricule,
        firstName: emp.firstName,
        lastName: emp.lastName,
        email,
        phone,
        dateOfBirth: emp.dateOfBirth,
        placeOfBirth: 'Pointe-Noire',
        gender: emp.gender as Gender,
        contractType: ContractType.CDI,
        address: 'Pointe-Noire',
        city: 'Pointe-Noire',
        position: emp.position,
        professionalCategory: 'Cat.2 Éch.1',
        baseSalary: emp.baseSalary,
        departmentId: departmentIds[emp.departmentIndex],
        maritalStatus: emp.maritalStatus as MaritalStatus,
        numberOfChildren: emp.numberOfChildren,
        cnssNumber: `CN-${emp.matricule}`,
        hireDate: emp.hireDate,
        paymentMethod: 'BANK_TRANSFER',
        isSubjectToCnss: true,
        isSubjectToIrpp: true,
        isSubjectToTus: true,
        companyId: company.id,
        status: 'ACTIVE',
        isResident: true,
        nationality: 'CG',
        tolZone: 'VILLE',
        trialStatus: 'NONE',
      },
    });

    employeeIds[emp.matricule] = employee.id;
  }
  console.log(`✅ ${employeeSeeds.length} employés créés/à jour`);

  // ══════════════════════════════════════════════════════════════════
  // 7️⃣  POINTAGES — 01/09/2025 → 21/08/2026
  //     Aucun champ calculé (totalHours/normalHours/overtimeXX) n'est
  //     rempli ici : seuls status + checkIn + checkOut sont posés.
  // ══════════════════════════════════════════════════════════════════
  console.log('');
  console.log('── Génération des pointages (peut prendre 1-2 min) ──');

  const landmarks: { matricule: string; profile: Profile; months: string }[] = [];

  type AttendanceRow = {
    employeeId: string;
    companyId: string;
    date: string;
    status: AttendanceStatus;
    checkIn: Date;
    checkOut: Date;
  };

  let buffer: AttendanceRow[] = [];
  let totalRows = 0;
  const CHUNK_SIZE = 2000;

  async function flush() {
    if (buffer.length === 0) return;
    await prisma.attendance.createMany({ data: buffer, skipDuplicates: true });
    totalRows += buffer.length;
    buffer = [];
  }

  for (const emp of employeeSeeds) {
    const employeeId = employeeIds[emp.matricule];
    const startDate = maxDate(emp.hireDate, COMPANY_FOUNDED);

    // Mois où l'employé était déjà en poste (pour tirer les mois spéciaux)
    const eligibleMonths = MONTHS.filter((m) => {
      const monthEnd = new Date(m.year, m.month, 0); // dernier jour du mois
      return monthEnd >= startDate;
    });

    let absentMonths: { year: number; month: number }[] = [];
    let overtimeMonths: { year: number; month: number }[] = [];

    if (emp.profile === 'ABSENT') {
      absentMonths = pickMonths(eligibleMonths, Math.random() < 0.25 ? 2 : 1);
    } else if (emp.profile === 'OVERTIME') {
      overtimeMonths = pickMonths(eligibleMonths, Math.random() < 0.25 ? 2 : 1);
    } else if (emp.profile === 'MIXED') {
      absentMonths = pickMonths(eligibleMonths, 1);
      const remaining = eligibleMonths.filter(
        (m) => !inMonths(absentMonths, m.year, m.month),
      );
      overtimeMonths = pickMonths(remaining.length ? remaining : eligibleMonths, 1);
    }

    if (emp.profile !== 'NORMAL') {
      landmarks.push({
        matricule: emp.matricule,
        profile: emp.profile,
        months: [
          ...absentMonths.map((m) => `absent:${m.year}-${pad2(m.month)}`),
          ...overtimeMonths.map((m) => `HS:${m.year}-${pad2(m.month)}`),
        ].join(', '),
      });
    }

    // Un dimanche "travaillé" en plus pour ~1 employé OVERTIME sur 3
    // (teste le bucket ot50/ot100 "jour de repos")
    const sundayBonusMonth =
      (emp.profile === 'OVERTIME' || emp.profile === 'MIXED') &&
      overtimeMonths.length > 0 &&
      Math.random() < 0.35
        ? randomChoice(overtimeMonths)
        : null;

    for (let d = new Date(startDate); d <= ATTENDANCE_CUTOFF; d = addDays(d, 1)) {
      const dow = d.getDay();
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const ds = dateStr(d);

      if (!WORK_DAYS.includes(dow)) continue; // dimanche = repos, géré à part plus bas

      const isAbsentMonth = inMonths(absentMonths, year, month);
      const isOvertimeMonth = inMonths(overtimeMonths, year, month);

      if (isAbsentMonth && Math.random() < 0.35) {
        continue; // pas de pointage → absence non justifiée (ABSENT_UNPAID auto)
      }

      let checkOutHour = 16;
      let checkOutMin = 0;
      if (isOvertimeMonth && Math.random() < 0.4) {
        const extraHours = randomChoice([2, 2.5, 3, 3.5, 4, 5]);
        const total = 16 + extraHours;
        checkOutHour = Math.floor(total);
        checkOutMin = Math.round((total - checkOutHour) * 60);
      }

      buffer.push({
        employeeId,
        companyId: company.id,
        date: ds,
        status: AttendanceStatus.PRESENT,
        checkIn: new Date(`${ds}T08:00:00Z`),
        checkOut: new Date(`${ds}T${pad2(checkOutHour)}:${pad2(checkOutMin)}:00Z`),
      });

      if (buffer.length >= CHUNK_SIZE) await flush();
    }

    // ── Dimanche bonus (jour de repos travaillé) ─────────────────────────
    if (sundayBonusMonth) {
      const lastDay = new Date(sundayBonusMonth.year, sundayBonusMonth.month, 0).getDate();
      const sundays: Date[] = [];
      for (let day = 1; day <= lastDay; day++) {
        const cand = new Date(sundayBonusMonth.year, sundayBonusMonth.month - 1, day);
        if (cand.getDay() === 0 && cand >= startDate && cand <= ATTENDANCE_CUTOFF) {
          sundays.push(cand);
        }
      }
      if (sundays.length > 0) {
        const sunday = randomChoice(sundays);
        const ds = dateStr(sunday);
        const lateNight = Math.random() < 0.4; // certains vont jusqu'à tard (ot100)
        buffer.push({
          employeeId,
          companyId: company.id,
          date: ds,
          status: AttendanceStatus.PRESENT,
          checkIn: new Date(`${ds}T08:00:00Z`),
          checkOut: new Date(`${ds}T${lateNight ? '21:00:00' : '14:00:00'}Z`),
        });
        if (buffer.length >= CHUNK_SIZE) await flush();
      }
    }
  }

  await flush();
  console.log(`✅ ${totalRows} pointages créés`);

  // ══════════════════════════════════════════════════════════════════
  // ✅  RÉSUMÉ FINAL
  // ══════════════════════════════════════════════════════════════════
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉  Seed terminé avec succès !');
  console.log('');
  console.log('  🏢 Entreprise  : KONZA DEMO SARL (fondée 01/09/2025)');
  console.log('  👤 Admin       : admin@konza-demo.cg / KonzaDemo2026!');
  console.log(`  👥 Employés    : ${employeeSeeds.length} (embauchés entre 01/09/2025 et 15/06/2026)`);
  console.log('  🕒 Pointages   : 01/09/2025 → 21/08/2026, lun-sam, checkIn/checkOut uniquement');
  console.log('');
  console.log('  ➡️  À FAIRE MANUELLEMENT DEPUIS L’APP POUR TESTER :');
  console.log('     1. Ouvrir "Pointages" pour quelques employés ci-dessous et');
  console.log('        vérifier que les jours sans pointage remontent bien en');
  console.log('        ABSENT_UNPAID (pas d’AbsenceRequest créée exprès).');
  console.log('     2. Générer le résumé mensuel / la paie sur les mois listés');
  console.log('        pour vérifier ot10/ot25 (jour) et ot50/ot100 (nuit ou');
  console.log('        dimanche travaillé).');
  console.log('     3. Comparer un employé NORMAL sur le même mois : ses HS');
  console.log('        doivent rester à 0 (08:00→16:00 = 8h pile, jamais dépassé).');
  console.log('');
  console.log('  📋 Quelques employés à surveiller en priorité :');
  for (const lm of landmarks.slice(0, 12)) {
    console.log(`     • ${lm.matricule} [${lm.profile}] → ${lm.months}`);
  }
  console.log(`     … et ${Math.max(0, landmarks.length - 12)} autres profils ABSENT/OVERTIME/MIXED.`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((e) => {
    console.error('❌ Erreur seed :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });