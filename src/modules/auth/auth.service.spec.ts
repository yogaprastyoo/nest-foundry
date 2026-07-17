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
const redis = {
  get: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
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
);

beforeEach(() => jest.clearAllMocks());

describe('AuthService.register', () => {
  it('toggle off: user langsung verified', async () => {
    env.AUTH_REQUIRE_EMAIL_VERIFICATION = false;
    users.createLocal.mockResolvedValue({ id: 'u1' });
    await service.register({
      email: 'a@b.c',
      password: 'password123',
      name: 'Budi',
    });
    expect(hashing.hash).toHaveBeenCalledWith('password123');
    expect(users.createLocal).toHaveBeenCalledWith(
      expect.objectContaining({ isEmailVerified: true }),
    );
  });

  it('toggle on: user not yet verified', async () => {
    env.AUTH_REQUIRE_EMAIL_VERIFICATION = true;
    users.createLocal.mockResolvedValue({ id: 'u1' });
    await service.register({
      email: 'a@b.c',
      password: 'password123',
      name: 'Budi',
    });
    expect(users.createLocal).toHaveBeenCalledWith(
      expect.objectContaining({ isEmailVerified: false }),
    );
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
        email: 'a@b.c',
        password: 'password123',
        name: 'Budi',
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('AuthService.validateUser', () => {
  const fakeUser = {
    id: 'u1',
    name: 'Budi',
    email: 'a@b.c',
    password: 'hashed-pw',
    role: 'USER',
    isEmailVerified: true,
  };

  it('unknown email: verifyDummy is called then 401 generic', async () => {
    redis.get.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue(null);
    hashing.verifyDummy.mockResolvedValue(undefined);
    await expect(service.validateUser('x@y.z', 'password123')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(hashing.verifyDummy).toHaveBeenCalledWith('password123');
  });

  it('locked account (redis.get returns "10"): 429 without verifying password', async () => {
    redis.get.mockResolvedValue('10');
    await expect(service.validateUser('a@b.c', 'password123')).rejects.toThrow(
      HttpException,
    );
    expect(users.findByEmail).not.toHaveBeenCalled();
  });

  it('google-only account (password null): 422 with a clear message', async () => {
    redis.get.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue({ ...fakeUser, password: null });
    await expect(service.validateUser('a@b.c', 'password123')).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('wrong password: counter increments + 401 generic', async () => {
    redis.get.mockResolvedValue('0');
    users.findByEmail.mockResolvedValue(fakeUser);
    hashing.verify.mockResolvedValue(false);
    await expect(service.validateUser('a@b.c', 'wrong')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(redis.incr).toHaveBeenCalled();
    expect(redis.expire).toHaveBeenCalled();
  });

  it('toggle on + not verified: 403 after correct password', async () => {
    env.AUTH_REQUIRE_EMAIL_VERIFICATION = true;
    redis.get.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue({
      ...fakeUser,
      isEmailVerified: false,
    });
    hashing.verify.mockResolvedValue(true);
    await expect(service.validateUser('a@b.c', 'password123')).rejects.toThrow(
      ForbiddenException,
    );
    env.AUTH_REQUIRE_EMAIL_VERIFICATION = false;
  });

  it('success: counter cleared, user returned', async () => {
    redis.get.mockResolvedValue('3');
    users.findByEmail.mockResolvedValue(fakeUser);
    hashing.verify.mockResolvedValue(true);
    const result = await service.validateUser('a@b.c', 'password123');
    expect(redis.del).toHaveBeenCalled();
    expect(result).toEqual(fakeUser);
  });
});
