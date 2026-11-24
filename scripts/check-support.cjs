/* Real local Nest/PostgreSQL round trips; mail is captured, never sent. */
require('dotenv').config({ quiet: true });
process.env.NODE_ENV = 'test';
const { randomUUID, randomBytes, createHash } = require('node:crypto');
process.env.CHAT_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
require('ts-node').register({ transpileOnly: true });
require('reflect-metadata');
const assert = require('node:assert/strict'),
  jwt = require('jsonwebtoken'),
  bcrypt = require('bcrypt');
const { Test } = require('@nestjs/testing'),
  { ValidationPipe } = require('@nestjs/common'),
  { ConfigModule } = require('@nestjs/config'),
  { PassportModule } = require('@nestjs/passport'),
  { PrismaClient } = require('@prisma/client');
const { SupportModule } = require('../src/support/support.module'),
  { SupportService } = require('../src/support/support.service'),
  { ContactModule } = require('../src/contact/contact.module'),
  { MailModule } = require('../src/mail/mail.module'),
  { MailService } = require('../src/mail/mail.service'),
  { JwtStrategy } = require('../src/auth/jwt.strategy'),
  { UltraAdminGuard } = require('../src/admin/guards/ultra-admin.guard'),
  { isDailyPrivateRoute } = require('../src/daily-workspace/daily-privacy');
const db = new PrismaClient({ log: [] }),
  users = [],
  companies = [],
  tickets = [],
  contacts = [],
  mails = [];
let app,
  base,
  checks = 0;
async function request(path, method = 'GET', body, token, status = 200) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  assert.equal(res.status, status, path + ' ' + JSON.stringify(data));
  checks++;
  return data;
}
async function session(id, companyId = null) {
  const sid = randomUUID();
  await db.userSession.create({
    data: { userId: id, jti: sid, expiresAt: new Date(Date.now() + 3600000) },
  });
  return jwt.sign(
    { sub: id, sid, type: 'access', companyId, role: 'SUPER_ADMIN' },
    process.env.JWT_SECRET || 'secretKey_change_in_production_123!',
    { expiresIn: '1h' },
  );
}
async function user(role = 'EMPLOYEE', companyId = null) {
  const id = randomUUID();
  users.push(id);
  await db.user.create({
    data: {
      id,
      email: id + '@example.test',
      firstName: 'Fixture',
      lastName: role,
      role,
      companyId,
      password: 'unused-fixture',
    },
  });
  return { id, token: await session(id, companyId) };
}
const msg = (body) => ({ body, clientId: randomUUID() });
async function main() {
  const { Controller, Get, UseGuards } = require('@nestjs/common'),
    { JwtAuthGuard } = require('../src/auth/jwt-auth.guard');
  class BusinessProbe {
    read() {
      return { ok: true };
    }
  }
  Controller('companies')(BusinessProbe);
  UseGuards(JwtAuthGuard)(BusinessProbe);
  Get('support-policy-probe')(
    BusinessProbe.prototype,
    'read',
    Object.getOwnPropertyDescriptor(BusinessProbe.prototype, 'read'),
  );
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  );
  const module = await Test.createTestingModule({
    controllers: [BusinessProbe],
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      PassportModule,
      MailModule,
      SupportModule,
      ContactModule,
    ],
    providers: [JwtStrategy],
  })
    .overrideProvider(MailService)
    .useValue({
      sendContactNotification: async (p) => {
        mails.push(p);
        return true;
      },
      sendSupportReceipt: async (to, path) => {
        mails.push({ to, path });
        return true;
      },
      sendSupportNotice: async (to) => {
        mails.push({ to });
        return true;
      },
    })
    .compile();
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
  // Do not import unrelated existing contact records while running fixtures.
  const supportService=app.get(SupportService),importLegacy=supportService.importContacts.bind(supportService);
  supportService.importContacts = async () => {};
  const companyId = randomUUID();
  companies.push(companyId);
  await db.company.create({
    data: {
      id: companyId,
      legalName: 'Support fixture',
      rccmNumber: companyId,
      address: 'Test',
      city: 'Test',
      phone: '0',
      email: companyId + '@example.test',
    },
  });
  const superAdmin = await user('SUPER_ADMIN'),
    customer = await user('ADMIN', companyId),
    other = await user('EMPLOYEE', companyId),
    noCompany = await user(),
    foreign = await user('ADMIN');
  await request('/support/tickets', 'GET', undefined, undefined, 401);
  await request(
    '/admin/support/tickets',
    'GET',
    undefined,
    customer.token,
    403,
  );
  const agentData = {
    email: randomUUID() + '@example.test',
    firstName: 'Agent',
    lastName: 'Fixture',
    password: randomBytes(18).toString('hex'),
  };
  await request(
    '/admin/support/agents',
    'POST',
    agentData,
    customer.token,
    403,
  );
  const agent = await request(
    '/admin/support/agents',
    'POST',
    agentData,
    superAdmin.token,
  );
  users.push(agent.id);
  const token = await session(agent.id);
  const stored = await db.user.findUnique({ where: { id: agent.id } });
  assert.equal(stored.role, 'SUPPORT');
  assert.equal(stored.companyId, null);
  assert.equal(stored.mustChangePassword, true);
  assert.ok(await bcrypt.compare(agentData.password, stored.password));
  await request(
    '/companies/support-policy-probe',
    'GET',
    undefined,
    token,
    403,
  );
  await request(
    '/companies/support-policy-probe',
    'GET',
    undefined,
    customer.token,
  );
  assert.ok(!JSON.stringify(agent).includes('password'));
  await request(
    '/admin/support/agents',
    'POST',
    { ...agentData, email: randomUUID() + '@example.test' },
    token,
    403,
  );
  const legacy=await db.contactMessage.create({data:{name:'Ancien contact',email:randomUUID()+'@example.test',subject:'Support technique',message:'Ancien message avant la boîte support.'}});contacts.push(legacy.id);
  const delegate=supportService.db.contactMessage,originalFind=delegate.findMany;
  try{delegate.findMany=args=>originalFind({...args,where:{...args.where,id:legacy.id}});await importLegacy();}finally{delegate.findMany=originalFind;}
  const imported=await db.supportTicket.findUnique({where:{contactId:legacy.id}});assert.ok(imported);tickets.push(imported.id);
  await request('/admin/support/tickets/'+imported.id+'/messages','POST',msg('Nous reprenons votre demande.'),token);
  const legacyParams=new URLSearchParams(mails.filter(m=>m.path).at(-1).path.split('#')[1]);assert.equal(legacyParams.get('id'),imported.id);assert.equal((await request('/support/guest/read','POST',{id:imported.id,token:legacyParams.get('token')})).messages.length,2);
  await request(
    '/admin/support/agents/' + agent.id,
    'PATCH',
    { isActive: 'false' },
    superAdmin.token,
    400,
  );
  assert.throws(() =>
    new UltraAdminGuard().canActivate({
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: 'SUPPORT' } }),
      }),
    }),
  );
  const draft = {
    subject: 'Incident avec mon dossier',
    category: 'INCIDENT',
    ...msg('Mon document ne s’ouvre pas.'),
  };
  for (const category of ['SUGGESTION', 'FEEDBACK']) {
    const idea = await request('/support/tickets', 'POST', { subject: 'Retour produit de test', category, ...msg('Une amélioration à étudier.') }, customer.token);
    tickets.push(idea.id);
    const inbox = await request('/admin/support/tickets', 'GET', undefined, superAdmin.token);
    assert.equal(inbox.tickets.find(t => t.id === idea.id)?.category, category);
    const messages = await request('/support/tickets/' + idea.id + '/messages', 'GET', undefined, customer.token);
    assert.ok(JSON.stringify(messages).includes('amélioration'));
  }
  const opened = await request(
    '/support/tickets',
    'POST',
    draft,
    customer.token,
  );
  tickets.push(opened.id);
  assert.equal(
    (await request('/support/tickets', 'POST', draft, customer.token)).id,
    opened.id,
  );
  assert.equal(
    (await request('/support/tickets', 'GET', undefined, other.token)).total,
    0,
  );
  await request(
    '/support/tickets/' + opened.id + '/messages',
    'GET',
    undefined,
    other.token,
    404,
  );
  await request(
    '/support/tickets/' + opened.id + '/messages',
    'POST',
    msg('Essai interdit'),
    foreign.token,
    404,
  );
  const second = await request(
    '/support/tickets',
    'POST',
    {
      subject: 'Sans entreprise',
      category: 'QUESTION',
      ...msg('Puis-je être accompagné ?'),
    },
    noCompany.token,
  );
  tickets.push(second.id);
  assert.equal(
    (await request('/support/tickets', 'GET', undefined, noCompany.token))
      .total,
    1,
  );
  const inbox = await request(
    '/admin/support/tickets',
    'GET',
    undefined,
    token,
  );
  assert.ok(inbox.tickets.some((t) => t.id === opened.id));
  assert.ok(inbox.tickets.some((t) => t.id === second.id));
  assert.ok(inbox.tickets.find((t) => t.id === opened.id).unread);
  const reply = msg('Bonjour, décrivez le message affiché.');
  const sent = await request(
    '/admin/support/tickets/' + opened.id + '/messages',
    'POST',
    reply,
    token,
  );
  assert.equal(sent.side, 'STAFF');
  assert.equal(sent.notificationSent, true);
  assert.equal(
    (
      await request(
        '/admin/support/tickets/' + opened.id + '/messages',
        'POST',
        reply,
        superAdmin.token,
        409,
      )
    ).statusCode,
    409,
  );
  const duplicate = await request(
    '/admin/support/tickets/' + opened.id + '/messages',
    'POST',
    reply,
    token,
  );
  assert.equal(duplicate.id, sent.id);
  const note = await request(
    '/admin/support/tickets/' + opened.id + '/messages',
    'POST',
    { ...msg('Vérification interne uniquement'), internal: true },
    token,
  );
  const publicThread = await request(
    '/support/tickets/' + opened.id + '/messages',
    'GET',
    undefined,
    customer.token,
  );
  assert.ok(publicThread.messages.some((m) => m.id === sent.id));
  assert.ok(!publicThread.messages.some((m) => m.id === note.id));
  assert.ok(!JSON.stringify(publicThread).includes('requesterEmail'));
  assert.equal(publicThread.ticket.status, 'IN_PROGRESS');
  await request(
    '/support/tickets/' + opened.id + '/messages',
    'POST',
    { ...msg('Fausse note'), internal: true },
    customer.token,
    403,
  );
  await request(
    '/support/tickets/' + opened.id + '/messages',
    'POST',
    { ...msg('Mauvais booléen'), internal: 'false' },
    customer.token,
    400,
  );
  await request(
    '/support/tickets/' + opened.id + '/messages',
    'POST',
    { ...msg('Essai identifiant note'), clientId: note.clientId },
    customer.token,
    409,
  );
  await request(
    '/admin/support/tickets/' + opened.id,
    'PATCH',
    { assigneeId: other.id },
    token,
    400,
  );
  await request(
    '/admin/support/tickets/' + opened.id,
    'PATCH',
    { assigneeId: agent.id, priority: 'HIGH', status: 'RESOLVED' },
    superAdmin.token,
  );
  await request(
    '/admin/support/tickets/' + opened.id,
    'PATCH',
    { status: 'RESOLVED' },
    customer.token,
    403,
  );
  await request(
    '/support/tickets/' + opened.id + '/messages',
    'POST',
    msg('Voici les précisions demandées.'),
    customer.token,
  );
  assert.equal(
    (
      await request(
        '/admin/support/tickets/' + opened.id + '/messages',
        'GET',
        undefined,
        token,
      )
    ).ticket.status,
    'OPEN',
  );
  assert.ok(
    (
      await request(
        '/admin/support/tickets/' + opened.id + '/messages',
        'GET',
        undefined,
        superAdmin.token,
      )
    ).messages.some((m) => m.id === note.id),
  );
  const raw = await db.supportMessage.findMany({
    where: { ticketId: opened.id },
  });
  assert.ok(
    raw.every((m) => m.body.startsWith('v1:') && !m.body.includes('interne')),
  );
  const contact = await request('/contact', 'POST', {
    name: 'Visiteur Test',
    email: randomUUID() + '@example.test',
    subject: 'Support technique',
    message: 'Bonjour, ma demande vient du site public.',
  });
  contacts.push(contact.id);
  assert.equal(contact.emailSent, true);
  const tracking = new URLSearchParams(contact.trackingPath.split('#')[1]),
    guest = { id: tracking.get('id'), token: tracking.get('token') };
  tickets.push(guest.id);
  const guestRecord = await db.supportTicket.findUnique({
    where: { id: guest.id },
  });
  assert.equal(
    guestRecord.guestTokenHash,
    createHash('sha256').update(guest.token).digest('hex'),
  );
  assert.ok(!JSON.stringify(guestRecord).includes(guest.token));
  assert.equal(
    (await request('/support/guest/read', 'POST', guest)).messages.length,
    1,
  );
  await request(
    '/support/guest/read',
    'POST',
    { ...guest, token: 'f'.repeat(64) },
    undefined,
    404,
  );
  await request(
    '/support/tickets/' + guest.id + '/messages',
    'GET',
    undefined,
    noCompany.token,
    404,
  );
  await request(
    '/admin/support/tickets/' + guest.id + '/messages',
    'POST',
    msg('Bienvenue, nous avons reçu votre demande.'),
    token,
  );
  await request(
    '/admin/support/tickets/' + guest.id + '/messages',
    'POST',
    { ...msg('Une note confidentielle'), internal: true },
    token,
  );
  const guestThread = await request('/support/guest/read', 'POST', guest);
  assert.equal(guestThread.messages.length, 2);
  assert.ok(guestThread.messages.every((m) => !m.internal));
  await request('/support/guest/messages', 'POST', {
    ...guest,
    ...msg('Merci pour votre réponse.'),
  });
  assert.equal(
    (
      await request(
        '/admin/support/tickets/' + guest.id + '/messages',
        'GET',
        undefined,
        superAdmin.token,
      )
    ).messages.length,
    4,
  );
  await db.supportTicket.update({
    where: { id: guest.id },
    data: { guestExpiresAt: new Date(0) },
  });
  await request('/support/guest/read', 'POST', guest, undefined, 404);
  await request(
    '/admin/support/tickets/' + guest.id + '/messages',
    'POST',
    msg('Votre suivi est renouvelé.'),
    token,
  );
  const renewedParams = new URLSearchParams(
      mails
        .filter((m) => m.path)
        .at(-1)
        .path.split('#')[1],
    ),
    renewed = { id: guest.id, token: renewedParams.get('token') };
  assert.notEqual(renewed.token, guest.token);
  assert.ok(
    (await request('/support/guest/read', 'POST', renewed)).messages.length > 0,
  );
  await request(
    '/admin/support/tickets/' + guest.id + '/guest-link',
    'POST',
    {},
    customer.token,
    403,
  );
  assert.equal(
    (
      await request(
        '/admin/support/tickets/' + guest.id + '/guest-link',
        'POST',
        {},
        token,
      )
    ).sent,
    true,
  );
  await request('/support/guest/read', 'POST', renewed, undefined, 404);
  await request(
    '/admin/support/agents/' + agent.id,
    'PATCH',
    { isActive: false },
    superAdmin.token,
  );
  await request('/admin/support/tickets', 'GET', undefined, token, 401);
  assert.ok(
    await db.userSession.count({
      where: { userId: agent.id, revokedAt: { not: null } },
    }),
  );
  for (const path of [
    '/support/tickets',
    '/admin/support/agents',
    '/support/guest/read',
    '/contact',
  ])
    assert.ok(isDailyPrivateRoute(path));
  assert.ok(mails.length >= 3);
  const fs = require('node:fs'),
    path = require('node:path'),
    ts = require('typescript'),
    front = path.resolve(__dirname, '../../frontend');
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const m = { exports: {} };
    new Function(
      'require',
      'module',
      'exports',
      ts.transpileModule(fs.readFileSync(path.join(front, file), 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    )(
      (name) =>
        name === '@/services/api' ? load('services/api.ts') : require(name),
      m,
      m.exports,
    );
    cache.set(file, m.exports);
    return m.exports;
  }
  const originalFetch = global.fetch,
    originalApi = process.env.NEXT_PUBLIC_API_URL;
  process.env.NEXT_PUBLIC_API_URL = base;
  global.fetch = (url, options = {}) =>
    originalFetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: 'Bearer ' + customer.token,
      },
    });
  try {
    const { supportApi } = load('lib/support/api.ts');
    assert.ok(
      (await supportApi.list()).tickets.some((t) => t.id === opened.id),
    );
    const thread = await supportApi.messages(opened.id);
    assert.ok(thread.messages.every((m) => !m.internal));
    const sent = await supportApi.send(
      opened.id,
      msg('Message envoyé par le véritable adaptateur front.'),
    );
    assert.equal(sent.side, 'CUSTOMER');
  } finally {
    global.fetch = originalFetch;
    if (originalApi === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalApi;
  }
  console.log(
    `PASS: ${checks} HTTP support checks, real database, fresh roles, no-company accounts, guest tokens, private/internal messages, encryption, idempotence, assignment, agent revocation and captured mail.`,
  );
}
main()
  .catch((e) => {
    console.error(
      e instanceof assert.AssertionError
        ? e.message
        : e.name + ': ' + String(e.message).split('\n').slice(-2).join(' '),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.close();
    await db.supportTicket.deleteMany({ where: { id: { in: tickets } } });
    await db.contactMessage.deleteMany({ where: { id: { in: contacts } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.company.deleteMany({ where: { id: { in: companies } } });
    await db.$disconnect();
  });
