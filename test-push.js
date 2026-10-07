// ============================================================================
// test-push.js — à lancer depuis le terminal du conteneur backend (Coolify)
// (là où VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / DATABASE_URL sont déjà définis)
//
//   node test-push.js send  employe@mail.com        → envoie un vrai push de test
//   node test-push.js send  employe@mail.com --like  → mêmes options que le rappel (TTL + urgency high)
//   node test-push.js missing                        → employés ACTIFS sans aucun appareil push
// ============================================================================
const { PrismaClient } = require('@prisma/client');
const webpush = require('web-push');

const prisma = new PrismaClient();
const [mode, arg, flag] = process.argv.slice(2);

async function main() {
  if (mode === 'missing') {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        employee: { is: { status: 'ACTIVE' } },
        pushSubscriptions: { none: {} },
      },
      select: { email: true, pushNotifEnabled: true, company: { select: { legalName: true } } },
    });
    console.log(`${users.length} employé(s) actif(s) SANS appareil push :`);
    for (const u of users) {
      console.log(`- ${u.email} | ${u.company?.legalName ?? '?'} | pushNotifEnabled=${u.pushNotifEnabled}`);
    }
    return;
  }

  if (mode === 'send' && arg) {
    webpush.setVapidDetails(
      process.env.VAPID_MAILTO || 'mailto:contact@konzasuite.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
    const user = await prisma.user.findFirst({
      where: { email: arg },
      select: { id: true, pushNotifEnabled: true, pushSubscriptions: true },
    });
    if (!user) return console.log('Utilisateur introuvable');
    console.log(`pushNotifEnabled=${user.pushNotifEnabled}, appareils=${user.pushSubscriptions.length}`);

    const options = flag === '--like' ? { TTL: 1200, urgency: 'high' } : {};
    const payload = JSON.stringify({
      title: '🔔 Test Konza RH',
      body: 'Si tu vois ça app fermée, le push marche.',
      url: '/presences/pointage',
      tag: `test-${Date.now()}`,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
    });

    for (const sub of user.pushSubscriptions) {
      try {
        const res = await webpush.sendNotification(JSON.parse(sub.token), payload, options);
        console.log(`✅ ${sub.deviceLabel ?? sub.id} → HTTP ${res.statusCode}`);
      } catch (e) {
        console.log(`❌ ${sub.deviceLabel ?? sub.id} → HTTP ${e.statusCode} ${e.body ?? e.message}`);
      }
    }
    return;
  }

  console.log('Usage : node test-push.js send <email> [--like]  |  node test-push.js missing');
}

main().finally(() => prisma.$disconnect());