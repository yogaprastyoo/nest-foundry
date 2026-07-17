import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    CORS_ORIGINS: z.string().default(''),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    REDIS_HOST: z.string().min(1).default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL: z.coerce.number().int().positive().default(604800),
    AUTH_REQUIRE_EMAIL_VERIFICATION: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    MAIL_DRIVER: z.enum(['log', 'resend']).default('log'),
    MAIL_FROM: z.string().min(1).default('Loopwork <noreply@example.com>'),
    RESEND_API_KEY: z.string().default(''),
    FRONTEND_URL: z.string().url().default('http://localhost:5173'),
    EMAIL_VERIFICATION_TTL: z.coerce.number().int().positive().default(86400),
  })
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
    path: ['JWT_REFRESH_SECRET'],
  })
  .refine(
    (env) => !(env.NODE_ENV === 'production' && env.MAIL_DRIVER === 'log'),
    {
      message: "MAIL_DRIVER must not be 'log' in production",
      path: ['MAIL_DRIVER'],
    },
  )
  .refine((env) => !(env.MAIL_DRIVER === 'resend' && !env.RESEND_API_KEY), {
    message: 'RESEND_API_KEY is required when MAIL_DRIVER=resend',
    path: ['RESEND_API_KEY'],
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${detail}`);
  }
  return result.data;
}
