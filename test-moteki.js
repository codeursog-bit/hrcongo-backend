// Test isolé — à exécuter avec : node test-moteki.js
// Objectif : reproduire EXACTEMENT le même appel que MotekiService,
// mais sans NestJS autour, pour savoir si le souci vient de Node/axios
// sur cette machine, ou de quelque chose de spécifique à l'app NestJS.

const axios = require('axios');

const secretKey = 'sk_2gUfizdaI10JCzacRtYVeYTnSjV7HUye6Ujb4K8Y4R9cnaYZ';

async function main() {
  console.log('--- Test 1 : instance axios.create() comme dans MotekiService ---');
  const client = axios.create({
    baseURL: 'https://api.moteki.co',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secretKey}`,
    },
    timeout: 30000,
  });

  try {
    const res = await client.get('/api/v1/storefront/payment-methods');
    console.log('✅ Succès:', res.status, res.data);
  } catch (err) {
    console.log('❌ Échec:', err.response?.status, err.response?.data || err.message);
    console.log('Headers envoyés (vus par axios):', err.config?.headers);
  }

  console.log('\n--- Test 2 : appel direct sans axios.create(), headers inline ---');
  try {
    const res = await axios.get('https://api.moteki.co/api/v1/storefront/payment-methods', {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    console.log('✅ Succès:', res.status, res.data);
  } catch (err) {
    console.log('❌ Échec:', err.response?.status, err.response?.data || err.message);
  }

  console.log('\n--- Test 3 : via https natif de Node (aucune lib tierce) ---');
  const https = require('https');
  await new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.moteki.co',
        path: '/api/v1/storefront/payment-methods',
        method: 'GET',
        headers: { Authorization: `Bearer ${secretKey}` },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          console.log(`Status: ${res.statusCode}`);
          console.log('Body:', data);
          resolve();
        });
      },
    );
    req.on('error', (e) => {
      console.log('❌ Erreur https natif:', e.message);
      resolve();
    });
    req.end();
  });
  console.log('\n--- Test 4 : axios avec User-Agent spoofé en curl (théorie Cloudflare/WAF) ---');
  try {
    const res = await axios.get('https://api.moteki.co/api/v1/storefront/payment-methods', {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'User-Agent': 'curl/8.0.1',
      },
    });
    console.log('✅ Succès:', res.status, res.data);
  } catch (err) {
    console.log('❌ Échec:', err.response?.status, err.response?.data || err.message);
  }
}

main();