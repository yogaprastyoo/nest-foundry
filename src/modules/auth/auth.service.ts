import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { User } from '../../generated/prisma/client';
import { LOCKOUT_MAX, LOCKOUT_TTL_SECONDS, lockoutKey } from './auth.constants';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../../config/env.validation';
import { HashingService } from '../../common/hashing/hashing.service';
import { resolveAvatarUrl } from '../../common/avatar/avatar.util';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { VerificationService } from './verification.service';

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
        email: this.normalizeEmail(dto.email),
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
    const email = this.normalizeEmail(rawEmail);
    const key = lockoutKey(email);
    const attempts = Number((await this.redis.get(key)) ?? 0);
    if (attempts >= LOCKOUT_MAX) {
      this.auditLog.warn({ event: 'login_locked_out', email });
      throw new HttpException(
        'Too many login attempts. Please try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.users.findByEmail(email);
    if (!user) {
      await this.hashing.verifyDummy(password);
      this.auditLog.warn({
        event: 'login_failed',
        email,
        reason: 'user_not_found',
      });
      throw new UnauthorizedException('Invalid email or password.');
    }
    if (user.password === null) {
      this.auditLog.warn({
        event: 'login_failed',
        email,
        reason: 'google_only',
      });
      throw new UnprocessableEntityException(
        'This account is registered via Google. Please sign in with Google.',
      );
    }

    const valid = await this.hashing.verify(user.password, password);
    if (!valid) {
      await this.redis.incr(key);
      await this.redis.expire(key, LOCKOUT_TTL_SECONDS);
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
    await this.tokens.revoke(token);
    this.auditLog.log({ event: 'logout' });
  }

  // Normalize so email lookup/storage is case-insensitive (Passport's login
  // path bypasses the DTO, so this is the single source of truth for it).
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
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
