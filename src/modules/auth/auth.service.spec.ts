jest.mock('../../prisma/prisma.service');

import {
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

const users = { createLocal: jest.fn(), findByEmail: jest.fn() };
const hashing = {
  hash: jest.fn().mockResolvedValue('hashed'),
  verify: jest.fn(),
  verifyDummy: jest.fn(),
};
const tokens = { issueTokens: jest.fn() };
const verification = { sendVerificationEmail: jest.fn() };
const redis = {
  get: jest.fn(),
  eval: jest.fn(),
  del: jest.fn(),
};
const env: Record<string, unknown> = {
  AUTH_REQUIRE_EMAIL_VERIFICATION: false,
};
const config = { get: jest.fn((k: string) => env[k]) };

const service = new AuthService(
  users as never,
  hashing as never,
  tokens as never,
  config as never,
  redis as never,
  verification as never,
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
    users.findByEmail.mockResolvedValue(null);
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
    expect(users.findByEmail).not.toHaveBeenCalled();
  });

  it('google-only account counts the failure before returning 422', async () => {
    redis.get.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue({ ...fakeUser, password: null });
    await expect(
      service.validateUser('user@example.test', 'password123'),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      1,
      'auth:lockout:user@example.test',
      '900',
    );
  });

  it('wrong password atomically increments the lockout counter + returns 401', async () => {
    redis.get.mockResolvedValue('0');
    users.findByEmail.mockResolvedValue(fakeUser);
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
    users.findByEmail.mockResolvedValue({
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
    users.findByEmail.mockResolvedValue(fakeUser);
    hashing.verify.mockResolvedValue(true);
    const result = await service.validateUser(
      'user@example.test',
      'password123',
    );
    expect(redis.del).toHaveBeenCalled();
    expect(result).toEqual(fakeUser);
  });
});
