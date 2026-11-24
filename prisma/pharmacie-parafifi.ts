// prisma/seeds/pharmacie-parafifi.ts
// prisma/seeds/pharmacie-parafifi.ts
// ============================================================================
// 🌱 SEED — PHARMACIE PLACE PARAFIFI
//    ✅ Entreprise + Admin
//    ✅ Abonnement PRO
//    ✅ PayrollSettings
//    ✅ 8 Employés (CDI, grille PH) — professionalCategory au format "Cat.X Éch.Y"
// ============================================================================

import {
  PrismaClient,
  MaritalStatus,
  ContractType,
  Gender,
  SubscriptionPlan,
  SubscriptionStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ─── GRILLE SALARIALE PHARMACIE — clés au format "Cat.X Éch.Y" ──────────────
const GRILLE: Record<string, number> = {
  'Cat.1 Éch.1': 57380,  'Cat.1 Éch.2': 58655,  'Cat.1 Éch.3': 59820,  'Cat.1 Éch.4': 61095,
  'Cat.2 Éch.1': 63430,  'Cat.2 Éch.2': 64595,  'Cat.2 Éch.3': 65760,  'Cat.2 Éch.4': 66925,
  'Cat.3 Éch.1': 73835,  'Cat.3 Éch.2': 76960,  'Cat.3 Éch.3': 80080,  'Cat.3 Éch.4': 83205,
  'Cat.4 Éch.1': 90245,  'Cat.4 Éch.2': 93635,  'Cat.4 Éch.3': 97020,  'Cat.4 Éch.4': 100410,
  'Cat.5 Éch.1': 110840, 'Cat.5 Éch.2': 114800, 'Cat.5 Éch.3': 118760, 'Cat.5 Éch.4': 122720,
  'Cat.6 Éch.1': 131080, 'Cat.6 Éch.2': 132400, 'Cat.6 Éch.3': 133940, 'Cat.6 Éch.4': 135040,
  'Cat.7 Éch.1': 165000,
  'Cat.8 Éch.1': 198000, 'Cat.8 Éch.2': 217800,
  'Cat.9 Éch.1': 247500,
  'Cat.10 Éch.1': 357500,
};

// Cache département name → id
const deptIds: Record<string, string> = {};

async function upsertDepartment(name: string, companyId: string): Promise<string> {
  if (deptIds[name]) return deptIds[name];
  const dept = await prisma.department.upsert({
    where: { companyId_code: { companyId, code: name.toUpperCase().slice(0, 20) } },
    update: {},
    create: {
      name,
      code:      name.toUpperCase().slice(0, 20),
      companyId,
    },
  });
  deptIds[name] = dept.id;
  return dept.id;
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  🌱 Seed — PHARMACIE PLACE PARAFIFI              ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  const passwordHash = await bcrypt.hash('Parafifi2025!', 10);

  // ══════════════════════════════════════════════════════════════════
  // 1️⃣  ENTREPRISE
  // ══════════════════════════════════════════════════════════════════
  const company = await prisma.company.upsert({
    where:  { rccmNumber: 'CG-PNR-01-2001-B12-00234' },
    update: {
      taxNumber: 'M2001B00234',
      isActive:  true,
    },
    create: {
      legalName:           'PHARMACIE PLACE PARAFIFI',
      tradeName:           'PHARMACIE PARAFIFI',
      rccmNumber:          'CG-PNR-01-2001-B12-00234',
      taxNumber:           'M2001B00234',
      cnssNumber:          '001-9019-0',
      address:             'Avenue COSTADE ZACHARIE',
      city:                'Pointe-Noire',
      country:             'CG',
      phone:               '06 907 80 30',
      email:               'pharmacie.parafifi@gmail.com',
      primaryColor:        '#0EA5E9',
      secondaryColor:      '#10B981',
      collectiveAgreement: 'PHARMACIE',
      workDaysPerMonth:    26,
      workHoursPerDay:     8,
      defaultAppliesCnss:  true,
      defaultAppliesIrpp:  true,
      appliesCnssEmployer: true,
      payrollPaymentDay:   30,
      payrollCloseDay:     25,
      isActive:            true,
    },
  });
  console.log(`✅ Entreprise   : ${company.legalName} (id: ${company.id})`);

  // ══════════════════════════════════════════════════════════════════
  // 2️⃣  ABONNEMENT PRO
  // ══════════════════════════════════════════════════════════════════
  const periodStart = new Date('2026-01-01T00:00:00Z');
  const periodEnd   = new Date('2026-12-31T23:59:59Z');

  const subscription = await prisma.subscription.upsert({
    where:  { companyId: company.id },
    update: {
      plan:               SubscriptionPlan.PRO,
      status:             SubscriptionStatus.ACTIVE,
      currentPeriodStart: periodStart,
      currentPeriodEnd:   periodEnd,
      pricePerMonth:      65000,
      currency:           'XAF',
    },
    create: {
      companyId:          company.id,
      plan:               SubscriptionPlan.PRO,
      status:             SubscriptionStatus.ACTIVE,
      startDate:          periodStart,
      currentPeriodStart: periodStart,
      currentPeriodEnd:   periodEnd,
      pricePerMonth:      65000,
      currency:           'XAF',
    },
  });
  console.log(`✅ Abonnement   : ${subscription.plan} — ${subscription.status} (${subscription.pricePerMonth.toLocaleString()} XAF/mois)`);

  // ══════════════════════════════════════════════════════════════════
  // 3️⃣  PARAMÈTRES DE PAIE
  // ══════════════════════════════════════════════════════════════════
  const existingSettings = await prisma.payrollSettings.findFirst({
    where: { companyId: company.id },
  });

  if (!existingSettings) {
    await prisma.payrollSettings.create({
      data: {
        companyId:            company.id,
        cnssSalarialRate:     4,
        cnssEmployerRate:     20.28,
        cnssPensionCeiling:   1200000,
        cnssSocialCeiling:    600000,
        overtimeRate10:       10,
        overtimeRate25:       25,
        overtimeRate50:       50,
        overtimeRate100:      100,
        workDaysPerMonth:     26,
        workHoursPerDay:      8,
        officialStartHour:    8,
        officialEndHour:      17,
        lateToleranceMinutes: 15,
        overtimeEnabled:      true,
        nightShiftEnabled:    false,
        cnssRounding:         'UP',
        itsRounding:          'UP',
        fiscalMode:           'AUTO',
        forfaitItsRate:       0.08,
        workDays:             [1, 2, 3, 4, 5, 6],
      },
    });
    console.log('✅ PayrollSettings créés');
  } else {
    console.log('ℹ️  PayrollSettings déjà présents — skipped');
  }

  // ══════════════════════════════════════════════════════════════════
  // 4️⃣  ADMIN
  // ══════════════════════════════════════════════════════════════════
  await prisma.user.upsert({
    where:  { email: 'admin@parafifi.cg' },
    update: {},
    create: {
      email:     'admin@parafifi.cg',
      password:  passwordHash,
      firstName: 'Directeur',
      lastName:  'PARAFIFI',
      role:      'ADMIN',
      companyId: company.id,
    },
  });
  console.log('✅ Admin        : admin@parafifi.cg / Parafifi2025!');

  // ══════════════════════════════════════════════════════════════════
  // 5️⃣  EMPLOYÉS
  //     professionalCategory → format "Cat.X Éch.Y" (label convention)
  // ══════════════════════════════════════════════════════════════════
  const EMPLOYES = [
    {
      matricule:            'PPP01901',
      firstName:            'Guy',
      lastName:             'DIKOBAT',
      email:                'guy.dikobat@parafifi.cg',
      gender:               Gender.MALE,
      position:             'Réparateur',
      department:           'Technique',
      professionalCategory: 'Cat.6 Éch.4',
      maritalStatus:        MaritalStatus.SINGLE,
      numberOfChildren:     3,
      cnssNumber:           'CN-001901-PNR',
      hireDate:             new Date('2015-03-01'),
      dateOfBirth:          new Date('1985-06-15'),
    },
    {
      matricule:            'PPP01902',
      firstName:            'Chacelle',
      lastName:             'POATY-NTOULA',
      email:                'chacelle.poaty@parafifi.cg',
      gender:               Gender.FEMALE,
      position:             'Vendeuse',
      department:           'Vente',
      professionalCategory: 'Cat.5 Éch.2',
      maritalStatus:        MaritalStatus.SINGLE,
      numberOfChildren:     1,
      cnssNumber:           'CN-001902-PNR',
      hireDate:             new Date('2019-06-15'),
      dateOfBirth:          new Date('1994-03-22'),
    },
    {
      matricule:            'PPP0200',
      firstName:            'Henriette Patricia',
      lastName:             'MASSIALA',
      email:                'henriette.massiala@parafifi.cg',
      gender:               Gender.FEMALE,
      position:             'Vendeuse',
      department:           'Vente',
      professionalCategory: 'Cat.4 Éch.1',
      maritalStatus:        MaritalStatus.SINGLE,
      numberOfChildren:     3,
      cnssNumber:           'CN-002000-PNR',
      hireDate:             new Date('2018-01-10'),
      dateOfBirth:          new Date('1991-11-05'),
    },
    {
      matricule:            'PPP0201',
      firstName:            'Monica Velaine',
      lastName:             'NGOURIAKAK',
      email:                'monica.ngouriakak@parafifi.cg',
      gender:               Gender.FEMALE,
      position:             'Vendeuse',
      department:           'Vente',
      professionalCategory: 'Cat.4 Éch.1',
      maritalStatus:        MaritalStatus.SINGLE,
      numberOfChildren:     2,
      cnssNumber:           'CN-002001-PNR',
      hireDate:             new Date('2020-09-01'),
      dateOfBirth:          new Date('1996-07-18'),
    },
    {
      matricule:            'PPP0202',
      firstName:            'Alain',
      lastName:             'LOMBO-MAVOUNGOU',
      email:                'alain.lombo@parafifi.cg',
      gender:               Gender.MALE,
      position:             'Gardien',
      department:           'Sécurité',
      professionalCategory: 'Cat.3 Éch.2',
      maritalStatus:        MaritalStatus.SINGLE,
      numberOfChildren:     3,
      cnssNumber:           'CN-002002-PNR',
      hireDate:             new Date('2017-04-20'),
      dateOfBirth:          new Date('1988-02-10'),
    },
    {
      matricule:            'PPP0203',
      firstName:            'Princia',
      lastName:             'GOMA-LASSY',
      email:                'princia.goma@parafifi.cg',
      gender:               Gender.FEMALE,
      position:             'Commis Vendeuse',
      department:           'Vente',
      professionalCategory: 'Cat.3 Éch.1',
      maritalStatus:        MaritalStatus.SINGLE,
      numberOfChildren:     2,
      cnssNumber:           'CN-002003-PNR',
      hireDate:             new Date('2021-02-01'),
      dateOfBirth:          new Date('1998-09-30'),
    },
    {
      matricule:            'PPP0204',
      firstName:            'Destin H.',
      lastName:             'PANDHET-BALOU',
      email:                'destin.pandhet@parafifi.cg',
      gender:               Gender.MALE,
      position:             "Agent d'entretien",
      department:           'Entretien',
      professionalCategory: 'Cat.3 Éch.1',
      maritalStatus:        MaritalStatus.SINGLE,
      numberOfChildren:     3,
      cnssNumber:           'CN-002004-PNR',
      hireDate:             new Date('2022-07-15'),
      dateOfBirth:          new Date('1997-04-12'),
    },
    {
      matricule:            'PPP0205',
      firstName:            'Alda',
      lastName:             'OUMBA-MAKENZO',
      email:                'alda.oumba@parafifi.cg',
      gender:               Gender.FEMALE,
      position:             'Commis Vendeuse',
      department:           'Vente',
      professionalCategory: 'Cat.3 Éch.1',
      maritalStatus:        MaritalStatus.MARRIED,
      numberOfChildren:     0,
      cnssNumber:           'CN-002005-PNR',
      hireDate:             new Date('2023-01-03'),
      dateOfBirth:          new Date('1999-12-01'),
    },
  ];

  const now = new Date();
  console.log('');
  console.log('── Employés ─────────────────────────────────────────');

  for (const emp of EMPLOYES) {
    const baseSalary = GRILLE[emp.professionalCategory];
    if (!baseSalary) throw new Error(`Catégorie inconnue dans la grille : ${emp.professionalCategory}`);

    const departmentId = await upsertDepartment(emp.department, company.id);

    // ── User ──────────────────────────────────────────────────────────────
    const user = await prisma.user.upsert({
      where:  { email: emp.email },
      update: {},
      create: {
        email:     emp.email,
        password:  passwordHash,
        firstName: emp.firstName,
        lastName:  emp.lastName,
        role:      'EMPLOYEE',
        companyId: company.id,
      },
    });

    // ── Employee ──────────────────────────────────────────────────────────
    const employee = await prisma.employee.upsert({
      where: {
        employeeNumber_companyId: {
          employeeNumber: emp.matricule,
          companyId:      company.id,
        },
      },
      update: {
        maritalStatus:        emp.maritalStatus,
        numberOfChildren:     emp.numberOfChildren,
        professionalCategory: emp.professionalCategory,
        baseSalary,
        isSubjectToCnss:      true,
        isSubjectToIrpp:      true,
      },
      create: {
        employeeNumber:       emp.matricule,
        firstName:            emp.firstName,
        lastName:             emp.lastName,
        email:                emp.email,
        dateOfBirth:          emp.dateOfBirth,
        placeOfBirth:         'Pointe-Noire',
        gender:               emp.gender,
        contractType:         ContractType.CDI,
        phone:                '06 000 00 00',
        address:              'Pointe-Noire',
        city:                 'Pointe-Noire',
        position:             emp.position,
        professionalCategory: emp.professionalCategory,
        baseSalary,
        departmentId,
        maritalStatus:        emp.maritalStatus,
        numberOfChildren:     emp.numberOfChildren,
        cnssNumber:           emp.cnssNumber,
        hireDate:             emp.hireDate,
        paymentMethod:        'BANK_TRANSFER',
        isSubjectToCnss:      true,
        isSubjectToIrpp:      true,
        isSubjectToTus:       true,
        companyId:            company.id,
        status:               'ACTIVE',
        isResident:           true,
        nationality:          'CG',
        tolZone:              'VILLE',
        trialStatus:          'NONE',
      },
    });

    // ── Lier User → Employee ──────────────────────────────────────────────
    await prisma.user.update({
      where: { id: user.id },
      data:  { employeeId: employee.id },
    });

    const yearsService = Math.floor(
      (now.getTime() - emp.hireDate.getTime()) / (1000 * 60 * 60 * 24 * 365),
    );
    console.log(
      `  ✅ ${emp.matricule.padEnd(10)} ${(emp.firstName + ' ' + emp.lastName).padEnd(30)} ` +
      `${emp.professionalCategory.padEnd(14)} ${baseSalary.toLocaleString('fr-FR').padStart(10)} FCFA  ` +
      `(${yearsService} an${yearsService > 1 ? 's' : ''})`,
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // ✅  RÉSUMÉ FINAL
  // ══════════════════════════════════════════════════════════════════
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉  Seed terminé avec succès !');
  console.log('');
  console.log('  🏢 Entreprise  : PHARMACIE PLACE PARAFIFI');
  console.log('  📦 Abonnement  : PRO — 65 000 XAF/mois (jan–déc 2026)');
  console.log('  👤 Admin       : admin@parafifi.cg  /  Parafifi2025!');
  console.log('  👥 Employés    : 8');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch(e => {
    console.error('❌ Erreur seed :', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());