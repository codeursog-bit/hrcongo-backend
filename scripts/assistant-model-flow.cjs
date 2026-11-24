const assert = require('node:assert/strict');
module.exports = async ({
  db,
  a,
  user,
  request,
  events,
  turn,
  superAdmin,
  policy,
}) => {
  const originalEnv = { ...process.env },
    originalFetch = global.fetch;
  const analyst = await user(a.id),
    calls = [];
  Object.assign(process.env, {
    ASSISTANT_PROVIDER: 'mistral',
    ASSISTANT_MODEL: 'fixture-model',
    ASSISTANT_API_KEY: 'fixture-key',
  });
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('http://127.0.0.1:'))
      return originalFetch(url, opts);
    assert.equal(url, 'https://api.mistral.ai/v1/chat/completions');
    calls.push(JSON.parse(opts.body));
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: '{"sentences":["overview","consult"]}' } },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    await request(
      '/admin/assistant/model-test',
      'POST',
      {},
      analyst.token,
      403,
    );
    const config = {
      ...policy,
      mode: 'IA_AVANCEE',
      killSwitch: false,
      provider: 'mistral',
      model: 'fixture-model',
      licenseProvider: 'mistral',
      licenseReference: 'test only',
      licenseDate: '2026-01-01',
      licenseConfirmed: true,
      planLimits: Object.fromEntries(
        Object.keys(policy.planLimits).map((p) => [
          p,
          { maxMode: 'IA_AVANCEE', monthlyAnalyses: 100 },
        ]),
      ),
    };
    await request(
      '/admin/assistant/settings',
      'PUT',
      { ...config, licenseConfirmed: false },
      superAdmin.token,
      400,
    );
    assert.equal(calls.length, 0);
    await request('/admin/assistant/settings', 'PUT', config, superAdmin.token);
    assert.equal(
      (
        await request(
          '/assistant/capabilities',
          'GET',
          undefined,
          analyst.token,
        )
      ).assistantMode,
      'IA_AVANCEE',
    );
    await request('/admin/assistant/model-test', 'POST', {}, superAdmin.token);
    assert.equal(calls.length, 1);
    // Clear only this test company's usage to exercise a fresh external turn.
    await db.assistantAnalysisUsage.deleteMany({ where: { companyId: a.id } });
    const question = turn('Quel est l’effectif ce mois-ci ?');
    const reply = events(
      await request('/assistant/chat', 'POST', question, analyst.token),
    );
    assert.ok(reply.some((e) => e.type === 'card'));
    assert.equal(calls.length, 2);
    assert.ok(!JSON.stringify(calls).includes(a.id));
    await request('/assistant/chat', 'POST', question, analyst.token);
    assert.equal(calls.length, 2, 'Idempotent retry must not call model again');
    await request(
      '/admin/assistant/settings',
      'PUT',
      { ...config, killSwitch: true },
      superAdmin.token,
    );
    assert.equal(
      (
        await request(
          '/assistant/capabilities',
          'GET',
          undefined,
          analyst.token,
        )
      ).assistantMode,
      'INTEGRE',
    );
    await request(
      '/admin/assistant/model-test',
      'POST',
      {},
      superAdmin.token,
      400,
    );
    assert.equal(calls.length, 2);
    await request(
      '/admin/assistant/settings',
      'PUT',
      { ...config, killSwitch: false },
      superAdmin.token,
    );
    await request(
      '/admin/assistant/companies/' + a.id,
      'PUT',
      { allowed: true, forceMode: 'INTEGRE' },
      superAdmin.token,
    );
    assert.equal(
      (
        await request(
          '/assistant/capabilities',
          'GET',
          undefined,
          analyst.token,
        )
      ).assistantMode,
      'INTEGRE',
    );
    await request(
      '/admin/assistant/companies/' + a.id,
      'PUT',
      { allowed: true, forceMode: null },
      superAdmin.token,
    );
    console.log(
      'PASS real HTTP model flow: superadmin, license, advanced mode, analysis, retry, kill switch, company restriction; provider intercepted.',
    );
  } finally {
    global.fetch = originalFetch;
    process.env = originalEnv;
  }
};
