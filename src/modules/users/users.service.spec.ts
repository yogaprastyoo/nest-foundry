jest.mock('../../prisma/prisma.service');

import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let service: UsersService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    service = new UsersService(prisma);
  });

  it('findByEmail forwards to prisma with a where email', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' } as never);
    await expect(service.findByEmail('user@example.test')).resolves.toEqual({
      id: 'u1',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'user@example.test' },
    });
  });

  it('createLocal creates a user with the correct fields', async () => {
    prisma.user.create.mockResolvedValue({ id: 'u1' } as never);
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
