// node test-post.js
// Compare v1 /subscribe (401 en curl) et v2 /payments (404 en curl) — pour
// confirmer que c'est bien reproductible en Node aussi (pas un artefact
// curl/Windows).

const axios = require('axios');

const secretKey = 'sk_2gUfizdaI10JCzacRtYVeYTnSjV7HUye6Ujb4K8Y4R9cnaYZ';

async function main() {
  console.log('--- Test v1 : POST /storefront/digital-products/{uuid}/subscribe ---');
  try {
    const res = await axios.post(
      'https://api.moteki.co/api/v1/storefront/digital-products/1D7A67C2B57E/subscribe',
      {
        plan_index: 0,
        customer_first_name: 'Nathan',
        customer_email: 'sogwin62@gmail.com',
        customer_phone: '+242064133693',
        payment_method: 'mobile_money',
        payment_operator: 'mtn-cg',
      },
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    console.log('✅ Succès:', res.status, res.data);
  } catch (err) {
    console.log('❌ Échec:', err.response?.status, err.response?.data || err.message);
  }

  console.log('\n--- Test v2 : POST /storefront/payments ---');
  try {
    const res = await axios.post(
      'https://api.moteki.co/api/v2/storefront/payments',
      {
        customer: {
          first_name: 'Nathan',
          email: 'sogwin62@gmail.com',
          phone: '+242064133693',
          country: 'cg',
        },
        order: {
          currency: 'XAF',
          items: [{ product_uuid: '1D7A67C2B57E', quantity: 1, plan_index: 0 }],
        },
        payment: { method: 'mobile_money', operator: 'mtn' },
      },
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Idempotency-Key': '3f9a8c2e-1b4d-4f6a-9e2c-7a5b8d3f1e6a',
        },
      },
    );
    console.log('✅ Succès:', res.status, res.data);
  } catch (err) {
    console.log('❌ Échec:', err.response?.status, err.response?.data || err.message);
  }
}

main();