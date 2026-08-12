jest.mock('../../prisma/prisma.service');

import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../../generated/prisma/client';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  const usersService = {
    findById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  let controller: UsersController;

  const authUser: AuthenticatedUser = {
    id: 'u1',
    email: 'user@example.test',
    name: 'Test User',
    avatarUrl: 'https://ui-avatars.com/api/?name=Test+User&size=256',
    role: 'USER',
  };

  const dbUser: User = {
    id: 'u1',
    email: 'user@example.test',
    password: null,
    name: 'Test User',
    avatarUrl: null,
    googleId: null,
    googleUnlinkedAt: null,
    isEmailVerified: true,
    role: 'USER',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new UsersController(usersService as unknown as UsersService);
  });

  describe('me', () => {
    it('returns formatted user profile data', async () => {
      usersService.findById.mockResolvedValue(dbUser);
      const res = await controller.me(authUser);
      expect(usersService.findById).toHaveBeenCalledWith('u1');
      expect(res).toEqual({
        id: 'u1',
        email: 'user@example.test',
        name: 'Test User',
        avatarUrl: 'https://ui-avatars.com/api/?name=Test+User&size=256',
        isEmailVerified: true,
        role: 'USER',
        createdAt: dbUser.createdAt,
        updatedAt: dbUser.updatedAt,
      });
    });

    it('throws NotFoundException if user is missing', async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(controller.me(authUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMe', () => {
    it('updates user and returns updated profile data', async () => {
      const updated = { ...dbUser, name: 'New Name' };
      usersService.update.mockResolvedValue(updated);

      const res = await controller.updateMe(authUser, { name: 'New Name' });
      expect(usersService.update).toHaveBeenCalledWith('u1', {
        name: 'New Name',
      });
      expect(res.name).toBe('New Name');
      expect(res.avatarUrl).toBe(
        'https://ui-avatars.com/api/?name=New+Name&size=256',
      );
    });
  });

  describe('deleteMe', () => {
    it('deletes user account and returns null', async () => {
      usersService.delete.mockResolvedValue(undefined);
      await expect(controller.deleteMe(authUser)).resolves.toBeNull();
      expect(usersService.delete).toHaveBeenCalledWith('u1');
    });
  });
});
