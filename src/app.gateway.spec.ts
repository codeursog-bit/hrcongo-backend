import { AppGateway } from './app.gateway';

describe('Realtime notification authorization', () => {
  function setup(role = 'EMPLOYEE', revokedAt: Date | null = null) {
    const token = { type: 'access', sub: 'user', sid: 'session', companyId: 'company', exp: Math.floor(Date.now() / 1000) + 60 };
    const prisma = { userSession: { findUnique: jest.fn().mockResolvedValue({ userId: 'user', revokedAt, expiresAt: new Date(Date.now() + 60000), user: { role, isActive: true, email: 'qa@example.com' } }) } };
    const gateway = new AppGateway({ verify: jest.fn().mockReturnValue(token) } as any, prisma as any);
    const client = { id: 'socket', handshake: { headers: {}, auth: { token: 'signed' } }, data: { accessPayload: token }, join: jest.fn(), disconnect: jest.fn(), emit: jest.fn() };
    gateway.server = { in: jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([client]) }) } as any;
    return { gateway, client, token };
  }
  it('accepts an active session in its company room', async () => {
    const {gateway,client} = setup();
    await gateway.handleConnection(client as any);
    expect(client.join).toHaveBeenCalledWith('company:company');
  });
  it('rejects refresh tokens at connection', async () => {
    const {gateway,client,token} = setup(); token.type = 'refresh';
    await gateway.handleConnection(client as any);
    expect(client.disconnect).toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });
  it('does not deliver RH notifications to an employee', async () => {
    const {gateway,client} = setup();
    await (gateway as any).sendToActiveSessions('admin-notification', {companyId:'company'}, true);
    expect(client.emit).not.toHaveBeenCalled();
  });
  it('delivers RH notifications to current company HR', async () => {
    const {gateway,client} = setup('HR_MANAGER');
    await (gateway as any).sendToActiveSessions('admin-notification', {companyId:'company'}, true);
    expect(client.emit).toHaveBeenCalledTimes(1);
  });
  it('disconnects a revoked session before sending any content', async () => {
    const {gateway,client} = setup('ADMIN', new Date());
    await (gateway as any).sendToActiveSessions('company-notification', {companyId:'company'}, false);
    expect(client.emit).not.toHaveBeenCalled(); expect(client.disconnect).toHaveBeenCalled();
  });
  it('rejects delivery from another company', async () => {
    const {gateway,client} = setup('ADMIN');
    await (gateway as any).sendToActiveSessions('company-notification', {companyId:'other'}, false);
    expect(client.emit).not.toHaveBeenCalled();
  });
});
