import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { generateToken, sha256 } from '../../common/crypto/token.util';
import { normalizeEmail } from '../../common/transforms/normalize-email.util';
import { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import {
  googleOAuthCodeKey,
  googleOAuthStateKey,
} from './google-oauth.constants';

export interface GoogleProfileInput {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
}

const CONSUME_KEY_SCRIPT = `local value = redis.call('GET', KEYS[1])
if not value then return nil end
redis.call('DEL', KEYS[1])
return value`;

@Injectable()
export class GoogleOAuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async createState(): Promise<string> {
    const state = generateToken();
    const stored = await this.redis.set(
      googleOAuthStateKey(state),
      '1',
      'EX',
      this.config.get('GOOGLE_OAUTH_STATE_TTL', { infer: true }),
      'NX',
    );
    if (!stored) throw this.oauthFailure();
    return state;
  }

  async consumeState(state: string): Promise<boolean> {
    const consumed = await this.redis.eval(
      CONSUME_KEY_SCRIPT,
      1,
      googleOAuthStateKey(state),
    );
    return consumed === '1';
  }

  async createExchangeCode(userId: string): Promise<string> {
    const code = generateToken();
    const stored = await this.redis.set(
      googleOAuthCodeKey(sha256(code)),
      JSON.stringify({ userId }),
      'EX',
      this.config.get('GOOGLE_OAUTH_CODE_TTL', { infer: true }),
      'NX',
    );
    if (!stored) throw this.oauthFailure();
    return code;
  }

  async consumeExchangeCode(code: string): Promise<string | null> {
    const consumed = await this.redis.eval(
      CONSUME_KEY_SCRIPT,
      1,
      googleOAuthCodeKey(sha256(code)),
    );
    if (typeof consumed !== 'string') return null;

    try {
      const data = JSON.parse(consumed) as { userId?: unknown };
      return typeof data.userId === 'string' ? data.userId : null;
    } catch {
      return null;
    }
  }

  async resolveGoogleUser(profile: GoogleProfileInput) {
    if (!profile.emailVerified || !profile.googleId || !profile.email) {
      throw this.oauthFailure();
    }

    const email = normalizeEmail(profile.email);
    return this.prisma.$transaction(async (tx) => {
      const googleUser = await tx.user.findUnique({
        where: { googleId: profile.googleId },
      });
      const emailUser = await tx.user.findUnique({ where: { email } });

      if (googleUser && emailUser && googleUser.id !== emailUser.id) {
        throw this.oauthFailure();
      }
      if (googleUser) return googleUser;

      if (!emailUser) {
        return tx.user.create({
          data: {
            email,
            name: profile.name,
            password: null,
            googleId: profile.googleId,
            avatarUrl: profile.avatarUrl,
            isEmailVerified: true,
          },
        });
      }

      if (emailUser.isEmailVerified) {
        return tx.user.update({
          where: { id: emailUser.id },
          data: {
            googleId: profile.googleId,
            ...(emailUser.avatarUrl === null && profile.avatarUrl
              ? { avatarUrl: profile.avatarUrl }
              : {}),
          },
        });
      }

      const user = await tx.user.update({
        where: { id: emailUser.id },
        data: {
          googleId: profile.googleId,
          password: null,
          isEmailVerified: true,
          ...(emailUser.avatarUrl === null && profile.avatarUrl
            ? { avatarUrl: profile.avatarUrl }
            : {}),
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId: emailUser.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return user;
    });
  }

  private oauthFailure(): UnauthorizedException {
    return new UnauthorizedException('Unable to complete Google sign-in.');
  }
}
