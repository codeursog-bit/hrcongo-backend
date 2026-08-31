// ============================================================================
// Fichier: backend/prisma/super-admin.seed.ts
// ============================================================================

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function seedSuperAdmin() {
  console.log('🌱 Seeding Super Admin...');

  const email = 'sogmusic@gmail.com';
  const password = 'sogmusic';

  // Vérifier si le Super Admin existe déjà
  const existingAdmin = await prisma.user.findUnique({
    where: { email },
  });

  if (existingAdmin) {
    console.log('✅ Super Admin existe déjà:', email);
    console.log('👤 ID:', existingAdmin.id);
    console.log('📧 Email:', existingAdmin.email);
    console.log('🔐 Role:', existingAdmin.role);
    return;
  }

  // Hasher le mot de passe
  const hashedPassword = await bcrypt.hash(password, 10);

  // Créer le Super Admin SANS companyId et SANS emailVerified
  const superAdmin = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      firstName: 'Sog',
      lastName: 'Music',
      role: 'SUPER_ADMIN',
      isActive: true,
      // ✅ RETIRER emailVerified (n'existe pas dans le schema)
      // ⚠️ PAS de companyId !
    },
  });

  console.log('✅ Super Admin créé avec succès !');
  console.log('📧 Email:', superAdmin.email);
  console.log('🔑 Mot de passe:', password);
  console.log('👤 ID:', superAdmin.id);
  console.log('🔐 Role:', superAdmin.role);
  console.log('\n🎯 Tu peux maintenant te connecter sur /admin/login');
}

seedSuperAdmin()
  .catch((e) => {
    console.error('❌ Erreur seed Super Admin:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });