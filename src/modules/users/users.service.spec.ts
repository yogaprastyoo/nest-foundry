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

  it('findByEmail meneruskan ke prisma dengan where email', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await expect(service.findByEmail('a@b.c')).resolves.toEqual({ id: 'u1' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'a@b.c' },
    });
  });

  it('createLocal membuat user dengan field yang benar', async () => {
    prisma.user.create.mockResolvedValue({ id: 'u1' });
    await service.createLocal({
      email: 'a@b.c',
      passwordHash: 'hash',
      name: 'Budi',
      isEmailVerified: true,
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'a@b.c',
        password: 'hash',
        name: 'Budi',
        isEmailVerified: true,
      },
    });
  });
});
