jest.mock('../../prisma/prisma.service');

import { ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService.register', () => {
  const users = { createLocal: jest.fn(), findByEmail: jest.fn() };
  const hashing = {
    hash: jest.fn().mockResolvedValue('hashed'),
    verify: jest.fn(),
    verifyDummy: jest.fn(),
  };
  const tokens = {};
  const redis = {};
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

  it('toggle on: user belum verified', async () => {
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

  it('email duplikat (P2002 dari prisma) dilempar sebagai 409 dengan pesan spesifik', async () => {
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
