import { validateAccessSession } from './access-session';

describe('Access session authorization', () => {
  const payload = { type: 'access', sub: 'user', sid: 'session', role: 'SUPER_ADMIN', companyId: 'company' };
  const session = () => ({ userId: 'user', revokedAt: null, expiresAt: new Date(Date.now() + 60000), user: { isActive: true, role: 'EMPLOYEE', email: 'test@example.com' } });
  const prisma = (value: any) => ({ userSession: { findUnique: jest.fn().mockResolvedValue(value) } }) as any;

  it('uses the current role instead of an old privileged claim', async () => {
    expect((await validateAccessSession(prisma(session()), payload)).role).toBe('EMPLOYEE');
  });
  it.each(['refresh', 'reset', '2fa-pending'])('rejects %s tokens', async type => {
    await expect(validateAccessSession(prisma(session()), { ...payload, type })).rejects.toThrow();
  });
  it.each([
    null,
    { ...session(), revokedAt: new Date() },
    { ...session(), expiresAt: new Date(0) },
    { ...session(), userId: 'other' },
    { ...session(), user: { ...session().user, isActive: false } },
  ])('rejects missing, revoked, expired, foreign or disabled sessions', async value => {
    await expect(validateAccessSession(prisma(value), payload)).rejects.toThrow();
  });
  it('rejects legacy tokens without a session identifier', async () => {
    await expect(validateAccessSession(prisma(session()), { ...payload, sid: undefined })).rejects.toThrow();
  });
  it('uses the membership role immediately after a cabinet admin is demoted', async () => {
    const value = { ...session(), user: { ...session().user, role: 'CABINET_ADMIN' } };
    const db: any = prisma(value);
    db.cabinetUser = { findFirst: jest.fn().mockResolvedValue({ cabinetId: 'cabinet', role: 'GESTIONNAIRE' }) };
    const result = await validateAccessSession(db, { ...payload, cabinetId: 'cabinet' });
    expect(result.role).toBe('CABINET_GESTIONNAIRE');
    expect(db.cabinetUser.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: payload.sub, cabinetId: 'cabinet', cabinet: { isActive: true } } }));
  });
  it('rejects an existing cabinet session once membership is removed', async () => {
    const value = { ...session(), user: { ...session().user, role: 'CABINET_GESTIONNAIRE' } };
    const db: any = prisma(value);
    db.cabinetUser = { findFirst: jest.fn().mockResolvedValue(null) };
    await expect(validateAccessSession(db, payload)).rejects.toThrow();
  });
});
