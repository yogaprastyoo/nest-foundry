import { z } from 'zod';

export const envSchema = z
  .object({
    APP_NAME: z.string().min(1).default('Nest Foundry'),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    CORS_ORIGINS: z.string().default(''),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    REDIS_HOST: z.string().min(1).default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().optional(),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL: z.coerce.number().int().positive().default(604800),
    JWT_ISSUER: z.string().min(1).default('nest-foundry-api'),
    JWT_AUDIENCE: z.string().min(1).default('nest-foundry-client'),
    AUTH_REQUIRE_EMAIL_VERIFICATION: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    MAIL_DRIVER: z.enum(['log', 'resend']).default('log'),
    MAIL_FROM: z.string().min(1).default('Nest Foundry <noreply@example.com>'),
    RESEND_API_KEY: z.string().default(''),
    FRONTEND_URL: z.string().url().default('http://localhost:5173'),
    EMAIL_VERIFICATION_TTL: z.coerce.number().int().positive().default(86400),
    PASSWORD_RESET_TTL: z.coerce.number().int().positive().default(3600),
    GOOGLE_REAUTH_STATE_TTL: z.coerce.number().int().positive().default(600),
    GOOGLE_REAUTH_CODE_TTL: z.coerce.number().int().positive().default(60),
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    GOOGLE_CALLBACK_URL: z.string().default(''),
    GOOGLE_FRONTEND_CALLBACK_URL: z.string().default(''),
    GOOGLE_OAUTH_STATE_TTL: z.coerce.number().int().positive().default(600),
    GOOGLE_OAUTH_CODE_TTL: z.coerce.number().int().positive().default(60),
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
  })
  .refine(
    (env) => {
      const hasGoogleCredentials =
        Boolean(env.GOOGLE_CLIENT_ID) || Boolean(env.GOOGLE_CLIENT_SECRET);
      return (
        !hasGoogleCredentials ||
        (Boolean(env.GOOGLE_CLIENT_ID) &&
          Boolean(env.GOOGLE_CLIENT_SECRET) &&
          Boolean(env.GOOGLE_CALLBACK_URL) &&
          Boolean(env.GOOGLE_FRONTEND_CALLBACK_URL))
      );
    },
    {
      message: 'All Google OAuth settings must be configured together',
      path: ['GOOGLE_CALLBACK_URL'],
    },
  )
  .refine(
    (env) =>
      !env.GOOGLE_CALLBACK_URL ||
      z.string().url().safeParse(env.GOOGLE_CALLBACK_URL).success,
    {
      message: 'GOOGLE_CALLBACK_URL must be a valid URL',
      path: ['GOOGLE_CALLBACK_URL'],
    },
  )
  .refine(
    (env) =>
      !env.GOOGLE_FRONTEND_CALLBACK_URL ||
      z.string().url().safeParse(env.GOOGLE_FRONTEND_CALLBACK_URL).success,
    {
      message: 'GOOGLE_FRONTEND_CALLBACK_URL must be a valid URL',
      path: ['GOOGLE_FRONTEND_CALLBACK_URL'],
    },
  );

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
