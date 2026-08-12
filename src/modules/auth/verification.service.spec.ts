import { BadRequestException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { TokenType } from '../../generated/prisma/enums';
import type { PrismaService } from '../../prisma/prisma.service';
import { VerificationService } from './verification.service';
import { sha256 } from '../../common/crypto/token.util';

jest.mock('../../prisma/prisma.service');

function build() {
  const prisma: DeepMockProxy<PrismaService> = mockDeep<PrismaService>();
  prisma.$transaction.mockImplementation((fn: (tx: PrismaService) => unknown) =>
    Promise.resolve(fn(prisma)),
  );
  const users = { findByEmail: jest.fn() };
  const mailQueue = { enqueueVerificationEmail: jest.fn() };
  const redis = {
    set: jest.fn(),
    eval: jest.fn().mockResolvedValue(1),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'FRONTEND_URL'
        ? 'https://app.test'
        : key === 'EMAIL_VERIFICATION_TTL'
          ? 86400
          : undefined,
    ),
  };
  const service = new VerificationService(
    prisma,
    users as never,
    mailQueue as never,
    redis as never,
    config as never,
  );
  return { service, prisma, users, mailQueue, redis, config };
}

describe('VerificationService', () => {
  it('sendVerificationEmail issues a single-active token and enqueues a URL', async () => {
    const { service, prisma, mailQueue } = build();
    await service.sendVerificationEmail({
      id: 'u1',
      email: 'user@example.test',
      name: 'Test User',
    });
    expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', type: TokenType.EMAIL_VERIFICATION },
    });
    expect(prisma.verificationToken.create).toHaveBeenCalled();
    const calls = mailQueue.enqueueVerificationEmail.mock.calls as Array<
      [{ to: string; url: string }]
    >;
    const job = calls[0][0];
    expect(job.to).toBe('user@example.test');
    expect(job.url).toMatch(
      /^https:\/\/app\.test\/verify-email\?token=[A-Za-z0-9_-]+$/,
    );
  });

  it('verifyEmail consumes the token atomically and marks the user verified', async () => {
    const { service, prisma } = build();
    const raw = 'sometoken';
    prisma.verificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      type: TokenType.EMAIL_VERIFICATION,
      expiresAt: new Date(Date.now() + 10_000),
    } as never);
    prisma.verificationToken.deleteMany.mockResolvedValue({ count: 1 });

    await service.verifyEmail(raw);

    expect(prisma.verificationToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: sha256(raw) },
    });
    expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { id: 't1' },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isEmailVerified: true },
    });
  });

  it('verifyEmail rejects an unknown token uniformly', async () => {
    const { service, prisma } = build();
    prisma.verificationToken.findUnique.mockResolvedValue(null);
    await expect(service.verifyEmail('x')).rejects.toThrow(BadRequestException);
  });

  it('verifyEmail rejects an expired token', async () => {
    const { service, prisma } = build();
    prisma.verificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      type: TokenType.EMAIL_VERIFICATION,
      expiresAt: new Date(Date.now() - 1),
    } as never);
    await expect(service.verifyEmail('x')).rejects.toThrow(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('verifyEmail rejects a token of the wrong type (cross-type reuse)', async () => {
    const { service, prisma } = build();
    prisma.verificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      type: TokenType.PASSWORD_RESET,
      expiresAt: new Date(Date.now() + 10_000),
    } as never);
    await expect(service.verifyEmail('x')).rejects.toThrow(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('verifyEmail treats a lost single-use race (count 0) as invalid', async () => {
    const { service, prisma } = build();
    prisma.verificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      type: TokenType.EMAIL_VERIFICATION,
      expiresAt: new Date(Date.now() + 10_000),
    } as never);
    prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.verifyEmail('x')).rejects.toThrow(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('resendVerification is silent within cooldown (SET NX fails)', async () => {
    const { service, redis, users } = build();
    redis.set.mockResolvedValue(null);
    await service.resendVerification('USER@Example.test');
    expect(redis.set).toHaveBeenCalledWith(
      'verify:cooldown:user@example.test',
      '1',
      'EX',
      60,
      'NX',
    );
    expect(users.findByEmail).not.toHaveBeenCalled();
  });

  it('resendVerification sends when eligible and user is unverified', async () => {
    const { service, redis, users, mailQueue } = build();
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);
    users.findByEmail.mockResolvedValue({
      id: 'u1',
      email: 'user@example.test',
      name: 'Test User',
      isEmailVerified: false,
    });
    await service.resendVerification('user@example.test');
    expect(mailQueue.enqueueVerificationEmail).toHaveBeenCalled();
  });

  it('resendVerification does nothing (but does not throw) for unknown/verified email', async () => {
    const { service, redis, users, mailQueue } = build();
    redis.set.mockResolvedValue('OK');
    users.findByEmail.mockResolvedValue(null);
    await expect(
      service.resendVerification('user@example.test'),
    ).resolves.toBeUndefined();
    expect(mailQueue.enqueueVerificationEmail).not.toHaveBeenCalled();
  });

  it('an unknown email never charges the hourly quota', async () => {
    const { service, redis, users } = build();
    redis.set.mockResolvedValue('OK');
    users.findByEmail.mockResolvedValue(null);
    await service.resendVerification('user@example.test');
    // eval (Lua quota script) must not be called for unknown/verified emails
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('still sends on the last allowed send of the window', async () => {
    const { service, redis, users, mailQueue } = build();
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(5);
    users.findByEmail.mockResolvedValue({
      id: 'u1',
      email: 'user@example.test',
      name: 'Test User',
      isEmailVerified: false,
    });
    await service.resendVerification('user@example.test');
    expect(mailQueue.enqueueVerificationEmail).toHaveBeenCalled();
  });

  it('is silent once the hourly quota is exceeded', async () => {
    const { service, redis, users, mailQueue } = build();
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(6);
    users.findByEmail.mockResolvedValue({
      id: 'u1',
      email: 'user@example.test',
      name: 'Test User',
      isEmailVerified: false,
    });
    await expect(
      service.resendVerification('user@example.test'),
    ).resolves.toBeUndefined();
    expect(mailQueue.enqueueVerificationEmail).not.toHaveBeenCalled();
  });

  it('uses one atomic Redis operation for quota consumption', async () => {
    const { service, redis, users } = build();
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(3);
    users.findByEmail.mockResolvedValue({
      id: 'u1',
      email: 'user@example.test',
      name: 'Test User',
      isEmailVerified: false,
    });
    await service.resendVerification('user@example.test');
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      1,
      'verify:quota:user@example.test',
      '3600',
    );
  });
});
