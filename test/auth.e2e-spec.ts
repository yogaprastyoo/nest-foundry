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
});
