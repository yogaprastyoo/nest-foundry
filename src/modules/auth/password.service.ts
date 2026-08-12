import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { HashingService } from '../../common/hashing/hashing.service';
import { generateToken, sha256 } from '../../common/crypto/token.util';
import { normalizeEmail } from '../../common/transforms/normalize-email.util';
import { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { TokenType } from '../../generated/prisma/enums';
import { MailQueue } from '../../mail/mail.queue';
import { UsersService } from '../users/users.service';
import { GoogleOAuthService } from './google-oauth.service';
import {
  PASSWORD_RESET_COOLDOWN_SECONDS,
  passwordResetCooldownKey,
} from './password.constants';

class TokenConsumedError extends Error {}

@Injectable()
export class PasswordService {
  private readonly auditLog = new Logger('AuthAudit');

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly hashing: HashingService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly mailQueue: MailQueue,
    private readonly googleOAuth: GoogleOAuthService,
  ) {}

  async requestReset(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    // Cooldown is charged for ANY request so a skip never reveals whether the
    // email is registered — the same anti-enumeration pattern used by
    // VerificationService.resendVerification.
    const acquired = await this.redis.set(
      passwordResetCooldownKey(email),
      '1',
      'EX',
      PASSWORD_RESET_COOLDOWN_SECONDS,
      'NX',
    );
    if (!acquired) return;

    const user = await this.users.findByEmail(email);
    this.auditLog.log({ event: 'password_reset_requested' });
    if (!user || user.password === null) {
      // Equalize work: non-local accounts must cost roughly the same as the
      // successful path so a timing histogram cannot enumerate them.
      await this.hashing.verifyDummy(email);
      return;
    }

    const rawToken = await this.issueResetToken(user.id);
    const base = this.config.get('FRONTEND_URL', { infer: true });
    const url = `${base}/reset-password?token=${rawToken}`;
    try {
      await this.mailQueue.enqueuePasswordResetEmail({
        to: user.email,
        name: user.name,
        url,
      });
    } catch {
      this.auditLog.warn({
        event: 'password_reset_enqueue_failed',
        userId: user.id,
      });
    }
  }

  async resetPassword(input: {
    token: string;
    newPassword: string;
  }): Promise<void> {
    const row = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: sha256(input.token) },
    });
    if (
      !row ||
      row.type !== TokenType.PASSWORD_RESET ||
      row.expiresAt < new Date()
    ) {
      this.auditLog.warn({
        event: 'password_reset_failed',
        reason: 'invalid_token',
      });
      throw this.invalidToken();
    }

    // Hash before the transaction so Argon2 work happens outside it.
    const passwordHash = await this.hashing.hash(input.newPassword);

    try {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.verificationToken.deleteMany({
          where: { id: row.id, type: TokenType.PASSWORD_RESET },
        });
        if (count === 0) throw new TokenConsumedError();
        const user = await tx.user.findUnique({ where: { id: row.userId } });
        if (!user || user.password === null) throw new TokenConsumedError();
        await tx.user.update({
          where: { id: row.userId },
          data: { password: passwordHash },
        });
        await tx.refreshToken.updateMany({
          where: { userId: row.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.verificationToken.deleteMany({
          where: { userId: row.userId, type: TokenType.PASSWORD_RESET },
        });
      });
    } catch (error) {
      if (error instanceof TokenConsumedError) throw this.invalidToken();
      throw error;
    }

    this.auditLog.log({
      event: 'password_reset_completed',
      userId: row.userId,
      sessionsRevoked: true,
    });
  }

  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new UnauthorizedException('Please sign in first.');

    if (user.password === null) {
      await this.hashing.verifyDummy(input.currentPassword);
      this.auditLog.warn({
        event: 'password_change_failed',
        userId: input.userId,
        reason: 'google_only',
      });
      throw new ForbiddenException(
        'Password change is unavailable for this account. Use Google reauthentication to set a password.',
      );
    }

    const valid = await this.hashing.verify(
      user.password,
      input.currentPassword,
    );
    if (!valid) {
      this.auditLog.warn({
        event: 'password_change_failed',
        userId: input.userId,
        reason: 'incorrect_current_password',
      });
      throw new BadRequestException('Current password is incorrect.');
    }
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestException(
        'New password must be different from current password.',
      );
    }

    const passwordHash = await this.hashing.hash(input.newPassword);
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: input.userId, password: user.password },
        data: { password: passwordHash },
      });
      if (updated.count === 0) return 0;
      await tx.refreshToken.updateMany({
        where: { userId: input.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.verificationToken.deleteMany({
        where: { userId: input.userId, type: TokenType.PASSWORD_RESET },
      });
      return 1;
    });

    if (result === 0) {
      this.auditLog.warn({
        event: 'password_change_failed',
        userId: input.userId,
        reason: 'incorrect_current_password',
      });
      throw new BadRequestException('Current password is incorrect.');
    }

    this.auditLog.log({
      event: 'password_changed',
      userId: input.userId,
      sessionsRevoked: true,
    });
  }

  async setPassword(input: {
    userId: string;
    newPassword: string;
    googleReauthCode: string;
  }): Promise<void> {
    const proofOk = await this.googleOAuth.consumeReauthCode(
      input.googleReauthCode,
      { userId: input.userId, purpose: 'set_password' },
    );
    if (!proofOk) {
      this.auditLog.warn({
        event: 'password_set_failed',
        userId: input.userId,
        reason: 'google_reauth_invalid',
      });
      throw new ForbiddenException('Google reauthentication is required.');
    }

    const passwordHash = await this.hashing.hash(input.newPassword);
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: {
          id: input.userId,
          password: null,
          googleId: { not: null },
        },
        data: { password: passwordHash },
      });
      if (updated.count === 0) return 0;
      await tx.refreshToken.updateMany({
        where: { userId: input.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.verificationToken.deleteMany({
        where: { userId: input.userId, type: TokenType.PASSWORD_RESET },
      });
      return 1;
    });

    if (result === 0) {
      const user = await this.users.findById(input.userId);
      if (user?.password !== null) {
        throw new ConflictException(
          'Password is already configured. Use change-password.',
        );
      }
      throw new ForbiddenException('Google reauthentication is required.');
    }

    this.auditLog.log({
      event: 'password_set_via_google_reauth',
      userId: input.userId,
      sessionsRevoked: true,
    });
  }

  async unlinkGoogle(input: {
    userId: string;
    password: string;
    googleReauthCode: string;
  }): Promise<void> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new UnauthorizedException('Please sign in first.');
    if (!user.googleId) {
      throw new ConflictException('Google account is not linked.');
    }
    if (user.password === null) {
      await this.hashing.verifyDummy(input.password);
      this.auditLog.warn({
        event: 'google_unlink_failed',
        userId: input.userId,
        reason: 'no_local_password',
      });
      throw new ConflictException(
        'Set a local password before unlinking Google.',
      );
    }

    const valid = await this.hashing.verify(user.password, input.password);
    if (!valid) {
      this.auditLog.warn({
        event: 'google_unlink_failed',
        userId: input.userId,
        reason: 'incorrect_password',
      });
      throw new BadRequestException('Current password is incorrect.');
    }

    const proofOk = await this.googleOAuth.consumeReauthCode(
      input.googleReauthCode,
      { userId: input.userId, purpose: 'unlink_google' },
    );
    if (!proofOk) {
      this.auditLog.warn({
        event: 'google_unlink_failed',
        userId: input.userId,
        reason: 'google_reauth_invalid',
      });
      throw new ForbiddenException('Google reauthentication is required.');
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: {
          id: input.userId,
          googleId: user.googleId,
          password: user.password,
        },
        data: { googleId: null, googleUnlinkedAt: now },
      });
      if (updated.count === 0) return 0;
      await tx.refreshToken.updateMany({
        where: { userId: input.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.verificationToken.deleteMany({
        where: { userId: input.userId, type: TokenType.PASSWORD_RESET },
      });
      return 1;
    });

    if (result === 0) {
      this.auditLog.warn({
        event: 'google_unlink_failed',
        userId: input.userId,
        reason: 'not_linked',
      });
      throw new ConflictException('Google account is not linked.');
    }

    this.auditLog.log({
      event: 'google_unlinked',
      userId: input.userId,
      sessionsRevoked: true,
    });
  }

  private async issueResetToken(userId: string): Promise<string> {
    const rawToken = generateToken();
    const ttlSeconds = this.config.get('PASSWORD_RESET_TTL', { infer: true });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await this.prisma.$transaction(async (tx) => {
      await tx.verificationToken.deleteMany({
        where: { userId, type: TokenType.PASSWORD_RESET },
      });
      await tx.verificationToken.create({
        data: {
          userId,
          tokenHash: sha256(rawToken),
          type: TokenType.PASSWORD_RESET,
          expiresAt,
        },
      });
    });
    return rawToken;
  }

  private invalidToken(): BadRequestException {
    return new BadRequestException('Invalid or expired password reset token.');
  }
}
