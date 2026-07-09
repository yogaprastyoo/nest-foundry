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
  it('menerima env valid dan meng-coerce angka', () => {
    const env = validateEnv(validEnv);
    expect(env.PORT).toBe(3000);
    expect(env.REDIS_PORT).toBe(6379);
    expect(env.NODE_ENV).toBe('test');
  });

  it('gagal (fail-fast) saat DATABASE_URL hilang', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { DATABASE_URL, ...rest } = validEnv;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('gagal saat NODE_ENV bukan enum yang dikenal', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('memakai default saat optional tidak diisi', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { PORT, ...rest } = validEnv;
    expect(validateEnv(rest).PORT).toBe(3000);
  });

  it('menolak JWT secret di bawah 32 karakter', () => {
    expect(() =>
      validateEnv({ ...validEnv, JWT_ACCESS_SECRET: 'pendek' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('menolak access dan refresh secret yang sama', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        JWT_REFRESH_SECRET: validEnv.JWT_ACCESS_SECRET,
      }),
    ).toThrow(/berbeda/);
  });

  it('mem-parse AUTH_REQUIRE_EMAIL_VERIFICATION sebagai boolean dengan default false', () => {
    expect(validateEnv(validEnv).AUTH_REQUIRE_EMAIL_VERIFICATION).toBe(false);
    expect(
      validateEnv({ ...validEnv, AUTH_REQUIRE_EMAIL_VERIFICATION: 'true' })
        .AUTH_REQUIRE_EMAIL_VERIFICATION,
    ).toBe(true);
  });

  it('memakai default TTL dan pool', () => {
    const env = validateEnv(validEnv);
    expect(env.JWT_ACCESS_TTL).toBe(900);
    expect(env.JWT_REFRESH_TTL).toBe(604800);
    expect(env.DATABASE_POOL_MAX).toBe(10);
  });
});
