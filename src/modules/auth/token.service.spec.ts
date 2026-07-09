jest.mock('../../prisma/prisma.service');

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';

const env: Record<string, unknown> = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_ACCESS_TTL: 900,
  JWT_REFRESH_TTL: 604800,
};
const config = { get: jest.fn((key: string) => env[key]) };

interface MockRefreshToken {
  create: jest.Mock<any>;

  findUnique: jest.Mock<any>;

  update: jest.Mock<any>;

  updateMany: jest.Mock<any>;
}

interface MockPrisma {
  refreshToken: MockRefreshToken;

  $transaction: jest.Mock<any>;
}

function makePrisma(): MockPrisma {
  return {
    refreshToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prismaTx),
    ),
  };
}

interface MockTx {
  refreshToken: MockRefreshToken;
}

const prismaTx: MockTx = {
  refreshToken: {
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({}),
  },
};

const user = { id: 'u1', email: 'a@b.c', role: 'USER' };

describe('TokenService', () => {
  let prisma: MockPrisma;
  let service: TokenService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrisma();
    service = new TokenService(
      new JwtService({}),
      config as never,
      prisma as never,
    );
  });

  it('issueTokens menyimpan hash refresh token, bukan token mentah', async () => {
    const { accessToken, refreshToken } = await service.issueTokens(user);
    expect(accessToken).not.toEqual(refreshToken);
    const calls = prisma.refreshToken.create.mock.calls as unknown as Array<
      [{ data: { tokenHash: string; userId: string } }]
    >;
    const saved = calls[0][0].data;
    expect(saved.tokenHash).toHaveLength(64); // sha256 hex
    expect(saved.tokenHash).not.toEqual(refreshToken);
    expect(saved.userId).toBe('u1');
  });

  it('rotate menolak token yang tidak ada di DB', async () => {
    const { refreshToken } = await service.issueTokens(user);
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.rotate(refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rotate mendeteksi reuse: token revoked → revoke semua session user', async () => {
    const { refreshToken } = await service.issueTokens(user);
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      userId: 'u1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 10_000),
    });
    await expect(service.rotate(refreshToken)).rejects.toThrow(
      'Sesi tidak valid, silakan login ulang.',
    );

    const updateManySpy = prisma.refreshToken
      .updateMany as unknown as jest.SpyInstance;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const expectData = { revokedAt: expect.any(Date) };
    (
      expect(updateManySpy) as unknown as jest.Matchers<void>
    ).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: expectData,
    });
  });

  it('rotate sukses memakai transaction: revoke lama + create baru', async () => {
    const { refreshToken } = await service.issueTokens(user);
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      userId: 'u1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 10_000),
    });
    const result = await service.rotate(refreshToken);
    expect(result.refreshToken).not.toEqual(refreshToken);

    expect(prisma.$transaction).toHaveBeenCalled();

    const updateSpy = prismaTx.refreshToken
      .update as unknown as jest.SpyInstance;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const expectUpdateData = { revokedAt: expect.any(Date) };
    (expect(updateSpy) as unknown as jest.Matchers<void>).toHaveBeenCalledWith({
      where: { id: 'rt1' },
      data: expectUpdateData,
    });

    expect(prismaTx.refreshToken.create).toHaveBeenCalled();
  });

  it('rotate menolak JWT dengan signature salah', async () => {
    await expect(service.rotate('bukan.jwt.valid')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
