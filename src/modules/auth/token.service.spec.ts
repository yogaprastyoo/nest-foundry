jest.mock('../../prisma/prisma.service');

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { mockDeep, mockReset, type DeepMockProxy } from 'jest-mock-extended';
import type { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from './token.service';

const env: Record<string, unknown> = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_ACCESS_TTL: 900,
  JWT_REFRESH_TTL: 604800,
};
const config = { get: jest.fn((key: string) => env[key]) };

// prismaTx is a separate mock representing the `tx` handle inside
// $transaction(async (tx) => ...) — kept distinct from prisma so a
// transactional call (e.g. tx.refreshToken.create) doesn't get conflated
// with a top-level call (e.g. prisma.refreshToken.create from issueTokens)
// when asserting toHaveBeenCalled/not.toHaveBeenCalled.
const prisma: DeepMockProxy<PrismaService> = mockDeep<PrismaService>();
const prismaTx: DeepMockProxy<PrismaService> = mockDeep<PrismaService>();

const user = { id: 'u1', email: 'user@example.test', role: 'USER' as const };

function refreshTokenRow(overrides: {
  id: string;
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
}) {
  return { tokenHash: 'hash', createdAt: new Date(), ...overrides };
}

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(() => {
    mockReset(prisma);
    mockReset(prismaTx);
    prisma.refreshToken.create.mockResolvedValue({} as never);
    prisma.refreshToken.update.mockResolvedValue({} as never);
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    prismaTx.refreshToken.create.mockResolvedValue({} as never);
    prismaTx.refreshToken.update.mockResolvedValue({} as never);
    prisma.$transaction.mockImplementation((fn: unknown) =>
      (fn as (tx: typeof prismaTx) => Promise<unknown>)(prismaTx),
    );
    service = new TokenService(new JwtService({}), config as never, prisma);
  });

  it('issueTokens stores the refresh token hash, not the raw token', async () => {
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

  it('rotate rejects a token that is not in the DB', async () => {
    const { refreshToken } = await service.issueTokens(user);
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.rotate(refreshToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rotate detects reuse: revoked token -> revoke all of the user sessions', async () => {
    const { refreshToken } = await service.issueTokens(user);
    prisma.refreshToken.findUnique.mockResolvedValue(
      refreshTokenRow({
        id: 'rt1',
        userId: 'u1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 10_000),
      }),
    );
    await expect(service.rotate(refreshToken)).rejects.toThrow(
      'Invalid session, please sign in again.',
    );

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });

  it('rotate succeeds using a transaction: revoke old + create new', async () => {
    const { refreshToken } = await service.issueTokens(user);
    prisma.refreshToken.findUnique.mockResolvedValue(
      refreshTokenRow({
        id: 'rt1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10_000),
      }),
    );
    prismaTx.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.rotate(refreshToken);
    expect(result.refreshToken).not.toEqual(refreshToken);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.$transaction).toHaveBeenCalled();

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prismaTx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'rt1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prismaTx.refreshToken.create).toHaveBeenCalled();
  });

  it('rotate rejects TOCTOU race: transaction updateMany count 0 -> revoke all of the user sessions', async () => {
    const { refreshToken } = await service.issueTokens(user);
    prisma.refreshToken.findUnique.mockResolvedValue(
      refreshTokenRow({
        id: 'rt1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10_000),
      }),
    );
    prismaTx.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.rotate(refreshToken)).rejects.toThrow(
      'Invalid session, please sign in again.',
    );

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prismaTx.refreshToken.create).not.toHaveBeenCalled();

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });

  it('rotate rejects a JWT with an invalid signature', async () => {
    await expect(service.rotate('not.a.valid.jwt')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
