import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { User } from '../../generated/prisma/client';
import { LOCKOUT_MAX, LOCKOUT_TTL_SECONDS, lockoutKey } from './auth.constants';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../../config/env.validation';
import { HashingService } from '../../common/hashing/hashing.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly hashing: HashingService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async register(dto: RegisterDto): Promise<void> {
    const requireVerification = this.config.get(
      'AUTH_REQUIRE_EMAIL_VERIFICATION',
      {
        infer: true,
      },
    );
    const passwordHash = await this.hashing.hash(dto.password);
    try {
      await this.users.createLocal({
        email: dto.email,
        passwordHash,
        name: dto.name,
        isEmailVerified: !requireVerification,
      });
    } catch (error) {
      // Insert-first: P2002 adalah sumber kebenaran email duplikat (kebal race condition).
      if (this.isPrismaCode(error, 'P2002')) {
        throw new ConflictException('Email sudah terdaftar.');
      }
      throw error;
    }
  }

  async validateUser(email: string, password: string): Promise<User> {
    const key = lockoutKey(email);
    const attempts = Number((await this.redis.get(key)) ?? 0);
    if (attempts >= LOCKOUT_MAX) {
      throw new HttpException(
        'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.users.findByEmail(email);
    if (!user) {
      await this.hashing.verifyDummy(password);
      throw new UnauthorizedException('Email atau password salah.');
    }
    if (user.password === null) {
      throw new UnprocessableEntityException(
        'Akun ini terdaftar via Google, silakan login dengan Google.',
      );
    }

    const valid = await this.hashing.verify(user.password, password);
    if (!valid) {
      await this.redis.incr(key);
      await this.redis.expire(key, LOCKOUT_TTL_SECONDS);
      throw new UnauthorizedException('Email atau password salah.');
    }

    const requireVerification = this.config.get(
      'AUTH_REQUIRE_EMAIL_VERIFICATION',
      { infer: true },
    );
    if (requireVerification && !user.isEmailVerified) {
      throw new ForbiddenException('Silakan verifikasi email terlebih dahulu.');
    }

    await this.redis.del(key);
    return user;
  }

  async login(user: User) {
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
