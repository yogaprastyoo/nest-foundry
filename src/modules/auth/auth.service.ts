import { ConflictException, Inject, Injectable } from '@nestjs/common';
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

  private isPrismaCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === code &&
      (error as { name?: string }).name === 'PrismaClientKnownRequestError'
    );
  }
}
