import './helpers/enable-email-verification'; // sets the toggle before AppModule loads
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

describe('Email verification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  const captured: { url?: string; sends: number } = { sends: 0 };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(MailQueue)
      .useValue({
        enqueueVerificationEmail: (job: { url: string }) => {
          captured.url = job.url;
          captured.sends += 1;
          return Promise.resolve();
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS_CLIENT);
    await prisma.refreshToken.deleteMany();
    await prisma.verificationToken.deleteMany();
    await prisma.user.deleteMany();
    await redis.flushdb();
  });

  afterAll(async () => {
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = 'false';
    await app.close();
  });

  function tokenFromCaptured(): string {
    const url = new URL(captured.url as string);
    return url.searchParams.get('token') as string;
  }

  it('register (toggle on) enqueues a verification link', async () => {
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({
        name: 'Test User',
        email: 'user@example.test',
        password: 'password123',
      })
      .expect(201);
    expect(captured.url).toMatch(/\/verify-email\?token=/);
  });

  it('login before verifying is rejected with 403', async () => {
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.test', password: 'password123' })
      .expect(403);
  });

  it('an invalid token is rejected uniformly', async () => {
    const res = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'not-a-real-token' })
      .expect(400);
    expect((res.body as { message: string }).message).toBe(
      'Invalid or expired verification token.',
    );
  });

  it('verify-email consumes the token and enables login', async () => {
    const token = tokenFromCaptured();
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(200);

    // Single-use: the same token no longer works
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(400);

    // Now login succeeds
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.test', password: 'password123' })
      .expect(200);
  });

  it('resend-verification returns a uniform 200 for unknown and known emails', async () => {
    const unknown = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'unknown@example.test' })
      .expect(200);
    expect((unknown.body as { success: boolean }).success).toBe(true);

    await redis.flushdb(); // clear cooldown to allow a second request
    const known = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'user@example.test' })
      .expect(200);
    expect((known.body as { message: string }).message).toBe(
      'If the email is registered, a verification link has been sent.',
    );
  });

  it('hourly quota caps resends even when the per-minute cooldown is bypassed', async () => {
    const email = 'quota@example.test';
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({ name: 'Quota User', email, password: 'password123' })
      .expect(201);

    // Registration itself is not charged against the resend quota.
    captured.sends = 0;

    // Simulate the worst case: an attacker rotating IPs (clearing the per-IP
    // throttle) and waiting out the per-minute cooldown. Only the quota, which
    // is keyed by email, is left to stop them.
    const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);
    for (let i = 0; i < 7; i++) {
      throttler.storage.clear();
      await redis.del(`verify:cooldown:${email}`);
      await request(app.getHttpServer() as App)
        .post('/api/v1/auth/resend-verification')
        .send({ email })
        .expect(200); // always a uniform 200, quota or not
    }

    expect(captured.sends).toBe(5); // RESEND_QUOTA_MAX
  });
});
