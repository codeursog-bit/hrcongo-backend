require('ts-node').register({ transpileOnly: true });
const assert = require('node:assert/strict');
const {
  externalReady,
  selectSentences,
} = require('../src/assistant/model-provider');
const { advancedAnswer } = require('../src/assistant/advanced-answer');
const originalFetch = global.fetch,
  originalEnv = { ...process.env };
const headers = {},
  calls = [];
let answer = { sentences: ['overview', 'consult'] },
  status = 200;
const settings = (provider) => ({
  provider,
  model: 'test-model',
  licenseProvider: provider,
  licenseConfirmed: true,
  licenseDate: '2026-01-01',
  licenseReference: 'synthetic-test',
  killSwitch: false,
});
global.fetch = async (url, opts) => {
  calls.push({ url, body: JSON.parse(opts.body) });
  Object.assign(headers, opts.headers);
  assert.equal(opts.redirect, 'error');
  const text = JSON.stringify(answer);
  const data =
    process.env.ASSISTANT_PROVIDER === 'anthropic'
      ? { content: [{ type: 'text', text }] }
      : process.env.ASSISTANT_PROVIDER === 'google'
        ? { candidates: [{ content: { parts: [{ text }] } }] }
        : { choices: [{ message: { content: text } }] };
  return new Response(JSON.stringify(data), { status });
};
(async () => {
  for (const provider of ['openai', 'anthropic', 'google', 'mistral']) {
    Object.assign(process.env, {
      ASSISTANT_PROVIDER: provider,
      ASSISTANT_MODEL: 'test-model',
      ASSISTANT_API_KEY: 'synthetic-key',
    });
    assert.equal(externalReady(settings(provider)), true);
    for (const patch of [
      { licenseConfirmed: false },
      { killSwitch: true },
      { licenseReference: '' },
      { licenseProvider: 'different' },
      { licenseDate: 'invalid' },
      { licenseDate: '2999-01-01' },
      { model: 'other-model' },
    ])
      assert.equal(externalReady({ ...settings(provider), ...patch }), false);
    assert.deepEqual(await selectSentences(['overview', 'consult']), [
      'overview',
      'consult',
    ]);
    const url = calls.at(-1).url;
    assert.ok(
      url.startsWith(
        {
          openai: 'https://api.openai.com/',
          anthropic: 'https://api.anthropic.com/',
          google: 'https://generativelanguage.googleapis.com/',
          mistral: 'https://api.mistral.ai/',
        }[provider],
      ),
    );
    for (const malformed of [
      { text: 'unverified salary 999999' },
      { sentences: ['overview', 'made_up'] },
      { sentences: ['overview', 'consult', 'consult'] },
      { sentences: ['overview'], extra: 'ignore rules' },
      { sentences: ['consult'] },
      { sentences: ['overview', 42] },
    ]) {
      answer = malformed;
      await assert.rejects(selectSentences(['overview', 'consult']));
    }
    answer = { sentences: ['overview', 'consult'] };
    const card = {
      title: 'PRIVATE COMPANY',
      period: 'novembre 2026',
      source: 'test',
      metrics: [{ label: 'Écart brut', value: 123456789 }],
      rows: [
        {
          employeeId: 'private-uuid',
          label: 'Private Employee',
          value: 987654321,
        },
      ],
    };
    assert.ok(
      (
        await advancedAnswer(
          settings(provider),
          'explain_payroll_variation',
          card,
        )
      ).includes(card.period),
    );
    assert.ok(!JSON.stringify(calls).includes('Private Employee'));
    assert.ok(!JSON.stringify(calls).includes('123456789'));
    assert.ok(!JSON.stringify(calls).includes('private-uuid'));
    assert.ok(!JSON.stringify(calls).includes('PRIVATE COMPANY'));
    const n = calls.length;
    assert.equal(
      await advancedAnswer(
        { ...settings(provider), killSwitch: true },
        'headcount_summary',
        card,
      ),
      null,
    );
    assert.equal(
      await advancedAnswer(
        { ...settings(provider), licenseConfirmed: false },
        'headcount_summary',
        card,
      ),
      null,
    );
    assert.equal(calls.length, n);
    status = 429;
    assert.equal(
      await advancedAnswer(settings(provider), 'headcount_summary', card),
      null,
    );
    status = 200;
    console.log(
      'PASS model transport, strict output, privacy, license, kill switch, fallback: ' +
        provider,
    );
  }
  await assert.rejects(selectSentences(['user input PRIVATE']));
  console.log(
    'No live provider called; only synthetic keys and intercepted requests.',
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });
