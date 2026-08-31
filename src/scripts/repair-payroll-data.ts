// ============================================================================
// 📁 src/scripts/repair-payroll-data.ts
// ✅ CONFORME DÉCRET 78-360 : overtimeRate15 → 10/25/50/100
// ============================================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 NETTOYAGE TOTAL - GANG DES GENIUSES');
  console.log('===================================================\n');

  // ============================================================================
  // 1️⃣ MISE À JOUR DES PARAMÈTRES DE PAIE — DÉCRET 78-360
  // ============================================================================
  console.log('1️⃣ Correction des taux CNSS et heures sup (Décret 78-360)...');

  const updatedSettings = await prisma.payrollSettings.updateMany({
    data: {
      cnssEmployerRate: 16,
      cnssSalarialRate: 4,
      cnssCeiling: 600000, // ✅ Plafond légal Congo (600k, pas 1.2M)
      // ✅ DÉCRET N°78-360 (remplace overtimeRate15 supprimé du schéma)
      overtimeRate10: 10, // Art. 20 — 5 premières h.
      overtimeRate25: 25, // Art. 20 — heures suivantes
      overtimeRate50: 50, // Art. 21 — nuit repos/férié
      overtimeRate100: 100, // Art. 21 — nuit dimanche/JF
      updatedAt: new Date(),
    } as any,
  });

  console.log(
    `   ✅ ${updatedSettings.count} configurations d'entreprises mises à jour.\n`,
  );

  // ============================================================================
  // 2️⃣ SUPPRESSION TOTALE DES BULLETINS
  // ============================================================================
  console.log('2️⃣ Suppression de TOUS les bulletins de paie...');
  console.log('   ⚠️  Action irréversible en cours...');

  const deletedPayrolls = await prisma.payroll.deleteMany({});

  console.log(
    `   🗑️  SUCCÈS : ${deletedPayrolls.count} bulletins supprimés de la base.`,
  );
  console.log('   ✅ La table des paies est maintenant vide.\n');

  // ============================================================================
  // 3️⃣ RÉINITIALISATION DES RÉSUMÉS
  // ============================================================================
  console.log('3️⃣ Nettoyage des résumés de présence...');
  await prisma.attendanceSummary.deleteMany({});
  console.log('   ✅ Résumés de présence réinitialisés.\n');

  // ============================================================================
  // 4️⃣ RAPPORT FINAL
  // ============================================================================
  const settings = await prisma.payrollSettings.findMany({
    select: {
      id: true,
      companyId: true,
      cnssSalarialRate: true,
      cnssEmployerRate: true,
      cnssSocialCeiling: true,
    },
  });

  console.log(`✅ ${settings.length} PayrollSettings vérifiés :`);
  for (const s of settings) {
    console.log(
      `  Company ${s.companyId}: ` +
        `CNSS ${s.cnssSalarialRate}%/${s.cnssEmployerRate}%, ` +
        `plafond ${Number(s.cnssSocialCeiling).toLocaleString()} FCFA`,
    );
  }

  console.log('\n===================================================');
  console.log('🎯 NETTOYAGE TERMINÉ');
  console.log('Tu peux maintenant relancer tes générations');
  console.log("de paie depuis l'interface, tout sera calculé à neuf !");
  console.log('===================================================');
}

main()
  .catch((e) => {
    console.error('❌ Erreur lors du nettoyage:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
