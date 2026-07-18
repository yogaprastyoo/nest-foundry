import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
// Import the enum value from `enums` (not the client barrel): the barrel pulls
// client.ts, whose ESM `.js` imports break under the unit-test Jest config.
import { TokenType } from '../../generated/prisma/enums';
import { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { generateToken, sha256 } from '../../common/crypto/token.util';
import { MailQueue } from '../../mail/mail.queue';
import { UsersService } from '../users/users.service';
import {
  RESEND_COOLDOWN_SECONDS,
  RESEND_QUOTA_MAX,
  RESEND_QUOTA_WINDOW_SECONDS,
  resendCooldownKey,
  resendQuotaKey,
} from './verification.constants';

@Injectable()
export class VerificationService {
  private readonly auditLog = new Logger('AuthAudit');

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly mailQueue: MailQueue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async sendVerificationEmail(user: {
    id: string;
    email: string;
    name: string;
  }): Promise<void> {
    const rawToken = await this.issueToken(user.id);
    const base = this.config.get('FRONTEND_URL', { infer: true });
    const url = `${base}/verify-email?token=${rawToken}`;
    await this.mailQueue.enqueueVerificationEmail({
      to: user.email,
      name: user.name,
      url,
    });
    this.auditLog.log({ event: 'verification_email_sent', userId: user.id });
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const row = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
    });
    if (
      !row ||
      row.type !== TokenType.EMAIL_VERIFICATION ||
      row.expiresAt < new Date()
    ) {
      this.auditLog.warn({ event: 'verification_token_invalid' });
      throw this.invalidToken();
    }

    await this.prisma.$transaction(async (tx) => {
      // Atomic single-use: only the request that deletes the row (count 1) wins.
      const { count } = await tx.verificationToken.deleteMany({
        where: { id: row.id },
      });
      if (count === 0) throw this.invalidToken();
      await tx.user.update({
        where: { id: row.userId },
        data: { isEmailVerified: true },
      });
    });
    this.auditLog.log({ event: 'email_verified', userId: row.userId });
  }

  async resendVerification(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    // Cooldown is set for ANY request (existing email or not) so a skip never
    // reveals whether the email is registered. Silent within cooldown.
    const acquired = await this.redis.set(
      resendCooldownKey(email),
      '1',
      'EX',
      RESEND_COOLDOWN_SECONDS,
      'NX',
    );
    if (!acquired) return;

    const user = await this.users.findByEmail(email);
    this.auditLog.log({ event: 'verification_resend_requested' });
    if (!user || user.isEmailVerified) return;

    // Quota is charged only for real sends, so unknown or already-verified
    // addresses can never burn a legitimate user's allowance.
    if (!(await this.consumeResendQuota(email))) {
      this.auditLog.warn({
        event: 'verification_resend_quota_exceeded',
        userId: user.id,
      });
      return;
    }

    await this.sendVerificationEmail({
      id: user.id,
      email: user.email,
      name: user.name,
    });
  }

  /** Fixed-window counter; returns false once the window's allowance is spent. */
  private async consumeResendQuota(email: string): Promise<boolean> {
    const key = resendQuotaKey(email);
    const count = await this.redis.incr(key);
    // Set the TTL on the first hit; repair it if a crash ever left the key
    // without one, otherwise the address would be blocked forever.
    if (count === 1 || (await this.redis.ttl(key)) < 0) {
      await this.redis.expire(key, RESEND_QUOTA_WINDOW_SECONDS);
    }
    return count <= RESEND_QUOTA_MAX;
  }

  private async issueToken(userId: string): Promise<string> {
    const rawToken = generateToken();
    const ttlSeconds = this.config.get('EMAIL_VERIFICATION_TTL', {
      infer: true,
    });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await this.prisma.$transaction(async (tx) => {
      // Single-active token: a new token invalidates prior same-type tokens.
      await tx.verificationToken.deleteMany({
        where: { userId, type: TokenType.EMAIL_VERIFICATION },
      });
      await tx.verificationToken.create({
        data: {
          userId,
          tokenHash: sha256(rawToken),
          type: TokenType.EMAIL_VERIFICATION,
          expiresAt,
        },
      });
    });
    return rawToken;
  }

  private invalidToken(): BadRequestException {
    return new BadRequestException('Invalid or expired verification token.');
  }
}
