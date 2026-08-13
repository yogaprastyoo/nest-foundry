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
import { normalizeEmail } from '../../common/transforms/normalize-email.util';
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
    const rawToken = await this.issueToken(
      user.id,
      TokenType.EMAIL_VERIFICATION,
      this.config.get('EMAIL_VERIFICATION_TTL', { infer: true }),
    );
    const base = this.config.get('FRONTEND_URL', { infer: true });
    const url = `${base}/verify-email?token=${rawToken}`;
    await this.mailQueue.enqueueVerificationEmail({
      to: user.email,
      name: user.name,
      url,
      token: rawToken,
    });
    this.auditLog.log({ event: 'verification_email_sent', userId: user.id });
  }

  async createPasswordResetToken(userId: string): Promise<string> {
    const rawToken = await this.issueToken(
      userId,
      TokenType.PASSWORD_RESET,
      this.config.get('PASSWORD_RESET_TTL', { infer: true }),
    );
    return rawToken;
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
    const email = normalizeEmail(rawEmail);
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

  private async consumeResendQuota(email: string): Promise<boolean> {
    const key = resendQuotaKey(email);
    const count = (await this.redis.eval(
      `local n = redis.call('INCR', KEYS[1])
       local ttl = redis.call('TTL', KEYS[1])
       if ttl < 0 then
         redis.call('EXPIRE', KEYS[1], ARGV[1])
       end
       return n`,
      1,
      key,
      String(RESEND_QUOTA_WINDOW_SECONDS),
    )) as number;
    return count <= RESEND_QUOTA_MAX;
  }

  private async issueToken(
    userId: string,
    type: TokenType = TokenType.EMAIL_VERIFICATION,
    ttlSeconds?: number,
  ): Promise<string> {
    const rawToken = generateToken();
    const ttl =
      ttlSeconds ??
      this.config.get('EMAIL_VERIFICATION_TTL', {
        infer: true,
      }) ??
      86400;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    await this.prisma.$transaction(async (tx) => {
      // Single-active token: a new token invalidates prior same-type tokens.
      await tx.verificationToken.deleteMany({
        where: { userId, type },
      });
      await tx.verificationToken.create({
        data: {
          userId,
          tokenHash: sha256(rawToken),
          type,
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
