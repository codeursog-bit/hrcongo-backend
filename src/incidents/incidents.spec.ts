import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IncidentsService } from './incidents.service';
import {
  incidentFingerprint,
  safeIncidentText,
  safeIncidentPath,
} from './incident-privacy';
import { ClientErrorDto } from './client-error.dto';
import { ClientErrorsController } from './client-errors.controller';
import { IncidentAlertsService } from './incident-alerts.service';
import { UltraAdminGuard } from '../admin/guards/ultra-admin.guard';
import { IncidentCron } from './incident-cron.decorator';
import { registerIncidentSink } from './incident-sink';
import { AdminIncidentsController, IncidentPreferencesDto } from './admin-incidents.controller';

describe('Incidents — confidentialité, regroupement et alertes', () => {
  const previous = { ...process.env };
  beforeEach(() => {
    process.env.INCIDENTS_ENABLED = 'true';
    process.env.INCIDENTS_ALERTS_ENABLED = 'true';
    process.env.INCIDENTS_EMAIL_ENABLED = 'true';
  });
  afterEach(() => {
    process.env = { ...previous };
    registerIncidentSink(undefined);
  });
  const event = {
    source: 'FRONT' as const,
    code: 'JS_ERROR',
    message: 'Failed employee 123',
    path: '/employees/123',
    userId: '00000000-0000-4000-8000-000000000001',
    companyId: '00000000-0000-4000-8000-000000000002',
  };
  it('regroupe deux erreurs à identifiants et nombres différents', () => {
    expect(incidentFingerprint(event)).toBe(
      incidentFingerprint({
        ...event,
        message: 'Failed employee 999',
        path: '/employees/999',
      }),
    );
    expect(
      safeIncidentPath(
        '/employees/11111111-2222-4333-8444-555555555555?token=secret',
      ),
    ).toBe('/employees/:id');
  });
  it('ne conserve ni secrets, paie, email, valeurs citées ni paramètres d’URL', () => {
    const result = safeIncidentText(
      'password=abc123 salary=713388 iban=CG1234567 cnss=123456 token=secret Bearer abc.def.ghi john@example.com "private content" https://app.test/paie/123?token=key',
    );
    for (const secret of [
      'abc123',
      '713388',
      'CG1234567',
      '123456',
      'secret',
      'abc.def.ghi',
      'john@example.com',
      'private content',
      'token=key',
    ])
      expect(result).not.toContain(secret);
  });
  it('refuse l’identité fournie dans le corps et les traces surdimensionnées', async () => {
    const dto = plainToInstance(ClientErrorDto, {
      message: 'boom',
      path: '/',
      code: 'JS_ERROR',
      userId: event.userId,
      companyId: event.companyId,
      breadcrumbs: Array.from({ length: 11 }, () => ({
        type: 'NAV',
        path: '/',
      })),
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['userId', 'companyId', 'breadcrumbs']),
    );
  });
  it('rattache le signalement uniquement à la session, limite IP/entreprise et ignore les robots', () => {
    const sink = { enabled: true, capture: jest.fn() },
      controller = new ClientErrorsController(sink as any),
      body = { message: 'boom', path: '/', code: 'JS_ERROR' } as ClientErrorDto;
    const request = {
      body,
      ip: '127.0.0.1',
      user: { userId: event.userId, companyId: event.companyId },
      headers: { 'user-agent': 'Firefox' },
    };
    controller.capture(request, body);
    expect(sink.capture.mock.calls[0][0]).toMatchObject({
      userId: event.userId,
      companyId: event.companyId,
    });
    for (let n = 0; n < 29; n++) controller.capture(request, body);
    expect(() => controller.capture(request, body)).toThrow('limités');
    controller.capture(
      { ...request, ip: '127.0.0.2', headers: { 'user-agent': 'crawler' } },
      body,
    );
    expect(sink.capture).toHaveBeenCalledTimes(30);
  });
  function storage() {
    let group: any = null;
    const actors = new Set<string>();
    const prisma: any = {
      errorGroup: {
        upsert: jest.fn(async ({ create, update }) => {
          if (!group)
            group = { ...create, id: 'group', status: 'NEW', count: 0 };
          else group = { ...group, ...update };
          return { ...group };
        }),
        update: jest.fn(async ({ data }) => {
          group = {
            ...group,
            ...data,
            count: data.count
              ? group.count + data.count.increment
              : group.count,
          };
          return { ...group };
        }),
      },
      errorGroupActor: {
        createMany: jest.fn(async ({ data }) => {
          for (const row of data) actors.add(`${row.kind}|${row.actorId}`);
        }),
        groupBy: jest.fn(async () =>
          ['COMPANY', 'USER'].map((kind) => ({
            kind,
            _count: {
              _all: [...actors].filter((key) => key.startsWith(kind + '|'))
                .length,
            },
          })),
        ),
      },
      appError: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((callback: any) => callback(prisma));
    const alerts = { notify: jest.fn().mockResolvedValue(undefined) },
      service = new IncidentsService(prisma, alerts as any);
    return {
      prisma,
      alerts,
      service,
      getGroup: () => group,
      resolve: () => {
        group.status = 'RESOLVED';
      },
    };
  }
  it('1000 erreurs identiques = un groupe, une écriture de lot et un compteur exact', async () => {
    const { service, prisma, alerts, getGroup } = storage();
    (service as any).flushing = true;
    for (let i = 0; i < 1000; i++) service.capture(event);
    (service as any).flushing = false;
    await service.flush();
    expect(getGroup().count).toBe(1000);
    expect(getGroup().companyCount).toBe(1);
    expect(getGroup().userCount).toBe(1);
    expect(prisma.appError.create).toHaveBeenCalledTimes(1);
    expect(prisma.appError.create.mock.calls[0][0].data.occurrences).toBe(1000);
    expect(alerts.notify).toHaveBeenCalledTimes(1);
  });
  it('fait régresser un groupe résolu sans créer un second groupe', async () => {
    const { service, prisma, alerts, getGroup, resolve } = storage();
    (service as any).flushing = true;
    service.capture(event);
    (service as any).flushing = false;
    await service.flush();
    resolve();
    (service as any).flushing = true;
    service.capture(event);
    (service as any).flushing = false;
    await service.flush();
    expect(getGroup().status).toBe('REGRESSED');
    expect(getGroup().count).toBe(2);
    expect(alerts.notify.mock.calls[1][2].regressed).toBe(true);
    expect(prisma.errorGroup.upsert.mock.calls[0][0].where).toEqual(
      prisma.errorGroup.upsert.mock.calls[1][0].where,
    );
  });
  it('réserve les incidents au SUPER_ADMIN, même sans entreprise', () => {
    const guard = new UltraAdminGuard();
    for (const role of [
      'ADMIN',
      'HR_MANAGER',
      'EMPLOYEE',
      'SUPPORT',
      'CABINET_ADMIN',
    ])
      expect(() =>
        guard.canActivate({
          switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
        } as any),
      ).toThrow();
    expect(
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({ user: { role: 'SUPER_ADMIN' } }),
        }),
      } as any),
    ).toBe(true);
  });
  function channels() {
    const keys = new Set();
    const prisma: any = {
      notificationDedupKey: {
        deleteMany: jest.fn().mockResolvedValue({}),
        create: jest.fn(async ({ data }) => {
          if (keys.has(data.key)) throw { code: 'P2002' };
          keys.add(data.key);
        }),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'admin', email: 'admin@test.cg', incidentEmailAlerts: true }]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      company: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            legalName: 'Entreprise',
            subscription: { plan: 'PRO' },
          }),
      },
    };
    const notifications = { create: jest.fn().mockResolvedValue({}) },
      push = {
        sendPushToUserDetailed: jest.fn().mockResolvedValue({ status: 'SENT' }),
      },
      mail = { sendIncidentAlert: jest.fn().mockResolvedValue(true) },
      gateway = {
        sendSuperAdminIncident: jest.fn().mockResolvedValue(undefined),
      };
    return {
      service: new IncidentAlertsService(
        prisma,
        notifications as any,
        push as any,
        mail as any,
        gateway as any,
      ),
      prisma,
      notifications,
      push,
      mail,
      gateway,
    };
  }
  const group = {
    id: 'group',
    fingerprint: 'fingerprint',
    severity: 'ERROR',
    count: 1000,
    firstSeen: new Date(),
    lastSeen: new Date(),
  };
  it('émet une seule alerte par incident durant le délai de dédoublonnage', async () => {
    const { service, notifications, push, mail, gateway } = channels();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        service.notify(group, event, {
          isNew: true,
          regressed: false,
          batchCount: 50,
        }),
      ),
    );
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(push.sendPushToUserDetailed).toHaveBeenCalledTimes(1);
    expect(mail.sendIncidentAlert).toHaveBeenCalledTimes(1);
    expect(gateway.sendSuperAdminIncident).toHaveBeenCalledTimes(1);
  });
  it('signale une panne mail par la notification persistée et conserve les autres canaux', async () => {
    const { service, notifications, mail, push } = channels();
    mail.sendIncidentAlert.mockResolvedValue(false);
    await service.notify(group, event, {
      isNew: true,
      regressed: false,
      batchCount: 1,
    });
    expect(notifications.create).toHaveBeenCalledTimes(2);
    expect(notifications.create.mock.calls[1][0].title).toBe(
      'Canal d’alerte indisponible',
    );
    expect(push.sendPushToUserDetailed).toHaveBeenCalledTimes(1);
  });
  it('conserve les erreurs faibles pour le résumé, mais alerte sur un pic', async () => {
    const { service, notifications } = channels();
    await service.notify({ ...group, severity: 'WARN' }, event, {
      isNew: true,
      regressed: false,
      batchCount: 1,
    });
    expect(notifications.create).not.toHaveBeenCalled();
    await service.notify({ ...group, severity: 'WARN' }, event, {
      isNew: false,
      regressed: false,
      batchCount: 50,
    });
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });
  it('ne transmet aucun e-mail sans consentement personnel, tout en gardant les alertes dans l’application', async () => {
    const {service,prisma,mail,notifications,gateway}=channels();
    prisma.user.findMany.mockResolvedValue([{id:'admin',email:'admin@test.cg',incidentEmailAlerts:false}]);
    await service.notify(group,event,{isNew:true,regressed:false,batchCount:1});
    expect(mail.sendIncidentAlert).not.toHaveBeenCalled();expect(notifications.create).toHaveBeenCalledTimes(1);expect(gateway.sendSuperAdminIncident).toHaveBeenCalledTimes(1);
  });
  it('respecte aussi la coupure globale du canal mail', async () => {
    process.env.INCIDENTS_EMAIL_ENABLED='false';const {service,mail}=channels();
    await service.notify(group,event,{isNew:true,regressed:false,batchCount:1});expect(mail.sendIncidentAlert).not.toHaveBeenCalled();
  });
  it('enregistre le choix mail uniquement sur le compte authentifié',async()=>{
    const prisma={user:{update:jest.fn().mockResolvedValue({incidentEmailAlerts:true})}};
    const controller=new AdminIncidentsController(prisma as any);
    expect(await controller.setPreferences({user:{userId:'current-admin'}},{emailEnabled:true})).toEqual({emailEnabled:true,emailAvailable:true});
    expect(prisma.user.update.mock.calls[0][0]).toMatchObject({where:{id:'current-admin'},data:{incidentEmailAlerts:true}});
    expect(await validate(plainToInstance(IncidentPreferencesDto,{emailEnabled:'false'},{enableImplicitConversion:true}))).not.toHaveLength(0);
  });
  it('le résumé quotidien ne sélectionne que les super admins ayant activé les e-mails',async()=>{
    const {service,prisma}=channels();prisma.errorGroup={findMany:jest.fn().mockResolvedValue([group])};
    await service.dailyDigest();
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({role:'SUPER_ADMIN',isActive:true,incidentEmailAlerts:true});
  });
  it('enveloppe un cron sans changer ses options ni avaler son erreur', async () => {
    const capture = jest.fn();
    registerIncidentSink(capture);
    class Job {
      @IncidentCron('0 8 * * *', { timeZone: 'Africa/Brazzaville' })
      async cnss() {
        throw new Error('DB unavailable');
      }
    }
    await expect(new Job().cnss()).rejects.toThrow('DB unavailable');
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'CRON',
        severity: 'CRITICAL',
        path: '/cron/Job.cnss',
        context: { durationMs: expect.any(Number) },
      }),
    );
    expect(
      Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', Job.prototype.cnss)
        ?.timeZone,
    ).toBe('Africa/Brazzaville');
  });
});
