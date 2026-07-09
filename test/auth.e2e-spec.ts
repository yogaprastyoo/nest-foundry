import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
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
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();

    const redis = app.get<Redis>(REDIS_CLIENT);
    await redis.flushdb();
  });

  afterAll(async () => {
    await app.close();
  });

  it('register sukses → 201 envelope data null', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({
        email: 'budi@example.com',
        password: 'password123',
        name: 'Budi',
      })
      .expect(201);
    expect(res.body).toEqual({
      success: true,
      message: 'Registrasi berhasil.',
      data: null,
    });
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

  it('GET /users/me dengan token → 200 data user', async () => {
    const login = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'budi@example.com', password: 'password123' });
    const loginBody = login.body as {
      data: {
        access_token: string;
        refresh_token: string;
        user: { email: string; role: string };
      };
    };
    const res = await request(app.getHttpServer() as App)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${loginBody.data.access_token}`)
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
});
