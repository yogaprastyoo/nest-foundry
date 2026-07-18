jest.mock('../../generated/prisma/client');
jest.mock('../../prisma/prisma.service');

import { UsersService } from './users.service';

describe('UsersService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };
  const service = new UsersService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('findByEmail forwards to prisma with a where email', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await expect(service.findByEmail('user@example.test')).resolves.toEqual({
      id: 'u1',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'user@example.test' },
    });
  });

  it('createLocal creates a user with the correct fields', async () => {
    prisma.user.create.mockResolvedValue({ id: 'u1' });
    await service.createLocal({
      email: 'user@example.test',
      passwordHash: 'hash',
      name: 'Test User',
      isEmailVerified: true,
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'user@example.test',
        password: 'hash',
        name: 'Test User',
        isEmailVerified: true,
      },
    });
  });
});
