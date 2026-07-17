import './helpers/enable-email-verification'; // sets the toggle before AppModule loads
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
import { MailQueue } from '../src/mail/mail.queue';

describe('Email verification (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  const captured: { url?: string } = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(MailQueue)
      .useValue({
        enqueueVerificationEmail: (job: { url: string }) => {
          captured.url = job.url;
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
        name: 'Budi',
        email: 'budi@example.com',
        password: 'password123',
      })
      .expect(201);
    expect(captured.url).toMatch(/\/verify-email\?token=/);
  });

  it('login before verifying is rejected with 403', async () => {
    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ email: 'budi@example.com', password: 'password123' })
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
      .send({ email: 'budi@example.com', password: 'password123' })
      .expect(200);
  });

  it('resend-verification returns a uniform 200 for unknown and known emails', async () => {
    const unknown = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'nobody@example.com' })
      .expect(200);
    expect((unknown.body as { success: boolean }).success).toBe(true);

    await redis.flushdb(); // clear cooldown to allow a second request
    const known = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'budi@example.com' })
      .expect(200);
    expect((known.body as { message: string }).message).toBe(
      'If the email is registered, a verification link has been sent.',
    );
  });
});
