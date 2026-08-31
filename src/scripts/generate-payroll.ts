import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function generatePayroll() {
  console.log('💰 GÉNÉRATION DE LA PAIE - DÉCEMBRE 2025');
  console.log('========================================');

  const settings = await prisma.payrollSettings.findFirst();
  if (!settings) {
    console.error('❌ Paramètres de paie introuvables.');
    return;
  }

  const summaries = await prisma.attendanceSummary.findMany({
    where: { month: 12, year: 2025 },
    include: { employee: true },
  });

  for (const summary of summaries) {
    const emp = summary.employee;

    // 🛠 CONVERSION DES DÉCIMAUX EN NOMBRES
    const baseSalary = Number(emp.baseSalary);
    const ot15 = Number((summary as any).overtime15 || 0);
    const ot50 = Number((summary as any).overtime50 || 0);

    // Calcul du taux horaire (Base 173.33h/mois pour le Congo)
    const hourlyRate = baseSalary / 173.33;

    const overtimeAmount = ot15 * hourlyRate * 1.15 + ot50 * hourlyRate * 1.5;
    const grossSalary = baseSalary + overtimeAmount;

    // CNSS Salariale (4%)
    const cnssBasis = Math.min(grossSalary, 1200000);
    const cnssSalarial = cnssBasis * 0.04;

    // ITS / IRPP (Simulation 10%)
    const itsAmount = (grossSalary - cnssSalarial) * 0.1;
    const netSalary = grossSalary - cnssSalarial - itsAmount;

    // 🚀 UPSERT (Attention au nom de la table : paySlip ou payslip)
    // J'utilise une assertion 'any' sur prisma pour passer outre l'erreur de nommage si c'est PaySlip
    const payrollTable = (prisma as any).paySlip || (prisma as any).payslip;

    if (!payrollTable) {
      console.error('❌ Table de paie introuvable dans le client Prisma.');
      return;
    }

    await payrollTable.upsert({
      where: {
        employeeId_month_year: {
          employeeId: emp.id,
          month: 12,
          year: 2025,
        },
      },
      update: {
        grossSalary,
        netSalary,
        cnssSalarial,
        incomeTax: itsAmount,
        overtimeAmount,
        status: 'DRAFT',
      },
      create: {
        employeeId: emp.id,
        companyId: emp.companyId,
        month: 12,
        year: 2025,
        grossSalary,
        netSalary,
        cnssSalarial,
        incomeTax: itsAmount,
        overtimeAmount,
        baseSalary: baseSalary,
        status: 'DRAFT',
      },
    });

    console.log(
      `✅ Bulletin : ${emp.firstName} ${emp.lastName} -> Net: ${Math.round(netSalary).toLocaleString()} FCFA`,
    );
  }

  console.log('\n🎉 CALCULS TERMINÉS !');
}

generatePayroll()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
