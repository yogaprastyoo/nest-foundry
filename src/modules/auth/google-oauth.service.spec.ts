import { UnauthorizedException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { PrismaService } from '../../prisma/prisma.service';
import { sha256 } from '../../common/crypto/token.util';
import { GoogleOAuthService } from './google-oauth.service';

jest.mock('../../prisma/prisma.service');

type GoogleProfileInput = {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
};

const profile: GoogleProfileInput = {
  googleId: 'google-1',
  email: 'user@example.test',
  emailVerified: true,
  name: 'Google User',
  avatarUrl: 'https://lh3.googleusercontent.com/a/photo.jpg',
};

function build() {
  const prisma: DeepMockProxy<PrismaService> = mockDeep<PrismaService>();
  prisma.$transaction.mockImplementation((fn: (tx: PrismaService) => unknown) =>
    Promise.resolve(fn(prisma)),
  );
  const refreshRevocations: Array<{
    where: { userId: string; revokedAt: null };
    data: { revokedAt: Date };
  }> = [];
  prisma.refreshToken.updateMany.mockImplementation((input: unknown) => {
    refreshRevocations.push(
      input as {
        where: { userId: string; revokedAt: null };
        data: { revokedAt: Date };
      },
    );
    return Promise.resolve({ count: 1 }) as never;
  });

  const redis = {
    set: jest.fn(),
    eval: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'GOOGLE_OAUTH_STATE_TTL'
        ? 600
        : key === 'GOOGLE_OAUTH_CODE_TTL'
          ? 60
          : key === 'GOOGLE_REAUTH_STATE_TTL'
            ? 600
            : key === 'GOOGLE_REAUTH_CODE_TTL'
              ? 60
              : undefined,
    ),
  };
  const service = new GoogleOAuthService(
    prisma,
    redis as never,
    config as never,
  );
  return {
    service,
    prisma,
    user: prisma.user,
    refreshToken: prisma.refreshToken,
    refreshRevocations,
    redis,
  };
}

describe('GoogleOAuthService', () => {
  it('stores a state nonce with the configured one-time TTL', async () => {
    const { service, redis } = build();
    redis.set.mockResolvedValue('OK');

    const state = await service.createState();

    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(redis.set).toHaveBeenCalledWith(
      `oauth:google:state:${state}`,
      '1',
      'EX',
      600,
      'NX',
    );
  });

  it('atomically consumes a valid state', async () => {
    const { service, redis } = build();
    redis.eval.mockResolvedValue('1');

    await expect(service.consumeState('state')).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET'"),
      1,
      'oauth:google:state:state',
    );
  });

  it('rejects an absent state', async () => {
    const { service, redis } = build();
    redis.eval.mockResolvedValue(null);

    await expect(service.consumeState('state')).resolves.toBe(false);
  });

  it('stores only the exchange code hash', async () => {
    const { service, redis } = build();
    redis.set.mockResolvedValue('OK');

    const code = await service.createExchangeCode('user-1');

    expect(redis.set).toHaveBeenCalledWith(
      `oauth:google:code:${sha256(code)}`,
      JSON.stringify({ userId: 'user-1' }),
      'EX',
      60,
      'NX',
    );
  });

  it('atomically consumes an exchange code once', async () => {
    const { service, redis } = build();
    redis.eval.mockResolvedValue(JSON.stringify({ userId: 'user-1' }));

    await expect(service.consumeExchangeCode('code')).resolves.toBe('user-1');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET'"),
      1,
      `oauth:google:code:${sha256('code')}`,
    );
  });

  it('returns null for an absent or malformed exchange code', async () => {
    const { service, redis } = build();
    redis.eval.mockResolvedValueOnce(null).mockResolvedValueOnce('bad-json');

    await expect(service.consumeExchangeCode('missing')).resolves.toBeNull();
    await expect(service.consumeExchangeCode('malformed')).resolves.toBeNull();
  });

  it('rejects a Google profile with an unverified email', async () => {
    const { service } = build();

    await expect(
      service.resolveGoogleUser({ ...profile, emailVerified: false }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns the existing account for a known Google ID', async () => {
    const { service, user } = build();
    const existing = {
      id: 'user-1',
      googleId: profile.googleId,
      email: profile.email,
      avatarUrl: null,
    };
    user.findUnique.mockResolvedValueOnce(existing as never);

    await expect(service.resolveGoogleUser(profile)).resolves.toBe(existing);
    expect(user.findUnique).toHaveBeenCalledWith({
      where: { googleId: profile.googleId },
    });
  });

  it('creates a verified Google-only user for a new email', async () => {
    const { service, user } = build();
    const created = { id: 'user-1' };
    user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    user.create.mockResolvedValue(created as never);

    await expect(service.resolveGoogleUser(profile)).resolves.toBe(created);
    expect(user.create).toHaveBeenCalledWith({
      data: {
        email: profile.email,
        name: profile.name,
        password: null,
        googleId: profile.googleId,
        avatarUrl: profile.avatarUrl,
        isEmailVerified: true,
      },
    });
  });

  it('links a verified local account without replacing its password or avatar', async () => {
    const { service, user } = build();
    const local = {
      id: 'user-1',
      googleId: null,
      email: profile.email,
      avatarUrl: 'https://cdn.test/existing.png',
      isEmailVerified: true,
    };
    const linked = { ...local, googleId: profile.googleId };
    user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(local as never);
    user.update.mockResolvedValue(linked as never);

    await expect(service.resolveGoogleUser(profile)).resolves.toBe(linked);
    expect(user.update).toHaveBeenCalledWith({
      where: { id: local.id },
      data: { googleId: profile.googleId },
    });
  });

  it('neutralizes an unverified local account before linking Google', async () => {
    const { service, user, refreshToken, refreshRevocations } = build();
    const local = {
      id: 'user-1',
      googleId: null,
      email: profile.email,
      avatarUrl: null,
      isEmailVerified: false,
    };
    const linked = { ...local, googleId: profile.googleId };
    user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(local as never);
    user.update.mockResolvedValue(linked as never);

    await expect(service.resolveGoogleUser(profile)).resolves.toBe(linked);
    expect(user.update).toHaveBeenCalledWith({
      where: { id: local.id },
      data: {
        googleId: profile.googleId,
        password: null,
        isEmailVerified: true,
        avatarUrl: profile.avatarUrl,
      },
    });
    expect(refreshToken.updateMany).toHaveBeenCalledTimes(1);
    expect(refreshRevocations[0].where).toEqual({
      userId: local.id,
      revokedAt: null,
    });
    expect(refreshRevocations[0].data.revokedAt).toBeInstanceOf(Date);
  });

  it('rejects conflicting Google ID and email accounts', async () => {
    const { service, user } = build();
    user.findUnique
      .mockResolvedValueOnce({
        id: 'google-user',
        email: 'other@example.test',
      } as never)
      .mockResolvedValueOnce({
        id: 'email-user',
        email: profile.email,
      } as never);

    await expect(service.resolveGoogleUser(profile)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses to auto-link a verified account that unlinked Google', async () => {
    const { service, user } = build();
    user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'user-1',
      googleId: null,
      email: profile.email,
      googleUnlinkedAt: new Date(),
      isEmailVerified: true,
    } as never);

    await expect(service.resolveGoogleUser(profile)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('stores a reauth state bound to user and purpose with the configured TTL', async () => {
    const { service, redis } = build();
    redis.set.mockResolvedValue('OK');

    const state = await service.createReauthState({
      userId: 'user-1',
      purpose: 'set_password',
    });

    expect(redis.set).toHaveBeenCalledWith(
      `oauth:google:reauth:state:${state}`,
      JSON.stringify({ userId: 'user-1', purpose: 'set_password' }),
      'EX',
      600,
      'NX',
    );
  });

  it('consumes a reauth state atomically and parses its binding', async () => {
    const { service, redis } = build();
    redis.eval.mockResolvedValue(
      JSON.stringify({ userId: 'user-1', purpose: 'unlink_google' }),
    );

    await expect(service.consumeReauthState('state')).resolves.toEqual({
      userId: 'user-1',
      purpose: 'unlink_google',
    });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET'"),
      1,
      'oauth:google:reauth:state:state',
    );
  });

  it('returns null for a malformed reauth state', async () => {
    const { service, redis } = build();
    redis.eval.mockResolvedValue('not-json');

    await expect(service.consumeReauthState('state')).resolves.toBeNull();
  });

  it('creates a reauth code hashed and bound to user and purpose', async () => {
    const { service, redis } = build();
    redis.set.mockResolvedValue('OK');

    const code = await service.createReauthCode({
      userId: 'user-1',
      purpose: 'unlink_google',
    });

    expect(redis.set).toHaveBeenCalledWith(
      `oauth:google:reauth:code:${sha256(code)}`,
      JSON.stringify({ userId: 'user-1', purpose: 'unlink_google' }),
      'EX',
      60,
      'NX',
    );
  });

  it('consumes a reauth code only when user and purpose match', async () => {
    const { service, redis } = build();
    redis.eval.mockResolvedValue(
      JSON.stringify({ userId: 'user-1', purpose: 'set_password' }),
    );

    await expect(
      service.consumeReauthCode('code', {
        userId: 'user-1',
        purpose: 'set_password',
      }),
    ).resolves.toBe(true);

    await expect(
      service.consumeReauthCode('code', {
        userId: 'user-1',
        purpose: 'unlink_google',
      }),
    ).resolves.toBe(false);
  });

  it('returns false for an absent reauth code', async () => {
    const { service, redis } = build();
    redis.eval.mockResolvedValue(null);

    await expect(
      service.consumeReauthCode('code', {
        userId: 'user-1',
        purpose: 'set_password',
      }),
    ).resolves.toBe(false);
  });
});
