/* Real HTTP + PostgreSQL integration. Only the UUID fixtures created here are removed.
 * Run: node scripts/check-daily-workspace.cjs (local DATABASE_URL required).
 * No application server, email service or cron worker is started.
 */
require('dotenv').config({ quiet: true });
process.env.NODE_ENV = 'test';
require('ts-node').register({ transpileOnly: true });
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { ConfigModule } = require('@nestjs/config');
const { PassportModule } = require('@nestjs/passport');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const {
  DailyWorkspaceModule,
} = require('../src/daily-workspace/daily-workspace.module');
const { JwtStrategy } = require('../src/auth/jwt.strategy');
const {
  congoDateString,
  congoDayOfWeek,
} = require('../src/common/utils/congo-time');
const db = new PrismaClient({ log: [] }),
  fixtureCompanies = [],
  fixtureUsers = [];
let app,
  base,
  token,
  checks = 0;
const today = congoDateString(),
  date = new Date(today + 'T00:00:00Z');
async function expectHttp(want, path, method = 'GET', body, auth = token) {
  const r = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: 'Bearer ' + auth } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await r.text();
  const value = raw ? JSON.parse(raw) : undefined;
  assert.equal(
    r.status,
    want,
    method + ' ' + path + ' ' + JSON.stringify(value),
  );
  checks++;
  return value;
}
async function company() {
  const id = randomUUID();
  fixtureCompanies.push(id);
  return db.company.create({
    data: {
      id,
      legalName: 'Test liaison ' + id,
      rccmNumber: id,
      address: 'Test',
      city: 'Brazzaville',
      phone: '000',
      email: id + '@example.test',
    },
  });
}
async function user(companyId, role, departmentId, birthday = false) {
  const id = randomUUID();
  fixtureUsers.push(id);
  let employee;
  if (departmentId)
    employee = await db.employee.create({
      data: {
        companyId,
        departmentId,
        employeeNumber: id,
        firstName: 'Test',
        lastName: id,
        dateOfBirth: new Date(
          (birthday ? '1992' + today.slice(4) : '1990-01-01') + 'T00:00:00Z',
        ),
        placeOfBirth: 'Test',
        gender: 'MALE',
        email: id + '@example.test',
        address: 'Test',
        hireDate: new Date(
          Number(today.slice(0, 4)) - 5 + today.slice(4) + 'T00:00:00Z',
        ),
        contractType: 'CDI',
        position: 'Test',
        baseSalary: 100000,
      },
    });
  const u = await db.user.create({
    data: {
      id,
      companyId,
      role,
      email: id + '@example.test',
      password: 'unused-integration-fixture',
      firstName: 'Test',
      lastName: id,
      ...(employee ? { employeeId: employee.id } : {}),
    },
  });
  const sid = randomUUID();
  await db.userSession.create({
    data: { userId: id, jti: sid, expiresAt: new Date(Date.now() + 3600000) },
  });
  return {
    ...u,
    employee,
    token: jwt.sign(
      { sub: id, sid, type: 'access', companyId },
      process.env.JWT_SECRET || 'secretKey_change_in_production_123!',
      { expiresIn: '1h' },
    ),
  };
}
async function main() {
  const host = new URL(process.env.DATABASE_URL).hostname;
  assert.ok(
    ['localhost', '127.0.0.1', '::1'].includes(host),
    'Local database only',
  );
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      PassportModule,
      DailyWorkspaceModule,
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
    b = await company();
  const dept = await db.department.create({
      data: { companyId: a.id, name: 'Test' },
    }),
    otherDept = await db.department.create({
      data: { companyId: a.id, name: 'Autre' },
    });
  const boss = await user(a.id, 'ADMIN'),
    hr = await user(a.id, 'HR_MANAGER'),
    me = await user(a.id, 'EMPLOYEE', dept.id, true),
    colleague = await user(a.id, 'EMPLOYEE', dept.id),
    other = await user(a.id, 'EMPLOYEE', otherDept.id),
    foreign = await user(b.id, 'ADMIN');
  token = me.token;
  await expectHttp(401, '/tasks/me', 'GET', undefined, null);
  const wrongCompany = jwt.sign(
    {
      sub: me.id,
      sid: jwt.decode(me.token).sid,
      type: 'access',
      companyId: b.id,
    },
    process.env.JWT_SECRET || 'secretKey_change_in_production_123!',
    { expiresIn: '1h' },
  );
  await expectHttp(403, '/appearance/me', 'GET', undefined, wrongCompany);
  await db.user.update({ where: { id: hr.id }, data: { role: 'EMPLOYEE' } });
  await expectHttp(
    403,
    '/tasks/assign',
    'POST',
    { title: 'Ancien rôle', assigneeIds: [me.id] },
    hr.token,
  );
  await db.user.update({ where: { id: hr.id }, data: { role: 'HR_MANAGER' } });
  await expectHttp(403, '/tasks/admin');
  await expectHttp(403, '/tasks/assign', 'POST', {
    title: 'Non',
    assigneeIds: [me.id],
  });
  await expectHttp(400, '/tasks', 'POST', { title: '   ' });
  await expectHttp(400, '/tasks', 'POST', { title: 'x', companyId: b.id });
  const personal = await expectHttp(201, '/tasks', 'POST', { title: 'Privé' });
  assert.equal(personal.scope, 'PERSONAL');
  assert.ok(
    (await expectHttp(200, '/tasks/me')).some((t) => t.id === personal.id),
  );
  assert.ok(
    !(await expectHttp(200, '/tasks/admin', 'GET', undefined, boss.token)).some(
      (t) => t.id === personal.id,
    ),
  );
  await expectHttp(
    404,
    `/tasks/${personal.id}/comments`,
    'POST',
    { text: 'Interdit' },
    boss.token,
  );
  await expectHttp(
    404,
    `/tasks/${personal.id}`,
    'PATCH',
    { status: 'DONE' },
    foreign.token,
  );
  await expectHttp(
    400,
    '/tasks/assign',
    'POST',
    { title: 'x', assigneeIds: [foreign.id] },
    boss.token,
  );
  const assigned = await expectHttp(
    201,
    '/tasks/assign',
    'POST',
    { title: 'Equipe', assigneeIds: [], departmentId: dept.id },
    hr.token,
  );
  await expectHttp(
    404,
    `/tasks/${assigned.id}`,
    'PATCH',
    { status: 'DONE' },
    boss.token,
  );
  assert.ok(
    !(await expectHttp(200, '/tasks/me', 'GET', undefined, other.token)).some(
      (t) => t.id === assigned.id,
    ),
  );
  await expectHttp(400, `/tasks/${assigned.id}`, 'PATCH', {
    status: 'BLOCKED',
  });
  await expectHttp(200, `/tasks/${assigned.id}`, 'PATCH', {
    status: 'BLOCKED',
    blockedReason: 'Besoin de précision',
  });
  await expectHttp(
    201,
    `/tasks/${assigned.id}/comments`,
    'POST',
    { text: 'Précision' },
    boss.token,
  );
  await expectHttp(200, `/tasks/${assigned.id}`, 'PATCH', { status: 'DONE' });
  let task = (await expectHttp(200, '/tasks/me')).find(
    (t) => t.id === assigned.id,
  );
  assert.ok(task.completedAt);
  assert.equal(task.comments.length, 1);
  await expectHttp(200, `/tasks/${assigned.id}`, 'PATCH', { status: 'TODO' });
  assert.equal(
    (await db.dailyTask.findUnique({ where: { id: assigned.id } })).completedAt,
    null,
  );
  await expectHttp(403, '/announcements', 'POST', { title: 'x', body: 'y' });
  const announcement = await expectHttp(
    201,
    '/announcements',
    'POST',
    { title: 'Annonce', body: 'Texte' },
    boss.token,
  );
  assert.ok(
    (await expectHttp(200, '/announcements')).some(
      (n) => n.id === announcement.id,
    ),
  );
  assert.equal(
    (await expectHttp(200, '/announcements', 'GET', undefined, foreign.token))
      .length,
    0,
  );
  let events = await expectHttp(200, '/day-events');
  const birthday = events.find(
    (e) => e.type === 'BIRTHDAY' && e.subject.id === me.employee.id,
  );
  assert.ok(birthday);
  assert.equal(birthday.day, Number(today.slice(8)));
  assert.ok(!JSON.stringify(events).includes('1992'));
  assert.ok(!('dateOfBirth' in birthday.subject));
  assert.equal(
    (await expectHttp(200, '/day-events')).find((e) => e.type === 'BIRTHDAY')
      .id,
    birthday.id,
  );
  const expiry = (
    await db.dailyEvent.findUnique({ where: { id: birthday.id } })
  ).expiresAt;
  await db.dailyEvent.update({
    where: { id: birthday.id },
    data: { expiresAt: new Date(0) },
  });
  await expectHttp(404, `/day-events/${birthday.id}/reactions`, 'POST', {
    emoji: '🎉',
  });
  await db.dailyEvent.update({
    where: { id: birthday.id },
    data: { expiresAt: expiry },
  });
  await db.employee.update({
    where: { id: me.employee.id },
    data: { status: 'TERMINATED' },
  });
  await expectHttp(404, `/day-events/${birthday.id}/reactions`, 'POST', {
    emoji: '🎉',
  });
  await db.employee.update({
    where: { id: me.employee.id },
    data: { status: 'ACTIVE' },
  });
  await expectHttp(
    404,
    `/day-events/${birthday.id}/reactions`,
    'POST',
    { emoji: '🎉' },
    foreign.token,
  );
  await expectHttp(400, `/day-events/${birthday.id}/reactions`, 'POST', {
    emoji: '🔥',
  });
  await expectHttp(201, `/day-events/${birthday.id}/reactions`, 'POST', {
    emoji: '🎉',
  });
  assert.equal(
    (await expectHttp(200, '/day-events'))
      .find((e) => e.id === birthday.id)
      .reactions.find((r) => r.emoji === '🎉').count,
    1,
  );
  await Promise.all([
    expectHttp(201, `/day-events/${birthday.id}/reactions`, 'POST', {
      emoji: '🎉',
    }),
    expectHttp(201, `/day-events/${birthday.id}/reactions`, 'POST', {
      emoji: '🎉',
    }),
  ]);
  assert.equal(
    await db.dailyReaction.count({
      where: { eventId: birthday.id, userId: me.id },
    }),
    1,
  );
  const mine = await expectHttp(200, '/anniversaries/notifications');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].subjectId, me.employee.id);
  const adminNotes = await expectHttp(
    200,
    '/anniversaries/notifications',
    'GET',
    undefined,
    boss.token,
  );
  assert.equal(adminNotes.length, 3);
  await expectHttp(
    404,
    `/anniversaries/notifications/${mine[0].id}/read`,
    'PATCH',
    {},
    boss.token,
  );
  await expectHttp(
    200,
    `/anniversaries/notifications/${mine[0].id}/read`,
    'PATCH',
    {},
  );
  assert.equal(
    (await expectHttp(200, '/anniversaries/notifications'))[0].read,
    true,
  );
  assert.equal(
    await db.anniversaryReceipt.count({
      where: { companyId: a.id, recipientId: me.id },
    }),
    1,
  );
  await db.publicHoliday.create({
    data: {
      companyId: a.id,
      name: 'Jour test',
      date: today,
      year: Number(today.slice(0, 4)),
    },
  });
  for (const e of [colleague.employee, other.employee])
    await db.leave.create({
      data: {
        companyId: a.id,
        employeeId: e.id,
        type: 'ANNUAL',
        status: 'APPROVED',
        startDate: date,
        endDate: date,
        daysCount: 1,
        reason: 'Ne jamais exposer ce motif',
      },
    });
  const shift = await db.workShift.create({
    data: {
      companyId: a.id,
      name: 'Equipe matin',
      startHour: 7,
      startMinute: 30,
      endHour: 15,
      endMinute: 30,
      durationHours: 8,
    },
  });
  await db.employeeShiftAssignment.create({
    data: {
      companyId: a.id,
      employeeId: me.employee.id,
      shiftId: shift.id,
      specificDate: today,
    },
  });
  let overview = await expectHttp(200, '/day-overview/me');
  assert.equal(overview.holidays[0].label, 'Jour test');
  assert.deepEqual(overview.schedule, [
    { label: 'Equipe matin', start: '07:30', end: '15:30' },
  ]);
  assert.equal(overview.absentColleagues.length, 1);
  assert.ok(!JSON.stringify(overview).includes('motif'));
  assert.equal(
    (await expectHttp(200, '/day-overview/me', 'GET', undefined, boss.token))
      .absentColleagues.length,
    2,
  );
  assert.equal(
    (await expectHttp(200, '/day-overview/me', 'GET', undefined, foreign.token))
      .holidays.length,
    0,
  );
  await db.employeeShiftAssignment.deleteMany({
    where: { employeeId: me.employee.id },
  });
  assert.equal((await expectHttp(200, '/day-overview/me')).schedule.length, 0);
  await db.employeeShiftAssignment.create({
    data: {
      companyId: a.id,
      employeeId: me.employee.id,
      shiftId: shift.id,
      dayOfWeek: congoDayOfWeek(new Date()),
    },
  });
  assert.equal(
    (await expectHttp(200, '/day-overview/me')).schedule[0].start,
    '07:30',
  );
  const colors = {
    accent: '#123456',
    ambianceLight: 'warm',
    ambianceDark: 'graphite',
  };
  assert.equal(
    (await expectHttp(200, '/appearance/me')).effective.source,
    'DEFAULT',
  );
  await expectHttp(200, '/users/me/appearance', 'PATCH', {
    mode: 'dark',
    colors: null,
  });
  await expectHttp(403, '/users/me/appearance', 'PATCH', {
    mode: 'dark',
    colors,
  });
  await expectHttp(
    403,
    `/companies/${a.id}/appearance`,
    'PATCH',
    { colors, allowEmployeeCustomization: true },
    hr.token,
  );
  await expectHttp(
    403,
    `/companies/${b.id}/appearance`,
    'PATCH',
    { colors, allowEmployeeCustomization: true },
    boss.token,
  );
  await expectHttp(
    400,
    `/companies/${a.id}/appearance`,
    'PATCH',
    { colors, allowEmployeeCustomization: 'false' },
    boss.token,
  );
  await expectHttp(400, '/users/me/appearance', 'PATCH', {
    mode: 'dark',
    colors: { ...colors, accent: 'red' },
  });
  await expectHttp(400, '/users/me/appearance', 'PATCH', { mode: 'dark' });
  await expectHttp(
    200,
    `/companies/${a.id}/appearance`,
    'PATCH',
    { colors, allowEmployeeCustomization: true },
    boss.token,
  );
  assert.equal(
    (await expectHttp(200, '/appearance/me')).effective.source,
    'COMPANY',
  );
  const personalColors = { ...colors, accent: '#ABCDEF' };
  await expectHttp(200, '/users/me/appearance', 'PATCH', {
    mode: 'auto',
    colors: personalColors,
  });
  assert.equal(
    (await expectHttp(200, '/appearance/me')).effective.source,
    'USER',
  );
  await expectHttp(
    200,
    `/companies/${a.id}/appearance`,
    'PATCH',
    { colors, allowEmployeeCustomization: false },
    boss.token,
  );
  await expectHttp(200, '/users/me/appearance', 'PATCH', {
    mode: 'light',
    colors: personalColors,
  });
  assert.equal(
    (await expectHttp(200, '/appearance/me')).effective.source,
    'COMPANY',
  );
  await expectHttp(
    200,
    `/companies/${a.id}/appearance`,
    'PATCH',
    { colors, allowEmployeeCustomization: true },
    boss.token,
  );
  assert.equal(
    (await expectHttp(200, '/appearance/me')).effective.colors.accent,
    '#ABCDEF',
  );
  const persisted = await db.company.findUnique({ where: { id: a.id } });
  assert.equal(persisted.primaryColor, a.primaryColor);
  assert.equal(persisted.secondaryColor, a.secondaryColor);
  assert.ok(
    await db.activityLog.count({
      where: { entityId: a.id, entity: 'COMPANY_APPEARANCE' },
    }),
  );
  // Execute the actual frontend adapters and shared HTTP client against Nest HTTP.
  // Only browser cookie transport and actor lookup are supplied by this Node harness.
  const path = require('node:path'),
    fs = require('node:fs'),
    Module = require('node:module'),
    ts = require('typescript');
  const front = path.resolve(__dirname, '../../frontend'),
    cache = new Map();
  process.env.NEXT_PUBLIC_API_URL = base;
  const browserFetch = global.fetch;
  global.fetch = (url, init = {}) =>
    browserFetch(url, {
      ...init,
      headers: { ...init.headers, Cookie: 'access_token=' + token },
    });
  function load(relative) {
    const file = path.join(front, relative + '.ts');
    if (cache.has(file)) return cache.get(file).exports;
    const m = { exports: {} };
    cache.set(file, m);
    const localRequire = (p) =>
      p === './context'
        ? {
            featureActor: () => ({ id: me.id, companyId: a.id, role: 'ADMIN' }),
          }
        : p.startsWith('@/')
          ? load(p.slice(2))
          : require(p);
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
    )(localRequire, m, m.exports);
    return m.exports;
  }
  const tasks = load('lib/data/tasks.api').tasksApi;
  const ft = await tasks.createPersonal('Par le front');
  assert.ok((await tasks.list('me')).some((t) => t.id === ft.id));
  await tasks.update(ft.id, 'DONE');
  await tasks.comment(ft.id, 'Connexion réelle');
  assert.ok((await load('lib/data/day-events.api').dayEventsApi.list()).length);
  await load('lib/data/day-events.api').dayEventsApi.react(birthday.id, '👏');
  assert.ok(
    (await load('lib/data/announcements.api').announcementsApi.list()).length,
  );
  const an = load('lib/data/anniversaries.api').anniversariesApi;
  assert.ok((await an.list()).length);
  await an.markRead(mine[0].id);
  assert.ok(
    (await load('lib/data/day-overview.api').dayOverviewApi.get()).schedule
      .length,
  );
  const appearance = load('lib/data/appearance.api').appearanceApi;
  assert.equal((await appearance.get()).user.mode, 'light');
  await appearance.saveUser({ mode: 'auto', colors: personalColors });
  token = boss.token;
  await appearance.saveCompany({
    colors: null,
    allowEmployeeCustomization: false,
  });
  await tasks.assign('Par le front admin', [me.id]);
  assert.ok(
    (await tasks.list('admin')).some((t) => t.title === 'Par le front admin'),
  );
  assert.equal(
    (
      await load('lib/data/announcements.api').announcementsApi.create(
        'Front annonce',
        'Contrat vérifié',
      )
    ).title,
    'Front annonce',
  );
  await db.userSession.update({
    where: { jti: jwt.decode(foreign.token).sid },
    data: { revokedAt: new Date() },
  });
  global.fetch = browserFetch;
  await expectHttp(401, '/appearance/me', 'GET', undefined, foreign.token);
  const newClient = new PrismaClient({ log: [] });
  try {
    assert.equal(
      (await newClient.user.findUnique({ where: { id: me.id } }))
        .interfaceAppearance.mode,
      'auto',
    );
    assert.equal(
      (await newClient.dailyTask.findUnique({ where: { id: ft.id } })).status,
      'DONE',
    );
  } finally {
    await newClient.$disconnect();
  }
  global.fetch = browserFetch;
  console.log(
    `PASS: ${checks} contrôles HTTP + six adaptateurs front, cookies/JWT, PostgreSQL, persistance et isolation.`,
  );
}
main()
  .catch((e) => {
    console.error(
      e instanceof assert.AssertionError
        ? e.message
        : 'Échec du test : ' +
            (e.code || e.name) +
            ' ' +
            String(e.message).split('\n').slice(-3).join(' '),
    );
    console.error(
      String(e.stack)
        .split('\n')
        .filter((l) => /^\s+at /.test(l))
        .slice(-4)
        .join('\n'),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.close();
    // Never erase existing data: the UUID lists are populated only by company()/user().
    if (fixtureUsers.length)
      await db.activityLog.deleteMany({
        where: { userId: { in: fixtureUsers } },
      });
    if (fixtureUsers.length)
      await db.user.deleteMany({ where: { id: { in: fixtureUsers } } });
    if (fixtureCompanies.length)
      await db.company.deleteMany({ where: { id: { in: fixtureCompanies } } });
    await db.$disconnect();
  });
