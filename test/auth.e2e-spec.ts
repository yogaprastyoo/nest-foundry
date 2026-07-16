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
    // Reset lockout counters (Redis) DAN throttler in-memory antar test.
    // Throttler pakai storage in-memory, jadi flushdb Redis saja tidak cukup.
    await redis.flushdb();
    const throttlerStorage = app.get<ThrottlerStorageService>(ThrottlerStorage);
    throttlerStorage.storage.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('register sukses → 201 envelope + data user (tanpa password/token)', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({
        email: 'budi@example.com',
        password: 'password123',
        name: 'Budi',
      })
      .expect(201);
    const body = res.body as {
      success: boolean;
      message: string;
      data: Record<string, unknown>;
    };
    expect(body.success).toBe(true);
    expect(body.message).toBe('Registrasi berhasil.');
    expect(body.data).toMatchObject({
      name: 'Budi',
      email: 'budi@example.com',
      role: 'USER',
      isEmailVerified: true, // AUTH_REQUIRE_EMAIL_VERIFICATION=false di test
    });
    expect(body.data.id).toEqual(expect.any(String));
    // Jangan pernah bocorkan password/token di response register
    expect(body.data).not.toHaveProperty('password');
    expect(body.data).not.toHaveProperty('access_token');
  });

  it('email duplikat → 409 pesan spesifik', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({
        email: 'budi@example.com',
        password: 'password123',
        name: 'Budi',
      })
      .expect(409);
    expect(res.body).toEqual({
      success: false,
      message: 'Email sudah terdaftar.',
      errors: null,
    });
  });

  it('validasi gagal → 400 errors per-field (menguji flatten end-to-end)', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({ email: 'bukan-email', password: 'pendek', name: '' })
      .expect(400);
    const body = res.body as {
      success: boolean;
      message: string;
      errors: Record<string, string>;
    };
    expect(body.success).toBe(false);
    expect(body.message).toBe('Data yang kamu masukkan tidak valid.');
    expect(body.errors).toMatchObject({
      email: 'Format email tidak valid.',
      password: 'Password minimal 8 karakter.',
      name: 'Nama wajib diisi.',
    });
    // Urutan field mengikuti form FE: name → email → password
    expect(Object.keys(body.errors)).toEqual(['name', 'email', 'password']);
  });

  it('email case-insensitive → duplikat walau beda kapitalisasi', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({
        name: 'Budi Kapital',
        email: '  BUDI@Example.com  ',
        password: 'password123',
      })
      .expect(409);
    expect((res.body as { message: string }).message).toBe(
      'Email sudah terdaftar.',
    );
  });

  it('login case-insensitive → email kapital tetap bisa login', async () => {
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'BUDI@EXAMPLE.COM', password: 'password123' })
      .expect(200);
  });

  it('login sukses → token + user + cookie refresh httpOnly', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'budi@example.com', password: 'password123' })
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
      email: 'budi@example.com',
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

  it('password salah → 401 generik', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'budi@example.com', password: 'salah-total' })
      .expect(401);
    expect((res.body as { message: string }).message).toBe(
      'Email atau password salah.',
    );
  });

  it('body kosong → 400 validasi (bukan 401)', async () => {
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

  it('GET /users/me dengan token → 200 data user', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${sharedAccessToken}`)
      .expect(200);
    const resBody = res.body as {
      data: {
        email: string;
        name: string;
      };
    };
    expect(resBody.data).toMatchObject({
      email: 'budi@example.com',
      name: 'Budi',
    });
  });

  it('GET /users/me tanpa token → 401 envelope', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/api/v1/users/me')
      .expect(401);
    expect(res.body).toEqual({
      success: false,
      message: 'Silakan login terlebih dahulu.',
      errors: null,
    });
  });

  it('health tetap public', async () => {
    await request(app.getHttpServer() as App)
      .get('/api/v1/health')
      .expect(200);
  });

  it('refresh via body me-rotate token; token lama terdeteksi reuse → semua session mati', async () => {
    const login = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'budi@example.com', password: 'password123' });
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

    // Reuse token lama → 401
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: oldRefresh })
      .expect(401);

    // Reuse mematikan SEMUA session: token baru pun ikut tertolak
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: newRefresh })
      .expect(401);
  });

  it('refresh via cookie juga bekerja', async () => {
    const login = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'budi@example.com', password: 'password123' });
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((c: string) => c.startsWith('refresh_token='));
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie as string)
      .expect(200);
  });

  it('logout me-revoke refresh token dan menghapus cookie', async () => {
    const login = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'budi@example.com', password: 'password123' });
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
