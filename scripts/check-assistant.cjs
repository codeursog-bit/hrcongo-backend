/* Real local PostgreSQL + Nest + cookie/JWT tests. No model/network provider. */
require('dotenv').config({ quiet: true });
process.env.NODE_ENV = 'test';
require('ts-node').register({ transpileOnly: true });
require('reflect-metadata');
const assert = require('node:assert/strict'),
  { randomUUID } = require('node:crypto'),
  { Test } = require('@nestjs/testing'),
  { ValidationPipe } = require('@nestjs/common'),
  { ConfigModule } = require('@nestjs/config'),
  { PassportModule } = require('@nestjs/passport'),
  jwt = require('jsonwebtoken'),
  { PrismaClient } = require('@prisma/client');
const { AssistantModule } = require('../src/assistant/assistant.module'),
  { AssistantService } = require('../src/assistant/assistant.service'),
  { JwtStrategy } = require('../src/auth/jwt.strategy'),
  { HELP, answerHelp, numbersGrounded } = require('../src/assistant/help');
const db = new PrismaClient({ log: [] }),
  companies = [],
  users = [];
let app,
  base,
  token,
  checks = 0;
async function request(path, method = 'GET', body, auth = token, status = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: 'Bearer ' + auth } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  assert.equal(
    response.status,
    status,
    `${method} ${path}: ${raw.slice(0, 400)}`,
  );
  checks++;
  return response.headers.get('content-type')?.includes('text/event-stream')
    ? raw
    : raw
      ? JSON.parse(raw)
      : undefined;
}
const events = (raw) =>
  raw
    .trim()
    .split('\n\n')
    .map((frame) => ({
      type: frame.split('\n')[0].slice(7),
      data: JSON.parse(frame.split('\n')[1].slice(6)),
    }));
const turn = (message, conversationId) => ({
  message,
  conversationId,
  requestId: randomUUID(),
});
async function company() {
  const id = randomUUID();
  companies.push(id);
  return db.company.create({
    data: {
      id,
      legalName: 'Assistant test',
      rccmNumber: id,
      address: 'Test',
      city: 'Test',
      phone: '0',
      email: id + '@example.test',
    },
  });
}
async function user(companyId, role = 'ADMIN') {
  const id = randomUUID();
  users.push(id);
  await db.user.create({
    data: {
      id,
      companyId,
      role,
      firstName: 'Test',
      lastName: 'Assistant',
      email: id + '@example.test',
      password: 'unused-fixture',
    },
  });
  const sid = randomUUID();
  await db.userSession.create({
    data: { userId: id, jti: sid, expiresAt: new Date(Date.now() + 3600000) },
  });
  return {
    id,
    token: jwt.sign(
      { sub: id, sid, type: 'access', companyId },
      process.env.JWT_SECRET || 'secretKey_change_in_production_123!',
      { expiresIn: '1h' },
    ),
  };
}
async function main() {
  assert.ok(
    ['localhost', '127.0.0.1', '::1'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  );
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      PassportModule,
      AssistantModule,
    ],
    providers: [JwtStrategy],
  }).compile();
  app = module.createNestApplication({ logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  const a = await company(),
    b = await company(),
    admin = await user(a.id),
    colleague = await user(a.id),
    employee = await user(a.id, 'EMPLOYEE'),
    foreign = await user(b.id);
  token = admin.token;
  await request('/assistant/capabilities', 'GET', undefined, null, 401);
  const caps = await request('/assistant/capabilities');
  assert.equal(caps.assistantMode, 'INTEGRE');
  assert.equal(caps.analysisAvailable, false);
  assert.equal(caps.monthlyAnalyses, 3);
  const employeeHelp = await request(
    '/assistant/help',
    'GET',
    undefined,
    employee.token,
  );
  assert.ok(!employeeHelp.some((a) => a.id === 'employees'));
  assert.ok(employeeHelp.some((a) => a.id === 'personal-pay'));
  const q = turn('Comment faire la paie ?');
  const raw = await request('/assistant/chat', 'POST', q);
  const result = events(raw),
    done = result.find((e) => e.type === 'done').data,
    id = done.conversationId;
  assert.ok(
    result.some(
      (e) => e.type === 'guide' && e.data.guideId === 'payroll-create',
    ),
  );
  assert.equal(
    result
      .filter((e) => e.type === 'text')
      .map((e) => e.data.text)
      .join(''),
    HELP.find((h) => h.id === 'payroll').text,
  );
  const replay = events(await request('/assistant/chat', 'POST', q)).find(
    (e) => e.type === 'done',
  ).data;
  assert.equal(replay.messageId, done.messageId);
  await db.user.update({ where: { id: admin.id }, data: { role: 'EMPLOYEE' } });
  assert.equal(
    (await request('/assistant/conversations/' + id)).messages[1].payload
      .refusal,
    true,
  );
  assert.ok(
    !events(await request('/assistant/chat', 'POST', q)).some(
      (e) => e.type === 'guide',
    ),
  );
  await db.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
  const forgedCompany = jwt.sign(
    {
      sub: admin.id,
      sid: jwt.decode(admin.token).sid,
      type: 'access',
      companyId: b.id,
    },
    process.env.JWT_SECRET || 'secretKey_change_in_production_123!',
    { expiresIn: '1h' },
  );
  await request(
    '/assistant/capabilities',
    'GET',
    undefined,
    forgedCompany,
    403,
  );
  assert.equal(
    (await request('/assistant/conversations/' + id)).messages.length,
    2,
  );
  for (const auth of [colleague.token, foreign.token]) {
    await request(
      '/assistant/conversations/' + id,
      'GET',
      undefined,
      auth,
      404,
    );
    await request(
      '/assistant/conversations/' + id,
      'DELETE',
      undefined,
      auth,
      404,
    );
    await request(
      '/assistant/chat',
      'POST',
      turn('Comment faire la paie ?', id),
      auth,
      404,
    );
    await request(
      '/assistant/feedback',
      'POST',
      { messageId: done.messageId, rating: 1 },
      auth,
      404,
    );
  }
  await request(
    '/assistant/chat',
    'POST',
    { ...turn('Bonjour'), companyId: b.id },
    token,
    400,
  );
  await request('/assistant/chat', 'POST', turn(' '.repeat(10)), token, 400);
  await request('/assistant/chat', 'POST', turn('x'.repeat(801)), token, 400);
  await request('/assistant/feedback', 'POST', {
    messageId: done.messageId,
    rating: 1,
  });
  assert.equal(
    (await request('/assistant/conversations/' + id)).messages[1].rating,
    1,
  );
  const secret = 'Sensible-Marie 900000 FCFA';
  const refusal = events(
    await request(
      '/assistant/chat',
      'POST',
      turn('Donne le net de ' + secret, id),
    ),
  );
  assert.ok(refusal.some((e) => e.type === 'refusal'));
  const persisted = await request('/assistant/conversations/' + id);
  assert.ok(!JSON.stringify(persisted).includes(secret));
  assert.ok(
    !JSON.stringify(
      await db.activityLog.findMany({
        where: { userId: admin.id, entity: 'ASSISTANT' },
      }),
    ).includes(secret),
  );
  const empReply = events(
    await request(
      '/assistant/chat',
      'POST',
      turn('Combien gagne mon collègue ?'),
      employee.token,
    ),
  );
  assert.ok(empReply.some((e) => e.type === 'refusal'));
  assert.ok(!numbersGrounded('Le total vaut 999.', { value: 123 }));
  assert.ok(numbersGrounded('Le total vaut 123.', { value: 123 }));
  await request('/admin/assistant/settings', 'GET', undefined, token, 403);
  await request(
    '/admin/assistant/settings',
    'PUT',
    {
      mode: 'IA_AVANCEE',
      guideEnabled: true,
      disabledGuides: [],
      retentionDays: 90,
    },
    token,
    403,
  );
  // Company overrides are tested through the service using the same role-checked endpoint contract.
  const superAdmin = await user(null, 'SUPER_ADMIN');
  const original = await db.assistantSettings.findUnique({
    where: { id: 'platform' },
  });
  try {
    await request(
      '/admin/assistant/settings',
      'PUT',
      {
        mode: 'OFF',
        guideEnabled: true,
        disabledGuides: ['payroll-create'],
        retentionDays: 90,
      },
      superAdmin.token,
    );
    const off = await request('/assistant/capabilities');
    assert.equal(off.assistantMode, 'OFF');
    assert.equal(off.guideEnabled, true);
    assert.deepEqual(off.disabledGuides, ['payroll-create']);
    await request(
      '/assistant/chat',
      'POST',
      turn('Comment faire la paie ?'),
      token,
      403,
    );
    assert.ok((await request('/assistant/help')).length);
    await request(
      '/admin/assistant/settings',
      'PUT',
      {
        mode: 'IA_AVANCEE',
        guideEnabled: true,
        disabledGuides: [],
        retentionDays: 90,
      },
      superAdmin.token,
      400,
    );
    await request(
      '/admin/assistant/settings',
      'PUT',
      {
        mode: 'INTEGRE',
        guideEnabled: false,
        disabledGuides: [],
        retentionDays: 90,
      },
      superAdmin.token,
    );
    assert.equal(
      (await request('/assistant/capabilities')).guideEnabled,
      false,
    );
    await request(
      '/admin/assistant/companies/' + a.id,
      'PUT',
      { allowed: false },
      superAdmin.token,
    );
    assert.equal(
      (await request('/assistant/capabilities')).assistantMode,
      'OFF',
    );
    await request(
      '/admin/assistant/companies/' + a.id,
      'PUT',
      { allowed: true },
      superAdmin.token,
    );
    const { DEFAULT_LIMITS } = require('../src/assistant/analysis-policy');
    const policy = {
      mode: 'INTEGRE',
      guideEnabled: true,
      disabledGuides: [],
      retentionDays: 90,
      analysisEnabled: true,
      killSwitch: true,
      planLimits: structuredClone(DEFAULT_LIMITS),
    };
    policy.planLimits.FREE.monthlyAnalyses = 1;
    await request(
      '/admin/assistant/settings',
      'PUT',
      { ...policy, analysisEnabled: 'true' },
      superAdmin.token,
      400,
    );
    await request(
      '/admin/assistant/settings',
      'PUT',
      {
        ...policy,
        planLimits: {
          ...policy.planLimits,
          FREE: { maxMode: 'UNSUPPORTED', monthlyAnalyses: 1 },
        },
      },
      superAdmin.token,
      400,
    );
    await request('/admin/assistant/settings', 'PUT', policy, superAdmin.token);
    const dep = await db.department.create({
        data: { companyId: a.id, name: 'Test effectifs' },
      }),
      foreignDep = await db.department.create({
        data: { companyId: b.id, name: 'Autre entreprise' },
      });
    for (const [companyId, departmentId, count] of [
      [a.id, dep.id, 2],
      [b.id, foreignDep.id, 5],
    ])
      for (let n = 0; n < count; n++) {
        const eid = randomUUID();
        await db.employee.create({
          data: {
            id: eid,
            companyId,
            departmentId,
            employeeNumber: eid,
            firstName: 'Fixture',
            lastName: 'Effectif',
            dateOfBirth: new Date('1990-01-01'),
            placeOfBirth: 'Test',
            gender: 'MALE',
            email: eid + '@example.test',
            address: 'Test',
            hireDate: new Date('2020-01-01'),
            contractType: 'CDI',
            position: 'Test',
            baseSalary: 100000,
          },
        });
      }
    const question = turn('Quel est l’effectif ce mois-ci ?'),
      analysisResponse = events(
        await request('/assistant/chat', 'POST', question),
      );
    const card = analysisResponse.find((e) => e.type === 'card').data.card;
    assert.equal(card.metrics[3].value, 2);
    assert.equal(card.source, 'reports.getWorkforceMovement');
    assert.equal(
      (await request('/assistant/capabilities')).remainingAnalyses,
      0,
    );
    const repeats = events(
      await request(
        '/assistant/chat',
        'POST',
        turn('Quel est l’effectif ce mois-ci ?'),
        colleague.token,
      ),
    );
    assert.equal(
      repeats.find((e) => e.type === 'card').data.card.metrics[3].value,
      2,
    );
    assert.equal(
      await db.assistantAnalysisUsage.count({
        where: { companyId: a.id, charged: true },
      }),
      1,
    );
    assert.equal(
      await db.assistantAnalysisUsage.count({
        where: { companyId: a.id, charged: false },
      }),
      1,
    );
    await request(
      '/assistant/chat',
      'POST',
      turn('Effectif le mois dernier'),
      token,
      429,
    );
    assert.equal(
      await db.assistantAnalysisUsage.count({
        where: { companyId: a.id, charged: true },
      }),
      1,
    );
    const employeeAnalysis = events(
      await request(
        '/assistant/chat',
        'POST',
        turn('Quel est l’effectif ce mois-ci ?'),
        employee.token,
      ),
    );
    assert.ok(employeeAnalysis.some((e) => e.type === 'refusal'));
    assert.ok(!employeeAnalysis.some((e) => e.type === 'card'));
    assert.equal(
      (
        await request(
          '/assistant/capabilities',
          'GET',
          undefined,
          employee.token,
        )
      ).monthlyAnalyses,
      null,
    );
    await request(
      '/assistant/preferences',
      'PATCH',
      { analysisEnabled: false },
      employee.token,
      403,
    );
    await request('/assistant/preferences', 'PATCH', {
      analysisEnabled: false,
    });
    assert.equal(
      (await request('/assistant/capabilities')).analysesEnabled,
      false,
    );
    const disabledAnalysis = events(
      await request(
        '/assistant/chat',
        'POST',
        turn('Quel est l’effectif ce mois-ci ?'),
      ),
    );
    assert.ok(disabledAnalysis.some((e) => e.type === 'refusal'));
    await request('/assistant/preferences', 'PATCH', { analysisEnabled: true });
    const usage = await request(
      '/admin/assistant/usage',
      'GET',
      undefined,
      superAdmin.token,
    );
    assert.ok(
      usage.tools.some((t) => t.tool === 'headcount_summary' && t.charged),
    );
    await request('/admin/assistant/usage', 'GET', undefined, token, 403);
    assert.ok(
      (
        await request(
          '/admin/assistant/companies?search=Assistant',
          'GET',
          undefined,
          superAdmin.token,
        )
      ).length,
    );
    await request(
      '/admin/assistant/companies/' + a.id,
      'PUT',
      { allowed: true, forceMode: 'OFF' },
      superAdmin.token,
    );
    assert.equal(
      (await request('/assistant/capabilities')).assistantMode,
      'OFF',
    );
    await request(
      '/admin/assistant/companies/' + a.id,
      'PUT',
      { allowed: true, forceMode: null },
      superAdmin.token,
    );
    const guideSession = randomUUID(),
      guideEvent = {
        sessionId: guideSession,
        guideId: 'payroll-create',
        state: 'STARTED',
      };
    await request(
      '/assistant/guide-events',
      'POST',
      { ...guideEvent, state: 'COMPLETED' },
      token,
      400,
    );
    await request('/assistant/guide-events', 'POST', guideEvent);
    await request('/assistant/guide-events', 'POST', guideEvent);
    await request('/assistant/guide-events', 'POST', {
      ...guideEvent,
      state: 'COMPLETED',
    });
    await request(
      '/assistant/guide-events',
      'POST',
      guideEvent,
      employee.token,
      403,
    );
    assert.equal(
      await db.activityLog.count({
        where: { userId: admin.id, entityId: guideSession },
      }),
      2,
    );
    await request('/assistant/upgrade-click', 'POST', {});
    await request('/assistant/upgrade-click', 'POST', {}, employee.token, 403);
    const { ReportsService } = require('../src/reports/reports.service');
    const reports = app.get(ReportsService),
      originalReport = reports.getWorkforceMovement;
    const fixture = await db.employee.findFirst({ where: { companyId: a.id } });
    reports.getWorkforceMovement = async function () {
      await this.prisma.employee.update({
        where: { id: fixture.id },
        data: { position: 'FORBIDDEN_WRITE' },
      });
      throw Error('Read-only protection failed');
    };
    try {
      const blocked = events(
        await request(
          '/assistant/chat',
          'POST',
          turn('Effectif le mois dernier'),
        ),
      );
      assert.ok(blocked.some((e) => e.type === 'refusal'));
      assert.equal(
        (await db.employee.findUnique({ where: { id: fixture.id } })).position,
        'Test',
      );
      assert.equal(
        await db.assistantAnalysisUsage.count({
          where: { companyId: a.id, charged: true },
        }),
        1,
      );
    } finally {
      reports.getWorkforceMovement = originalReport;
    }
    await require('./assistant-analysis-checks.cjs')({db,app,a,b,user,request,events,turn,superAdmin,policy,employee});
    await require('./assistant-model-flow.cjs')({ db, a, user, request, events, turn, superAdmin, policy });
  } finally {
    if (original)
      await db.assistantSettings.update({
        where: { id: 'platform' },
        data: {
          mode: original.mode,
          guideEnabled: original.guideEnabled,
          disabledGuides: original.disabledGuides,
          retentionDays: original.retentionDays,
          updatedBy: original.updatedBy,
          analysisEnabled: original.analysisEnabled,
          killSwitch: original.killSwitch,
          planLimits: original.planLimits,
          licenseConfirmed: original.licenseConfirmed,
          licenseProvider: original.licenseProvider,
          licenseDate: original.licenseDate,
          licenseReference: original.licenseReference,
          provider: original.provider,
          model: original.model,
        },
      });
    else await db.assistantSettings.deleteMany({ where: { id: 'platform' } });
  }
  // Execute actual frontend HTTP adapter + UTF-8 SSE parser, supplying only browser cookies.
  const fs = require('node:fs'),
    path = require('node:path'),
    ts = require('typescript'),
    cache = new Map(),
    front = path.resolve(__dirname, '../../frontend');
  process.env.NEXT_PUBLIC_API_URL = base;
  const originalFetch = global.fetch;
  global.fetch = (url, init = {}) => {
    assert.ok(String(url).startsWith(base), 'External network is forbidden');
    return originalFetch(url, {
      ...init,
      headers: { ...init.headers, Cookie: 'access_token=' + token },
    });
  };
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const file = path.join(front, relative + '.ts'),
      m = { exports: {} };
    new Function(
      'require',
      'module',
      'exports',
      ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    )(
      (name) => (name.startsWith('@/') ? load(name.slice(2)) : require(name)),
      m,
      m.exports,
    );
    cache.set(relative, m.exports);
    return m.exports;
  }
  try {
    const api = load('lib/data/assistant.api').assistantApi;
    assert.equal((await api.capabilities()).assistantMode, 'INTEGRE');
    assert.ok((await api.help()).length);
    assert.ok((await api.suggestions()).length);
    let captured = [];
    await api.chat(
      turn('Comment ajouter un employé ?'),
      (e) => captured.push(e),
      new AbortController().signal,
    );
    const saved = captured.find((e) => e.type === 'done').data;
    assert.equal((await api.get(saved.conversationId)).messages.length, 2);
    await api.feedback(saved.messageId, -1);
    assert.ok((await api.list()).some((c) => c.id === saved.conversationId));
    await api.remove(saved.conversationId);
  } finally {
    global.fetch = originalFetch;
  }
  const limited = await user(a.id);
  let lastTurn;
  for (let n = 0; n < 20; n++) {
    lastTurn = turn('Comment changer les couleurs ?');
    await request('/assistant/chat', 'POST', lastTurn, limited.token);
  }
  await request(
    '/assistant/chat',
    'POST',
    turn('Comment changer les couleurs ?'),
    limited.token,
    429,
  );
  await request('/assistant/chat', 'POST', lastTurn, limited.token);
  const concurrent = await user(a.id),
    same = turn('Comment créer une offre ?');
  const concurrentResults = await Promise.all([
    request('/assistant/chat', 'POST', same, concurrent.token),
    request('/assistant/chat', 'POST', same, concurrent.token),
  ]);
  assert.equal(
    events(concurrentResults[0]).at(-1).data.messageId,
    events(concurrentResults[1]).at(-1).data.messageId,
  );
  await request('/assistant/conversations/' + id, 'DELETE');
  await request('/assistant/conversations/' + id, 'GET', undefined, token, 404);
  await db.assistantConversation.updateMany({
    where: { userId: employee.id },
    data: { expiresAt: new Date(0) },
  });
  await app.get(AssistantService).purge();
  assert.equal(
    await db.assistantConversation.count({ where: { userId: employee.id } }),
    0,
  );
  console.log(
    `PASS: ${checks} contrôles HTTP, SSE réel, adaptateur front, isolation, rôles, historique privé, idempotence, avis, OFF/guides, refus avancé et purge.`,
  );
}
main()
  .catch((e) => {
    console.error(
      e instanceof assert.AssertionError
        ? e.message
        : 'Assistant test failed: ' +
            e.name +
            ' ' +
            String(e.message).split('\n').slice(-2).join(' '),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.close();
    await db.activityLog.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.company.deleteMany({ where: { id: { in: companies } } });
    await db.$disconnect();
  });
