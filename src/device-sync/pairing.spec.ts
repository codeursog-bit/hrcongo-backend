import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DeviceSyncProcessor } from './device-sync-processor.service';
import { DeviceSyncService } from './device-sync.service';
import { generatePairingCode, hashPairingCode, normalizePairingCode } from './pairing';

const prisma = {
  syncConnector: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
};

describe('device connector pairing', () => {
  let service: DeviceSyncService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DeviceSyncService(
      prisma as unknown as PrismaService,
      {} as DeviceSyncProcessor,
    );
  });

  it('generates normalized codes from the unambiguous alphabet', () => {
    const code = generatePairingCode();

    expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
    expect(normalizePairingCode(' k7mq-4xht ')).toBe('K7MQ4XHT');
    expect(hashPairingCode('k7mq 4xht')).toBe(hashPairingCode('K7MQ-4XHT'));
  });

  it('exchanges a valid one-time code for a hashed agent key', async () => {
    const code = generatePairingCode();
    const hash = hashPairingCode(code);
    const connector = {
      id: 'connector-1',
      name: 'Accueil Brazzaville',
      kind: 'ZKTECO_NETWORK',
      isActive: true,
      pairingExpiresAt: new Date(Date.now() + 60_000),
    };
    prisma.syncConnector.findUnique.mockResolvedValue(connector);
    prisma.syncConnector.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.pair(code.toLowerCase());

    expect(prisma.syncConnector.findUnique).toHaveBeenCalledWith({
      where: { pairingCodeHash: hash },
    });
    expect(result).toMatchObject({
      kind: connector.kind,
      connectorName: connector.name,
    });
    expect(result.agentKey).toMatch(/^kzs_[a-f0-9]{48}$/);
    expect(prisma.syncConnector.updateMany).toHaveBeenCalledWith({
      where: { id: connector.id, pairingCodeHash: hash },
      data: expect.objectContaining({
        agentKeyHash: expect.any(String),
        agentKeyHint: result.agentKey.slice(-4),
        pairingCodeHash: null,
        pairingExpiresAt: null,
      }),
    });
    expect(prisma.syncConnector.updateMany.mock.calls[0][0].data.agentKeyHash).not.toBe(result.agentKey);
  });

  it('rejects malformed, inactive, expired, or already-consumed codes', async () => {
    await expect(service.pair('short')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.syncConnector.findUnique).not.toHaveBeenCalled();

    const validCode = generatePairingCode();
    const connector = {
      id: 'connector-1',
      name: 'Accueil Brazzaville',
      kind: 'ZKTECO_NETWORK',
      isActive: true,
      pairingExpiresAt: new Date(Date.now() - 1_000),
    };
    prisma.syncConnector.findUnique.mockResolvedValue(connector);

    await expect(service.pair(validCode)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.syncConnector.updateMany).not.toHaveBeenCalled();

    prisma.syncConnector.findUnique.mockResolvedValue({
      ...connector,
      isActive: false,
      pairingExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.pair(validCode)).rejects.toBeInstanceOf(BadRequestException);

    prisma.syncConnector.findUnique.mockResolvedValue({
      ...connector,
      pairingExpiresAt: new Date(Date.now() + 60_000),
    });
    prisma.syncConnector.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.pair(validCode)).rejects.toBeInstanceOf(BadRequestException);
  });
});
