jest.mock('../../../prisma/prisma.service');

import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

const config = {
  get: jest.fn(() => 'a'.repeat(32)),
} as never;

function build(findById: jest.Mock) {
  return new JwtStrategy(config, { findById } as never);
}

describe('JwtStrategy.validate', () => {
  it('rejects a token whose user no longer exists in the DB', async () => {
    // A signed, unexpired token must still fail once the account is gone,
    // otherwise a deleted user keeps access until the token expires.
    const findById = jest.fn().mockResolvedValue(null);
    await expect(
      build(findById).validate({ sub: 'deleted-user' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(findById).toHaveBeenCalledWith('deleted-user');
  });

  it('returns the authenticated user when the account still exists', async () => {
    const findById = jest.fn().mockResolvedValue({
      id: 'u1',
      email: 'user@example.test',
      name: 'Test User',
      avatarUrl: null,
      role: 'USER',
    });
    await expect(build(findById).validate({ sub: 'u1' })).resolves.toEqual({
      id: 'u1',
      email: 'user@example.test',
      name: 'Test User',
      avatarUrl: 'https://ui-avatars.com/api/?name=Test+User&size=256',
      role: 'USER',
    });
  });
});
