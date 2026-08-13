jest.mock('../../prisma/prisma.service');

import {
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { mockDeep } from 'jest-mock-extended';
import type { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';

const users = {
  createLocal: jest.fn(),
  findByEmail: jest.fn(),
  findByEmailWithPassword: jest.fn(),
};
const hashing = {
  hash: jest.fn().mockResolvedValue('hashed'),
  verify: jest.fn(),
  verifyDummy: jest.fn(),
};
const tokens = { issueTokens: jest.fn() };
const verification = {
  sendVerificationEmail: jest.fn(),
  createPasswordResetToken: jest.fn(),
};
const redis = {
  get: jest.fn(),
  eval: jest.fn(),
  del: jest.fn(),
};
const env: Record<string, unknown> = {
  AUTH_REQUIRE_EMAIL_VERIFICATION: false,
};
const config = { get: jest.fn((k: string) => env[k]) };

const mailQueue = { enqueuePasswordResetEmail: jest.fn() };
const prismaMock = mockDeep<PrismaService>();
prismaMock.$transaction.mockImplementation(
  (fn: (tx: PrismaService) => unknown) => Promise.resolve(fn(prismaMock)),
);

const service = new AuthService(
  users as never,
  hashing as never,
  tokens as never,
  config as never,
  redis as never,
  verification as never,
  mailQueue as never,
  prismaMock,
);

beforeEach(() => jest.clearAllMocks());

describe('AuthService.register', () => {
  it('toggle off: user is verified immediately and no email is enqueued', async () => {
    env.AUTH_REQUIRE_EMAIL_VERIFICATION = false;
    users.createLocal.mockResolvedValue({ id: 'u1' });
    await service.register({
      email: 'user@example.test',
      password: 'password123',
      name: 'Test User',
    });
    expect(hashing.hash).toHaveBeenCalledWith('password123');
    expect(users.createLocal).toHaveBeenCalledWith(
      expect.objectContaining({ isEmailVerified: true }),
    );
    expect(verification.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('toggle on: user not yet verified and a verification email is enqueued', async () => {
    env.AUTH_REQUIRE_EMAIL_VERIFICATION = true;
    users.createLocal.mockResolvedValue({
      id: 'u1',
      email: 'user@example.test',
      name: 'Test User',
    });
    await service.register({
      email: 'user@example.test',
      password: 'password123',
      name: 'Test User',
    });
    expect(users.createLocal).toHaveBeenCalledWith(
      expect.objectContaining({ isEmailVerified: false }),
    );
    expect(verification.sendVerificationEmail).toHaveBeenCalledWith({
      id: 'u1',
      email: 'user@example.test',
      name: 'Test User',
    });
    env.AUTH_REQUIRE_EMAIL_VERIFICATION = false;
  });

  it('duplicate email (Prisma P2002) is thrown as 409 with a specific message', async () => {
    env.AUTH_REQUIRE_EMAIL_VERIFICATION = false;
    users.createLocal.mockRejectedValue(
      Object.assign(new Error('unique'), {
        code: 'P2002',
        name: 'PrismaClientKnownRequestError',
      }),
    );
    await expect(
      service.register({
        email: 'user@example.test',
        password: 'password123',
        name: 'Test User',
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('AuthService.validateUser', () => {
  const fakeUser = {
    id: 'u1',
    name: 'Test User',
    email: 'user@example.test',
    password: 'hashed-pw',
    role: 'USER',
    isEmailVerified: true,
  };

  it('unknown email: equalizes timing, counts failure, then returns generic 401', async () => {
    redis.get.mockResolvedValue(null);
    users.findByEmailWithPassword.mockResolvedValue(null);
    hashing.verifyDummy.mockResolvedValue(undefined);
    await expect(
      service.validateUser('missing@example.test', 'password123'),
    ).rejects.toThrow(UnauthorizedException);
    expect(hashing.verifyDummy).toHaveBeenCalledWith('password123');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      1,
      'auth:lockout:missing@example.test',
      '900',
    );
  });

  it('locked account (redis.get returns "10"): 429 without verifying password', async () => {
    redis.get.mockResolvedValue('10');
    await expect(
      service.validateUser('user@example.test', 'password123'),
    ).rejects.toThrow(HttpException);
    expect(users.findByEmailWithPassword).not.toHaveBeenCalled();
  });

  it('google-only account equalizes timing, counts failure, then returns generic 401', async () => {
    redis.get.mockResolvedValue(null);
    users.findByEmailWithPassword.mockResolvedValue({
      ...fakeUser,
      password: null,
    });
    hashing.verifyDummy.mockResolvedValue(undefined);

    await expect(
      service.validateUser('user@example.test', 'password123'),
    ).rejects.toThrow(UnauthorizedException);

    expect(hashing.verifyDummy).toHaveBeenCalledWith('password123');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      1,
      'auth:lockout:user@example.test',
      '900',
    );
  });

  it('wrong password atomically increments the lockout counter + returns 401', async () => {
    redis.get.mockResolvedValue('0');
    users.findByEmailWithPassword.mockResolvedValue(fakeUser);
    hashing.verify.mockResolvedValue(false);
    await expect(
      service.validateUser('user@example.test', 'wrong'),
    ).rejects.toThrow(UnauthorizedException);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      1,
      'auth:lockout:user@example.test',
      '900',
    );
  });

  it('toggle on + not verified: 403 after correct password', async () => {
    env.AUTH_REQUIRE_EMAIL_VERIFICATION = true;
    redis.get.mockResolvedValue(null);
    users.findByEmailWithPassword.mockResolvedValue({
      ...fakeUser,
      isEmailVerified: false,
    });
    hashing.verify.mockResolvedValue(true);
    await expect(
      service.validateUser('user@example.test', 'password123'),
    ).rejects.toThrow(ForbiddenException);
    env.AUTH_REQUIRE_EMAIL_VERIFICATION = false;
  });

  it('success: counter cleared, user returned', async () => {
    redis.get.mockResolvedValue('3');
    users.findByEmailWithPassword.mockResolvedValue(fakeUser);
    hashing.verify.mockResolvedValue(true);
    const result = await service.validateUser(
      'user@example.test',
      'password123',
    );
    expect(redis.del).toHaveBeenCalled();
    expect(result).toEqual(fakeUser);
  });
});

describe('AuthService.forgotPassword', () => {
  it('does nothing when email is not found (timing/enumeration safe)', async () => {
    users.findByEmail.mockResolvedValue(null);
    await service.forgotPassword({ email: 'unknown@example.test' });
    expect(verification.createPasswordResetToken).not.toHaveBeenCalled();
    expect(mailQueue.enqueuePasswordResetEmail).not.toHaveBeenCalled();
  });

  it('creates token and enqueues password reset email when user exists', async () => {
    users.findByEmail.mockResolvedValue({
      id: 'u1',
      email: 'user@example.test',
      name: 'Test User',
    });
    verification.createPasswordResetToken.mockResolvedValue('reset-token-123');

    await service.forgotPassword({ email: 'user@example.test' });

    expect(verification.createPasswordResetToken).toHaveBeenCalledWith('u1');
    expect(mailQueue.enqueuePasswordResetEmail).toHaveBeenCalledWith({
      to: 'user@example.test',
      name: 'Test User',
      url: expect.stringContaining('reset-token-123') as unknown,
      token: 'reset-token-123',
    });
  });
});

describe('AuthService.resetPassword', () => {
  it('throws UnauthorizedException if token not found or invalid', async () => {
    prismaMock.verificationToken.findUnique.mockResolvedValue(null);

    await expect(
      service.resetPassword({
        token: 'invalid-token',
        newPassword: 'newPassword123!',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException if token type is wrong', async () => {
    prismaMock.verificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      type: 'EMAIL_VERIFICATION',
      expiresAt: new Date(Date.now() + 10_000),
    } as never);

    await expect(
      service.resetPassword({
        token: 'invalid-token',
        newPassword: 'newPassword123!',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException if token is expired', async () => {
    prismaMock.verificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      type: 'PASSWORD_RESET',
      expiresAt: new Date(Date.now() - 1000),
    } as never);

    await expect(
      service.resetPassword({
        token: 'expired-token',
        newPassword: 'newPassword123!',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('resets password, deletes token, and revokes all refresh tokens on success', async () => {
    prismaMock.verificationToken.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      type: 'PASSWORD_RESET',
      expiresAt: new Date(Date.now() + 10_000),
    } as never);
    prismaMock.verificationToken.deleteMany.mockResolvedValue({ count: 1 });
    hashing.hash.mockResolvedValue('new-hashed-password');

    await service.resetPassword({
      token: 'valid-token',
      newPassword: 'newPassword123!',
    });

    expect(prismaMock.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { id: 't1' },
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { password: 'new-hashed-password' },
    });
    expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
    });
  });
});
