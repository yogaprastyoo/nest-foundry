process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_CALLBACK_URL =
  'http://localhost:3000/api/v1/auth/google/callback';
process.env.GOOGLE_FRONTEND_CALLBACK_URL =
  'http://localhost:5173/auth/google/callback';

import {
  ExecutionContext,
  INestApplication,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { GoogleOAuthService } from '../src/modules/auth/google-oauth.service';
import { GoogleOAuthGuard } from '../src/modules/auth/guards/google-oauth.guard';

const user = {
  id: 'google-user-id',
  email: 'user@example.test',
  name: 'Google User',
  avatarUrl: null,
  role: 'USER',
};

const googleOAuth = {
  createExchangeCode: jest.fn(),
  consumeExchangeCode: jest.fn(),
  resolveGoogleUser: jest.fn(),
};

const auth = {
  findUserForGoogleExchange: jest.fn(),
  login: jest.fn(),
};

describe('Google OAuth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GoogleOAuthService)
      .useValue(googleOAuth)
      .overrideProvider(AuthService)
      .useValue(auth)
      .overrideGuard(GoogleOAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest<{
            user?: typeof user;
          }>();
          req.user = user;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.use(cookieParser());
    await app.init();
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(async () => {
    await app.close();
  });

  it('redirects the callback with a one-time code, never a token', async () => {
    googleOAuth.resolveGoogleUser.mockResolvedValue(user);
    googleOAuth.createExchangeCode.mockResolvedValue('one-time-code');

    const response = await request(app.getHttpServer() as App)
      .get('/api/v1/auth/google/callback')
      .expect(302);

    const location = response.headers.location;
    expect(location).toBe(
      'http://localhost:5173/auth/google/callback?code=one-time-code',
    );
    expect(location).not.toContain('access_token');
    expect(location).not.toContain('refresh_token');
  });

  it('rejects an unknown exchange code', async () => {
    googleOAuth.consumeExchangeCode.mockResolvedValue(null);

    const response = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/google/exchange')
      .send({ code: 'unknown' })
      .expect(401);

    expect(response.body).toEqual({
      success: false,
      message: 'Unable to complete Google sign-in.',
      errors: null,
    });
  });

  it('exchanges a valid code once and sets the refresh cookie', async () => {
    googleOAuth.consumeExchangeCode.mockResolvedValueOnce(user.id);
    auth.findUserForGoogleExchange.mockResolvedValue(user);
    auth.login.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      user,
    });

    const response = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/google/exchange')
      .send({ code: 'one-time-code' })
      .expect(200);

    const body = response.body as {
      data: {
        access_token: string;
        refresh_token: string;
        user: typeof user;
      };
    };
    expect(body.data).toMatchObject({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      user,
    });
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('refresh_token=')]),
    );
    expect(googleOAuth.consumeExchangeCode).toHaveBeenCalledWith(
      'one-time-code',
    );
  });

  it('rejects a code whose user has been deleted', async () => {
    googleOAuth.consumeExchangeCode.mockResolvedValue(user.id);
    auth.findUserForGoogleExchange.mockResolvedValue(null);

    await request(app.getHttpServer() as App)
      .post('/api/v1/auth/google/exchange')
      .send({ code: 'deleted-user-code' })
      .expect(401);
  });
});
