export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
export const LOCKOUT_MAX = 10;
export const LOCKOUT_TTL_SECONDS = 900;
export const lockoutKey = (email: string): string => `auth:lockout:${email}`;
