import './helpers/disable-email-verification'; // pins the toggle before AppModule loads
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageService } from '@nestjs/throttler/dist/throttler.service';
import request from 'supertest';
import { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.module';
import { MailQueue } from '../src/mail/mail.queue';
import { GoogleOAuthService } from '../src/modules/auth/google-oauth.service';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let sharedAccessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS_CLIENT);

    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await redis.flushdb();
  });

  beforeEach(async () => {
    // Throttler uses in-memory storage, so reset it too — flushing Redis (the
    // lockout counters) alone is not enough to isolate tests.
    await redis.flushdb();
    const throttlerStorage = app.get<ThrottlerStorageService>(ThrottlerStorage);
    throttlerStorage.storage.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('register success -> 201 envelope + user data (no password/token)', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({
        email: 'user@example.test',
        password: 'password123',
        name: 'Test User',
      })
      .expect(201);
    const body = res.body as {
      success: boolean;
      message: string;
      data: Record<string, unknown>;
    };
    expect(body.success).toBe(true);
    expect(body.message).toBe('Registration successful.');
    expect(body.data).toMatchObject({
      name: 'Test User',
      email: 'user@example.test',
      role: 'USER',
      isEmailVerified: true, // AUTH_REQUIRE_EMAIL_VERIFICATION=false in test
    });
    expect(body.data.id).toEqual(expect.any(String));
    // No explicit avatar yet -> generated fallback built from the name
    expect(body.data.avatarUrl).toBe(
      'https://ui-avatars.com/api/?name=Test+User&size=256',
    );
    // Never leak password/token in the register response
    expect(body.data).not.toHaveProperty('password');
    expect(body.data).not.toHaveProperty('access_token');
  });

  it('duplicate email -> 409 with specific message', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({
        email: 'user@example.test',
        password: 'password123',
        name: 'Test User',
      })
      .expect(409);
    expect(res.body).toEqual({
      success: false,
      message: 'Email is already registered.',
      errors: null,
    });
  });

  it('validation failed -> 400 per-field errors (exercises flatten end-to-end)', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'short', name: '' })
      .expect(400);
    const body = res.body as {
      success: boolean;
      message: string;
      errors: Record<string, string>;
    };
    expect(body.success).toBe(false);
    expect(body.message).toBe('The given data was invalid.');
    expect(body.errors).toMatchObject({
      email: 'Email must be a valid email address.',
      password: 'Password must be at least 8 characters.',
      name: 'Name is required.',
    });
    // Field order follows the FE form: name -> email -> password
    expect(Object.keys(body.errors)).toEqual(['name', 'email', 'password']);
  });

  it('Laravel-style rule priority -> empty fields return "is required", not format', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({ name: '', email: '', password: '' })
      .expect(400);
    const body = res.body as { errors: Record<string, string> };
    // An empty email fails both required AND email; required wins.
    expect(body.errors).toEqual({
      name: 'Name is required.',
      email: 'Email is required.',
      password: 'Password is required.',
    });
  });

  it('case-insensitive email -> duplicate even with different casing', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({
        name: 'Test User Uppercase',
        email: '  USER@Example.test  ',
        password: 'password123',
      })
      .expect(409);
    expect((res.body as { message: string }).message).toBe(
      'Email is already registered.',
    );
  });

  it('case-insensitive login -> uppercase email can still log in', async () => {
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'USER@EXAMPLE.TEST', password: 'password123' })
      .expect(200);
  });

  it('login success -> token + user + httpOnly refresh cookie', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.test', password: 'password123' })
      .expect(200);
    const body = res.body as {
      data: {
        access_token: string;
        refresh_token: string;
        user: { email: string; role: string };
      };
    };
    expect(body.data.access_token).toBeDefined();
    expect(body.data.refresh_token).toBeDefined();
    expect(body.data.user).toMatchObject({
      email: 'user@example.test',
      role: 'USER',
    });
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((c: string) => c.startsWith('refresh_token='));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('SameSite=Lax');

    // Save token for reuse in subsequent tests
    sharedAccessToken = body.data.access_token;
  });

  it('wrong password -> 401 generic message', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.test', password: 'totally-wrong' })
      .expect(401);
    expect((res.body as { message: string }).message).toBe(
      'Invalid email or password.',
    );
  });

  it('locks an unknown email after ten failed password logins', async () => {
    // Ten sequential Argon2 logins can exceed Jest's 5s default under CI
    // load; give the lockout path room to breathe.

    const email = 'unknown-lockout@example.test';
    const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      throttler.storage.clear();
      await request(app.getHttpServer() as App)
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(401);
    }

    throttler.storage.clear();
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(429);
  }, 15_000);

  it('locks password login for a Google-only account after ten failures', async () => {
    const email = 'google-only-lockout@example.test';
    const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
    await prisma.user.create({
      data: {
        email,
        name: 'Google Only User',
        password: null,
        googleId: 'google-only-lockout-id',
        isEmailVerified: true,
      },
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      throttler.storage.clear();
      await request(app.getHttpServer() as App)
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(401);
    }

    throttler.storage.clear();
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(429);
  }, 15_000);

  it('empty body -> 400 validation (not 401)', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({})
      .expect(400);
    const body = res.body as {
      success: boolean;
      message: string;
      errors: Record<string, string>;
    };
    expect(body.success).toBe(false);
    expect(body.errors).toHaveProperty('email');
    expect(body.errors).toHaveProperty('password');
  });

  it('GET /users/me with token -> 200 user data', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${sharedAccessToken}`)
      .expect(200);
    const resBody = res.body as {
      data: {
        email: string;
        name: string;
        avatarUrl: string;
      };
    };
    expect(resBody.data).toMatchObject({
      email: 'user@example.test',
      name: 'Test User',
    });
    expect(resBody.data.avatarUrl).toContain('ui-avatars.com');
  });

  it('GET /users/me without token -> 401 envelope', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/api/v1/users/me')
      .expect(401);
    expect(res.body).toEqual({
      success: false,
      message: 'Please sign in first.',
      errors: null,
    });
  });

  it('a still-valid token is rejected once the account is deleted', async () => {
    // Register + log in a throwaway account, then delete it while its token is
    // still unexpired: access must stop immediately, not when the JWT expires.
    const email = 'deleted@example.test';
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({ name: 'Deleted User', email, password: 'password123' })
      .expect(201);
    const login = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);
    const token = (login.body as { data: { access_token: string } }).data
      .access_token;

    // Token works while the account exists
    await request(app.getHttpServer() as App)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await prisma.user.delete({ where: { email } });

    await request(app.getHttpServer() as App)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('health stays public', async () => {
    await request(app.getHttpServer() as App)
      .get('/api/v1/health')
      .expect(200);
  });

  it('refresh via body rotates token; old token detected as reuse -> all sessions killed', async () => {
    const login = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.test', password: 'password123' });
    const loginBody = login.body as {
      data: { refresh_token: string };
    };
    const oldRefresh = loginBody.data.refresh_token;

    const rotated = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: oldRefresh })
      .expect(200);
    const rotatedBody = rotated.body as {
      data: { refresh_token: string };
    };
    const newRefresh = rotatedBody.data.refresh_token;
    expect(newRefresh).not.toEqual(oldRefresh);

    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: oldRefresh })
      .expect(401);

    // Reuse kills ALL sessions: even the freshly rotated token is now rejected
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: newRefresh })
      .expect(401);
  });

  it('refresh via cookie also works', async () => {
    const login = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.test', password: 'password123' });
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((c: string) => c.startsWith('refresh_token='));
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie as string)
      .expect(200);
  });

  it('logout revokes the refresh token and clears the cookie', async () => {
    const login = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.test', password: 'password123' });
    const loginBody = login.body as {
      data: { refresh_token: string };
    };
    const refresh = loginBody.data.refresh_token;

    const out = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/logout')
      .send({ refresh_token: refresh })
      .expect(200);
    const outBody = out.body as { data: null };
    expect(outBody.data).toBeNull();

    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: refresh })
      .expect(401);
  });

  it('forgot-password replies uniformly and emails only a local-password account', async () => {
    const mailQueue = app.get(MailQueue);
    const enqueueSpy = jest
      .spyOn(mailQueue, 'enqueuePasswordResetEmail')
      .mockResolvedValue(undefined);

    // Unknown email: same response, no mail.
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.test' })
      .expect(200)
      .expect((res) =>
        expect(res.body).toEqual({
          success: true,
          message:
            'If the email is registered, a password reset link has been sent.',
          data: null,
        }),
      );

    // Google-only account: uniform response, no mail (reset is not a
    // password-setup route).
    await prisma.user.create({
      data: {
        email: 'google-only-reset@example.test',
        name: 'Google Only',
        password: null,
        googleId: 'g-reset',
        isEmailVerified: true,
      },
    });
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'google-only-reset@example.test' })
      .expect(200);
    expect(enqueueSpy).not.toHaveBeenCalled();

    enqueueSpy.mockRestore();
  });

  it('reset-password updates the password and revokes all refresh sessions', async () => {
    const mailQueue = app.get(MailQueue);
    const enqueueSpy = jest
      .spyOn(mailQueue, 'enqueuePasswordResetEmail')
      .mockResolvedValue(undefined);

    const email = 'reset@example.test';
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({ name: 'Reset User', email, password: 'password123' })
      .expect(201);

    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/forgot-password')
      .send({ email })
      .expect(200);

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const rawToken = (enqueueSpy.mock.calls[0][0] as { url: string }).url.split(
      'token=',
    )[1];

    const out = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, newPassword: 'newpass123' })
      .expect(200);
    expect((out.body as { message: string }).message).toBe(
      'Password reset successfully. Please sign in again.',
    );

    // Token is single-use now.
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, newPassword: 'anotherpass123' })
      .expect(400);

    // Old password stops working; the new one does.
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(401);
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email, password: 'newpass123' })
      .expect(200);

    enqueueSpy.mockRestore();
  });

  it('change-password requires the current password and revokes sessions', async () => {
    const email = 'change@example.test';
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({ name: 'Change User', email, password: 'password123' })
      .expect(201);
    const login = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);
    const token = (login.body as { data: { access_token: string } }).data
      .access_token;
    const refresh = (login.body as { data: { refresh_token: string } }).data
      .refresh_token;

    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrong123', newPassword: 'newpass123' })
      .expect(400);

    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'password123', newPassword: 'newpass123' })
      .expect(200);

    // Old refresh session is dead; old password dead; new password works.
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: refresh })
      .expect(401);
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(401);
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email, password: 'newpass123' })
      .expect(200);
  });

  it('set-password requires a valid Google reauth code and keeps the Google link', async () => {
    // Start as a normal local account to obtain a session, then flip it into
    // a Google-only state so set-password applies. The access token remains
    // valid because the user still exists.
    const email = 'set-pass@example.test';
    const googleId = 'g-set-pass';
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({ name: 'Set Pass', email, password: 'password123' })
      .expect(201);
    const login = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);
    const token = (login.body as { data: { access_token: string } }).data
      .access_token;

    await prisma.user.update({
      where: { email },
      data: { googleId, password: null },
    });

    // Invalid proof first.
    const denied = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/set-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'newpass123', googleReauthCode: 'nope' })
      .expect(403);
    expect((denied.body as { message: string }).message).toBe(
      'Google reauthentication is required.',
    );

    // Mint a real proof for the account and retry.
    const googleOAuth = app.get(GoogleOAuthService);
    const userId = (await prisma.user.findUnique({ where: { email } }))!.id;
    const code = await googleOAuth.createReauthCode({
      userId,
      purpose: 'set_password',
    });
    const ok = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/set-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'newpass123', googleReauthCode: code })
      .expect(200);
    expect((ok.body as { message: string }).message).toBe(
      'Password set successfully. Please sign in again.',
    );

    const row = await prisma.user.findUnique({ where: { email } });
    expect(row?.password).not.toBeNull();
    expect(row?.googleId).toBe(googleId);

    // New password logs in; Google link still present.
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email, password: 'newpass123' })
      .expect(200);
  });
});
