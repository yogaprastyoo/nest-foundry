jest.mock('../../prisma/prisma.service');

import { NotFoundException } from '@nestjs/common';
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

  it('findByEmailWithPassword specifies omit: { password: false }', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      password: 'hash',
    } as never);
    await expect(
      service.findByEmailWithPassword('user@example.test'),
    ).resolves.toEqual({
      id: 'u1',
      password: 'hash',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'user@example.test' },
      omit: { password: false },
    });
  });

  it('findById forwards to prisma with a where id', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' } as never);
    await expect(service.findById('u1')).resolves.toEqual({ id: 'u1' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
    });
  });

  it('findByIdWithPassword specifies omit: { password: false }', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      password: 'hash',
    } as never);
    await expect(service.findByIdWithPassword('u1')).resolves.toEqual({
      id: 'u1',
      password: 'hash',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      omit: { password: false },
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

  it('update updates user fields', async () => {
    prisma.user.update.mockResolvedValue({
      id: 'u1',
      name: 'New Name',
    } as never);
    await expect(service.update('u1', { name: 'New Name' })).resolves.toEqual({
      id: 'u1',
      name: 'New Name',
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: 'New Name' },
    });
  });

  it('update throws NotFoundException on Prisma P2025 error', async () => {
    prisma.user.update.mockRejectedValue({ code: 'P2025' });
    await expect(service.update('missing', { name: 'New' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('delete removes user', async () => {
    prisma.user.delete.mockResolvedValue({ id: 'u1' } as never);
    await service.delete('u1');
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });

  it('delete throws NotFoundException on Prisma P2025 error', async () => {
    prisma.user.delete.mockRejectedValue({ code: 'P2025' });
    await expect(service.delete('missing')).rejects.toThrow(NotFoundException);
  });
});
