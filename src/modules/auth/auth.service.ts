import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { User } from '../../generated/prisma/client';
import { LOCKOUT_MAX, LOCKOUT_TTL_SECONDS, lockoutKey } from './auth.constants';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../../config/env.validation';
import { HashingService } from '../../common/hashing/hashing.service';
import { normalizeEmail } from '../../common/transforms/normalize-email.util';
import { resolveAvatarUrl } from '../../common/avatar/avatar.util';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { VerificationService } from './verification.service';
import { MailQueue } from '../../mail/mail.queue';
import { TokenType } from '../../generated/prisma/enums';
import { sha256 } from '../../common/crypto/token.util';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  private readonly auditLog = new Logger('AuthAudit');

  constructor(
    private readonly users: UsersService,
    private readonly hashing: HashingService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly verification: VerificationService,
    private readonly mailQueue: MailQueue,
    private readonly prisma: PrismaService,
  ) {}

  async register(dto: RegisterDto): Promise<RegisterResponseDto> {
    const requireVerification = this.config.get(
      'AUTH_REQUIRE_EMAIL_VERIFICATION',
      {
        infer: true,
      },
    );
    const passwordHash = await this.hashing.hash(dto.password);
    try {
      const user = await this.users.createLocal({
        email: normalizeEmail(dto.email),
        passwordHash,
        name: dto.name.trim(),
        isEmailVerified: !requireVerification,
      });
      if (requireVerification) {
        try {
          await this.verification.sendVerificationEmail({
            id: user.id,
            email: user.email,
            name: user.name,
          });
        } catch {
          // Never fail registration if the email can't be enqueued (e.g. Redis
          // down); the user exists and can request a resend later.
          this.auditLog.warn({
            event: 'verification_enqueue_failed',
            userId: user.id,
          });
        }
      }
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: resolveAvatarUrl(user),
        role: user.role,
        isEmailVerified: user.isEmailVerified,
      };
    } catch (error) {
      // Insert-first: P2002 is the source of truth for a duplicate email (race-safe).
      if (this.isPrismaCode(error, 'P2002')) {
        throw new ConflictException('Email is already registered.');
      }
      throw error;
    }
  }

  async validateUser(rawEmail: string, password: string): Promise<User> {
    const email = normalizeEmail(rawEmail);
    const key = lockoutKey(email);
    const attempts = Number((await this.redis.get(key)) ?? 0);
    if (attempts >= LOCKOUT_MAX) {
      this.auditLog.warn({ event: 'login_locked_out', email });
      throw new HttpException(
        'Too many login attempts. Please try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.users.findByEmailWithPassword(email);
    if (!user) {
      await this.hashing.verifyDummy(password);
      await this.incrementLockout(key);
      this.auditLog.warn({
        event: 'login_failed',
        email,
        reason: 'user_not_found',
      });
      throw new UnauthorizedException('Invalid email or password.');
    }
    if (user.password === null) {
      await this.hashing.verifyDummy(password);
      await this.incrementLockout(key);
      this.auditLog.warn({
        event: 'login_failed',
        email,
        reason: 'google_only',
      });
      throw new UnauthorizedException('Invalid email or password.');
    }

    const valid = await this.hashing.verify(user.password, password);
    if (!valid) {
      await this.incrementLockout(key);
      this.auditLog.warn({
        event: 'login_failed',
        email,
        reason: 'bad_password',
      });
      throw new UnauthorizedException('Invalid email or password.');
    }

    const requireVerification = this.config.get(
      'AUTH_REQUIRE_EMAIL_VERIFICATION',
      { infer: true },
    );
    if (requireVerification && !user.isEmailVerified) {
      this.auditLog.warn({
        event: 'login_failed',
        email,
        reason: 'unverified',
      });
      throw new ForbiddenException('Please verify your email first.');
    }

    await this.redis.del(key);
    return user;
  }

  findUserForGoogleExchange(userId: string): Promise<User | null> {
    return this.users.findById(userId);
  }

  async login(user: User) {
    this.auditLog.log({
      event: 'login_success',
      userId: user.id,
      email: user.email,
    });
    const pair = await this.tokens.issueTokens({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    return {
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: resolveAvatarUrl(user),
        role: user.role,
      },
    };
  }

  async refresh(token: string) {
    const rotated = await this.tokens.rotate(token);
    return {
      access_token: rotated.accessToken,
      refresh_token: rotated.refreshToken,
    };
  }

  async logout(token: string): Promise<void> {
    try {
      await this.tokens.revoke(token);
    } catch {
      // Idempotent logout: gracefully ignore token errors on logout
    }
    this.auditLog.log({ event: 'logout' });
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const email = normalizeEmail(dto.email);
    this.auditLog.log({ event: 'password_reset_requested' });
    const user = await this.users.findByEmail(email);
    if (!user) {
      await this.hashing.verifyDummy('dummy-password');
      return;
    }

    const rawToken = await this.verification.createPasswordResetToken(user.id);
    const base = this.config.get('FRONTEND_URL', { infer: true });
    const url = `${base}/reset-password?token=${rawToken}`;
    await this.mailQueue.enqueuePasswordResetEmail({
      to: user.email,
      name: user.name,
      url,
      token: rawToken,
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = sha256(dto.token);
    const tokenRow = await this.prisma.verificationToken.findUnique({
      where: { tokenHash },
    });

    if (
      !tokenRow ||
      tokenRow.type !== TokenType.PASSWORD_RESET ||
      tokenRow.expiresAt < new Date()
    ) {
      this.auditLog.warn({
        event: 'password_reset_failed',
        reason: 'invalid_token',
      });
      throw new UnauthorizedException(
        'Invalid or expired password reset token.',
      );
    }

    const passwordHash = await this.hashing.hash(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.verificationToken.deleteMany({
        where: { id: tokenRow.id },
      });
      if (count === 0) {
        throw new UnauthorizedException(
          'Invalid or expired password reset token.',
        );
      }
      await tx.user.update({
        where: { id: tokenRow.userId },
        data: { password: passwordHash },
      });
      await tx.refreshToken.deleteMany({
        where: { userId: tokenRow.userId },
      });
    });

    this.auditLog.log({
      event: 'password_reset_completed',
      userId: tokenRow.userId,
      sessionsRevoked: true,
    });
  }

  private async incrementLockout(key: string): Promise<void> {
    await this.redis.eval(
      `local n = redis.call('INCR', KEYS[1])
       redis.call('EXPIRE', KEYS[1], ARGV[1])
       return n`,
      1,
      key,
      String(LOCKOUT_TTL_SECONDS),
    );
  }

  private isPrismaCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === code &&
      (error as { name?: string }).name === 'PrismaClientKnownRequestError'
    );
  }
}
