import { validateEnv } from './env.validation';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  CORS_ORIGINS: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
};

describe('validateEnv', () => {
  it('menerima env valid dan meng-coerce angka', () => {
    const env = validateEnv(validEnv);
    expect(env.PORT).toBe(3000);
    expect(env.REDIS_PORT).toBe(6379);
    expect(env.NODE_ENV).toBe('test');
  });

  it('gagal (fail-fast) saat DATABASE_URL hilang', () => {
    const { DATABASE_URL, ...rest } = validEnv;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('gagal saat NODE_ENV bukan enum yang dikenal', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('memakai default saat optional tidak diisi', () => {
    const { PORT, ...rest } = validEnv;
    expect(validateEnv(rest).PORT).toBe(3000);
  });
});
