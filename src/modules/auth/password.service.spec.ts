import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenType } from '../../generated/prisma/enums';
import { PasswordService } from './password.service';
import { sha256 } from '../../common/crypto/token.util';

jest.mock('../../prisma/prisma.service');

function build() {
  const verificationToken = {
    create: jest.fn(),
    deleteMany: jest.fn(),
    findUnique: jest.fn(),
  };
  const user = {
    update: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
  };
  const refreshToken = { updateMany: jest.fn() };
  const prisma = {
    verificationToken,
    user,
    refreshToken,
    $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
      fn({ verificationToken, user, refreshToken }),
    ),
  };
  const users = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
  };
  const hashing = {
    hash: jest.fn().mockResolvedValue('hashed-password'),
    verify: jest.fn(),
    verifyDummy: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'FRONTEND_URL'
        ? 'https://app.test'
        : key === 'PASSWORD_RESET_TTL'
          ? 3600
          : undefined,
    ),
  };
  const redis = { set: jest.fn(), eval: jest.fn() };
  const mailQueue = { enqueuePasswordResetEmail: jest.fn() };
  const googleOAuth = {
    consumeReauthCode: jest.fn(),
  };
  const service = new PasswordService(
    prisma as never,
    users as never,
    hashing as never,
    config as never,
    redis as never,
    mailQueue as never,
    googleOAuth as never,
  );
  return {
    service,
    prisma,
    users,
    hashing,
    config,
    redis,
    mailQueue,
    googleOAuth,
  };
}

describe('PasswordService', () => {
  describe('requestReset', () => {
    it('is silent for an unknown email', async () => {
      const { service, users, mailQueue } = build();
      users.findByEmail.mockResolvedValue(null);

      await service.requestReset('missing@example.test');

      expect(mailQueue.enqueuePasswordResetEmail).not.toHaveBeenCalled();
    });

    it('is silent for a Google-only account', async () => {
      const { service, users, mailQueue } = build();
      users.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'user@example.test',
        password: null,
        name: 'Test User',
      });

      await service.requestReset('user@example.test');

      expect(mailQueue.enqueuePasswordResetEmail).not.toHaveBeenCalled();
    });

    it('issues a single-active reset token and enqueues a URL for a local user', async () => {
      const { service, users, prisma, mailQueue, config } = build();
      users.findByEmail.mockResolvedValue({
        id: 'u1',
        email: 'user@example.test',
        password: 'hashed',
        name: 'Test User',
      });

      await service.requestReset('user@example.test');

      expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', type: TokenType.PASSWORD_RESET },
      });
      expect(prisma.verificationToken.create).toHaveBeenCalled();
      const calls = mailQueue.enqueuePasswordResetEmail.mock.calls as Array<
        [{ to: string; url: string }]
      >;
      const job = calls[0][0];
      expect(job.to).toBe('user@example.test');
      expect(job.url).toMatch(
        /^https:\/\/app\.test\/reset-password\?token=[A-Za-z0-9_-]+$/,
      );
      expect(config.get).toHaveBeenCalledWith('PASSWORD_RESET_TTL', {
        infer: true,
      });
    });
  });

  describe('resetPassword', () => {
    it('rejects an unknown token', async () => {
      const { service, prisma } = build();
      prisma.verificationToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword({ token: 'nope', newPassword: 'Password123!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an expired token', async () => {
      const { service, prisma } = build();
      prisma.verificationToken.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        tokenHash: sha256('expired'),
        type: TokenType.PASSWORD_RESET,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.resetPassword({
          token: 'expired',
          newPassword: 'Password123!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a consumed token (deleteMany count 0)', async () => {
      const { service, prisma } = build();
      prisma.verificationToken.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        tokenHash: sha256('used'),
        type: TokenType.PASSWORD_RESET,
        expiresAt: new Date(Date.now() + 1000),
      });
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.resetPassword({ token: 'used', newPassword: 'Password123!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates the password, revokes sessions, and cleans up tokens', async () => {
      const { service, prisma, hashing } = build();
      prisma.verificationToken.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        tokenHash: sha256('good'),
        type: TokenType.PASSWORD_RESET,
        expiresAt: new Date(Date.now() + 1000),
      });
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 1 });
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        id: 'u1',
        password: 'hashed',
      });

      await service.resetPassword({
        token: 'good',
        newPassword: 'NewPassword123!',
      });

      expect(hashing.hash).toHaveBeenCalledWith('NewPassword123!');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { password: 'hashed-password' },
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const expectData = { revokedAt: expect.any(Date) };
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: expectData,
      });
      expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', type: TokenType.PASSWORD_RESET },
      });
    });
  });

  describe('changePassword', () => {
    it('rejects when the user is missing', async () => {
      const { service, users } = build();
      users.findById.mockResolvedValue(null);

      await expect(
        service.changePassword({
          userId: 'u1',
          currentPassword: 'Password123!',
          newPassword: 'NewPassword123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('runs dummy verification for a Google-only account and returns 403', async () => {
      const { service, users, hashing } = build();
      users.findById.mockResolvedValue({
        id: 'u1',
        password: null,
      });

      await expect(
        service.changePassword({
          userId: 'u1',
          currentPassword: 'Password123!',
          newPassword: 'NewPassword123!',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(hashing.verifyDummy).toHaveBeenCalledWith('Password123!');
    });

    it('rejects an incorrect current password', async () => {
      const { service, users, hashing } = build();
      users.findById.mockResolvedValue({ id: 'u1', password: 'hashed' });
      hashing.verify.mockResolvedValue(false);

      await expect(
        service.changePassword({
          userId: 'u1',
          currentPassword: 'Wrong123!',
          newPassword: 'NewPassword123!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates the password and revokes sessions', async () => {
      const { service, users, hashing, prisma } = build();
      users.findById.mockResolvedValue({ id: 'u1', password: 'hashed' });
      hashing.verify.mockResolvedValue(true);
      prisma.user.updateMany.mockResolvedValue({ count: 1 });

      await service.changePassword({
        userId: 'u1',
        currentPassword: 'Password123!',
        newPassword: 'NewPassword123!',
      });

      expect(hashing.hash).toHaveBeenCalledWith('NewPassword123!');
      expect(prisma.user.updateMany).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const expectData = { revokedAt: expect.any(Date) };
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: expectData,
      });
    });
  });

  describe('setPassword', () => {
    it('rejects when the reauth proof is missing', async () => {
      const { service, googleOAuth } = build();
      googleOAuth.consumeReauthCode.mockResolvedValue(false);

      await expect(
        service.setPassword({
          userId: 'u1',
          newPassword: 'NewPassword123!',
          googleReauthCode: 'bad-code',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('sets a password for a Google-only account and revokes sessions', async () => {
      const { service, googleOAuth, prisma, hashing } = build();
      googleOAuth.consumeReauthCode.mockResolvedValue(true);
      prisma.user.updateMany.mockResolvedValue({ count: 1 });

      await service.setPassword({
        userId: 'u1',
        newPassword: 'NewPassword123!',
        googleReauthCode: 'good-code',
      });

      expect(googleOAuth.consumeReauthCode).toHaveBeenCalledWith('good-code', {
        userId: 'u1',
        purpose: 'set_password',
      });
      expect(hashing.hash).toHaveBeenCalledWith('NewPassword123!');
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', password: null, googleId: { not: null } },
        data: { password: 'hashed-password' },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    });

    it('rejects with 409 when a password already exists', async () => {
      const { service, googleOAuth, prisma, users } = build();
      googleOAuth.consumeReauthCode.mockResolvedValue(true);
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      users.findById.mockResolvedValue({ id: 'u1', password: 'hashed' });

      await expect(
        service.setPassword({
          userId: 'u1',
          newPassword: 'NewPassword123!',
          googleReauthCode: 'good-code',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('unlinkGoogle', () => {
    it('rejects when Google is not linked', async () => {
      const { service, users } = build();
      users.findById.mockResolvedValue({ id: 'u1', googleId: null });

      await expect(
        service.unlinkGoogle({
          userId: 'u1',
          password: 'Password123!',
          googleReauthCode: 'code',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('runs dummy verification when no local password exists', async () => {
      const { service, users, hashing } = build();
      users.findById.mockResolvedValue({
        id: 'u1',
        googleId: 'g1',
        password: null,
      });

      await expect(
        service.unlinkGoogle({
          userId: 'u1',
          password: 'Password123!',
          googleReauthCode: 'code',
        }),
      ).rejects.toThrow(ConflictException);
      expect(hashing.verifyDummy).toHaveBeenCalledWith('Password123!');
    });

    it('rejects an incorrect local password', async () => {
      const { service, users, hashing } = build();
      users.findById.mockResolvedValue({
        id: 'u1',
        googleId: 'g1',
        password: 'hashed',
      });
      hashing.verify.mockResolvedValue(false);

      await expect(
        service.unlinkGoogle({
          userId: 'u1',
          password: 'Wrong123!',
          googleReauthCode: 'code',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid reauth proof', async () => {
      const { service, users, hashing, googleOAuth } = build();
      users.findById.mockResolvedValue({
        id: 'u1',
        googleId: 'g1',
        password: 'hashed',
      });
      hashing.verify.mockResolvedValue(true);
      googleOAuth.consumeReauthCode.mockResolvedValue(false);

      await expect(
        service.unlinkGoogle({
          userId: 'u1',
          password: 'Password123!',
          googleReauthCode: 'bad-code',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('unlinks Google and sets the marker, revoking sessions', async () => {
      const { service, users, hashing, googleOAuth, prisma } = build();
      users.findById.mockResolvedValue({
        id: 'u1',
        googleId: 'g1',
        password: 'hashed',
      });
      hashing.verify.mockResolvedValue(true);
      googleOAuth.consumeReauthCode.mockResolvedValue(true);
      prisma.user.updateMany.mockResolvedValue({ count: 1 });

      await service.unlinkGoogle({
        userId: 'u1',
        password: 'Password123!',
        googleReauthCode: 'good-code',
      });

      const expectUnlinkData = {
        googleId: null,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        googleUnlinkedAt: expect.any(Date),
      };
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', googleId: 'g1', password: 'hashed' },
        data: expectUnlinkData,
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    });
  });
});
