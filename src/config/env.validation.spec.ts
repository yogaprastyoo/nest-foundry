import { validateEnv } from './env.validation';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  CORS_ORIGINS: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnv', () => {
  it('accepts a valid env and coerces numbers', () => {
    const env = validateEnv(validEnv);
    expect(env.PORT).toBe(3000);
    expect(env.REDIS_PORT).toBe(6379);
    expect(env.NODE_ENV).toBe('test');
  });

  it('fails (fail-fast) when DATABASE_URL is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { DATABASE_URL, ...rest } = validEnv;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('fails when NODE_ENV is not a known enum', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('uses defaults when optional values are omitted', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { PORT, ...rest } = validEnv;
    expect(validateEnv(rest).PORT).toBe(3000);
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() =>
      validateEnv({ ...validEnv, JWT_ACCESS_SECRET: 'short' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects identical access and refresh secrets', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        JWT_REFRESH_SECRET: validEnv.JWT_ACCESS_SECRET,
      }),
    ).toThrow(/different/);
  });

  it('parses AUTH_REQUIRE_EMAIL_VERIFICATION as a boolean, default false', () => {
    expect(validateEnv(validEnv).AUTH_REQUIRE_EMAIL_VERIFICATION).toBe(false);
    expect(
      validateEnv({ ...validEnv, AUTH_REQUIRE_EMAIL_VERIFICATION: 'true' })
        .AUTH_REQUIRE_EMAIL_VERIFICATION,
    ).toBe(true);
  });

  it('uses default TTL and pool', () => {
    const env = validateEnv(validEnv);
    expect(env.JWT_ACCESS_TTL).toBe(900);
    expect(env.JWT_REFRESH_TTL).toBe(604800);
    expect(env.DATABASE_POOL_MAX).toBe(10);
  });

  it('defaults MAIL_DRIVER to log and EMAIL_VERIFICATION_TTL to 86400', () => {
    const env = validateEnv(validEnv);
    expect(env.MAIL_DRIVER).toBe('log');
    expect(env.EMAIL_VERIFICATION_TTL).toBe(86400);
  });

  it('rejects MAIL_DRIVER=log in production', () => {
    expect(() =>
      validateEnv({ ...validEnv, NODE_ENV: 'production', MAIL_DRIVER: 'log' }),
    ).toThrow(/MAIL_DRIVER/);
  });

  it('requires RESEND_API_KEY when MAIL_DRIVER=resend', () => {
    expect(() =>
      validateEnv({ ...validEnv, MAIL_DRIVER: 'resend', RESEND_API_KEY: '' }),
    ).toThrow(/RESEND_API_KEY/);
  });

  it('accepts Google OAuth URLs and default TTLs', () => {
    const env = validateEnv({
      ...validEnv,
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      GOOGLE_CALLBACK_URL: 'http://localhost:3000/api/v1/auth/google/callback',
      GOOGLE_FRONTEND_CALLBACK_URL:
        'http://localhost:5173/auth/google/callback',
    });
    expect(env.GOOGLE_OAUTH_STATE_TTL).toBe(600);
    expect(env.GOOGLE_OAUTH_CODE_TTL).toBe(60);
  });

  it('rejects malformed Google OAuth callback URLs', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        GOOGLE_CALLBACK_URL: 'not-a-url',
      }),
    ).toThrow(/GOOGLE_CALLBACK_URL/);
  });

  it('requires all Google OAuth settings when one is configured', () => {
    expect(() =>
      validateEnv({ ...validEnv, GOOGLE_CLIENT_ID: 'client-id' }),
    ).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it('rejects an invalid FRONTEND_URL', () => {
    expect(() =>
      validateEnv({ ...validEnv, FRONTEND_URL: 'not-a-url' }),
    ).toThrow(/FRONTEND_URL/);
  });
});
