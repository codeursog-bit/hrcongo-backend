import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🔄 RÉGÉNÉRATION DES RÉSUMÉS - MODE COMPATIBILITÉ');
  console.log('================================================');

  const month = 12;
  const year = 2025;

  // On prépare les strings pour la comparaison (Format YYYY-MM-DD)
  const startDateStr = `${year}-12-01`;
  const endDateStr = `${year}-12-31`;

  const employees = await prisma.employee.findMany();
  console.log(`👥 ${employees.length} employés à traiter.`);

  for (const emp of employees) {
    // 🔍 Recherche avec des strings car ton schéma utilise String pour la date
    const logs = await prisma.attendance.findMany({
      where: {
        employeeId: emp.id,
        date: {
          gte: startDateStr,
          lte: endDateStr,
        },
      },
    });

    if (logs.length === 0) {
      console.log(`   ℹ️  ${emp.firstName} ${emp.lastName} : Aucun pointage.`);
      continue;
    }

    // On utilise "as string" pour contourner le problème de l'Enum manquant
    const summary = {
      daysPresent: logs.filter((l) => (l.status as string) === 'PRESENT')
        .length,
      daysRemote: logs.filter((l) => (l.status as string) === 'REMOTE').length,
      daysOnLeave: logs.filter((l) => (l.status as string) === 'LEAVE').length,
      daysLate: logs.filter((l) => (l.status as string) === 'LATE').length,
    };

    await prisma.attendanceSummary.upsert({
      where: {
        employeeId_month_year: {
          employeeId: emp.id,
          month: month,
          year: year,
        },
      },
      update: {
        ...summary,
        generatedAt: new Date(),
      },
      create: {
        employeeId: emp.id,
        month: month,
        year: year,
        ...summary,
        generatedAt: new Date(),
      },
    });

    console.log(
      `✅ Résumé généré pour : ${emp.firstName} ${emp.lastName} (${logs.length} jours)`,
    );
  }
}

main()
  .catch((e) => console.error('❌ Erreur:', e))
  .finally(async () => {
    await prisma.$disconnect();
    console.log('\n🏁 Fin du script.');
  });
