import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { Env } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';

export const JWT_ISSUER = 'loopwork-api';
export const JWT_AUDIENCE = 'loopwork-client';

export interface TokenUser {
  id: string;
  email: string;
  role: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Sentinel dilempar di dalam $transaction ketika updateMany conditional
 * gagal menemukan baris (count 0) — artinya request lain sudah memakai
 * token ini lebih dulu (race TOCTOU). Melempar ini membatalkan transaksi;
 * ditangkap di luar untuk memicu revoke-all seperti path reuse biasa.
 */
class TokenAlreadyConsumedError extends Error {}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  async issueTokens(user: TokenUser): Promise<TokenPair> {
    const pair = this.signPair(user);
    await this.prisma.refreshToken.create({
      data: this.refreshRecord(user.id, pair.refreshToken),
    });
    return pair;
  }

  async rotate(refreshToken: string): Promise<TokenPair & { userId: string }> {
    const payload = await this.verifyRefresh(refreshToken);
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.sha256(refreshToken) },
    });
    if (!row)
      throw new UnauthorizedException('Sesi tidak valid, silakan login ulang.');
    if (row.revokedAt) {
      // Reuse terdeteksi: token curian atau replay — matikan semua session user.
      await this.revokeAllForUser(row.userId);
      throw new UnauthorizedException('Sesi tidak valid, silakan login ulang.');
    }
    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException('Sesi kadaluarsa, silakan login ulang.');
    }
    const pair = this.signPair({
      id: row.userId,
      email: payload.email ?? '',
      role: payload.role ?? '',
    });
    try {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.refreshToken.updateMany({
          where: { id: row.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (count === 0) {
          // Baris sudah direvoke oleh request lain di antara findUnique dan
          // transaksi ini (race TOCTOU) — perlakukan sama seperti reuse.
          throw new TokenAlreadyConsumedError();
        }
        await tx.refreshToken.create({
          data: this.refreshRecord(row.userId, pair.refreshToken),
        });
      });
    } catch (err) {
      if (err instanceof TokenAlreadyConsumedError) {
        await this.revokeAllForUser(row.userId);
        throw new UnauthorizedException(
          'Sesi tidak valid, silakan login ulang.',
        );
      }
      throw err;
    }
    return { ...pair, userId: row.userId };
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private signPair(user: TokenUser): TokenPair {
    const base = {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithm: 'HS256' as const,
    };
    const accessToken = this.jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      {
        ...base,
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
      },
    );
    const refreshToken = this.jwt.sign(
      { sub: user.id, email: user.email, role: user.role, jti: randomUUID() },
      {
        ...base,
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_REFRESH_TTL', { infer: true }),
      },
    );
    return { accessToken, refreshToken };
  }

  private async verifyRefresh(
    token: string,
  ): Promise<{ sub: string; email?: string; role?: string }> {
    try {
      return await this.jwt.verifyAsync(token, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Sesi tidak valid, silakan login ulang.');
    }
  }

  private refreshRecord(userId: string, refreshToken: string) {
    const ttlMs = this.config.get('JWT_REFRESH_TTL', { infer: true }) * 1000;
    return {
      userId,
      tokenHash: this.sha256(refreshToken),
      expiresAt: new Date(Date.now() + ttlMs),
    };
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
