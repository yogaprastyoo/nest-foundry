import './helpers/disable-email-verification';
import type { INestApplication } from '@nestjs/common';
import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.constants';
import {
  ThrottlerGuard,
  ThrottlerStorageService,
  ThrottlerStorage,
} from '@nestjs/throttler';

type App = Parameters<typeof request>[0];

interface RegisterResponse {
  data: {
    id: string;
  };
}

interface LoginResponse {
  data: {
    access_token: string;
    refresh_token: string;
  };
}

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

interface UserProfileData {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
  isEmailVerified: boolean;
  role: string;
  createdAt: string;
  updatedAt: string;
}

describe('Users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;

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
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
    await redis.flushdb();
    const throttlerStorage = app.get<ThrottlerStorageService>(ThrottlerStorage);
    throttlerStorage.storage.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createVerifiedUser(
    email = 'user@example.test',
    password = 'Password123!',
    name = 'Initial Name',
  ) {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({ email, password, name })
      .expect(201);

    const loginRes = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const regBody = res.body as RegisterResponse;
    const loginBody = loginRes.body as LoginResponse;

    return {
      userId: regBody.data.id,
      accessToken: loginBody.data.access_token,
      refreshToken: loginBody.data.refresh_token,
      cookie: loginRes.get('Set-Cookie')?.[0] ?? '',
    };
  }

  it('GET /api/v1/users/me returns the profile with resolved avatar URL', async () => {
    const { accessToken } = await createVerifiedUser(
      'profile@example.test',
      'Password123!',
      'Jane Profile',
    );

    const res = await request(app.getHttpServer() as App)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = res.body as ApiResponse<UserProfileData>;
    expect(body.success).toBe(true);
    expect(body.message).toBe('User profile retrieved successfully.');
    expect(body.data.email).toBe('profile@example.test');
    expect(body.data.name).toBe('Jane Profile');
    expect(body.data.avatarUrl).toContain('ui-avatars.com');
    expect(body.data.role).toBe('USER');
  });

  it('PATCH /api/v1/users/me updates name and explicit avatarUrl', async () => {
    const { accessToken } = await createVerifiedUser(
      'update@example.test',
      'Password123!',
      'Old Name',
    );

    const res = await request(app.getHttpServer() as App)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Updated Name',
        avatarUrl: 'https://cdn.example.test/avatar.png',
      })
      .expect(200);

    const body = res.body as ApiResponse<UserProfileData>;
    expect(body.success).toBe(true);
    expect(body.message).toBe('User profile updated successfully.');
    expect(body.data.email).toBe('update@example.test');
    expect(body.data.name).toBe('Updated Name');
    expect(body.data.avatarUrl).toBe('https://cdn.example.test/avatar.png');
  });

  it('DELETE /api/v1/users/me deletes the account and clears auth cookie', async () => {
    const { accessToken } = await createVerifiedUser(
      'delete@example.test',
      'Password123!',
      'Delete Me',
    );

    const res = await request(app.getHttpServer() as App)
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = res.body as ApiResponse<null>;
    expect(body).toEqual({
      success: true,
      message: 'Account deleted successfully.',
      data: null,
    });
    expect(res.get('Set-Cookie')?.[0]).toMatch(/refresh_token=;/);

    // Subsequent profile request with old token should fail
    await request(app.getHttpServer() as App)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('DELETE /api/v1/users/me invalidates multi-device sessions cleanly (401 on refresh from second device)', async () => {
    const email = 'multidevice@example.test';
    const password = 'Password123!';

    // Device A registers and logs in
    const deviceA = await createVerifiedUser(email, password, 'Multi Device');

    // Device B logs in
    const loginBRes = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const loginBBody = loginBRes.body as LoginResponse;
    const refreshTokenB = loginBBody.data.refresh_token;

    // Device A deletes the account
    await request(app.getHttpServer() as App)
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${deviceA.accessToken}`)
      .expect(200);

    // Device B tries to refresh token -> must return 401 Unauthorized cleanly
    const refreshRes = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: refreshTokenB })
      .expect(401);

    expect((refreshRes.body as { message: string }).message).toBe(
      'Invalid session, please sign in again.',
    );
  });
});
