import { API_BASE_PATH } from '../../common/constants/api.constants';

export const REFRESH_COOKIE = 'refresh_token';
// Diturunkan dari API_BASE_PATH agar cookie ikut valid jika versi/prefix API
// berubah — mencegah refresh/logout diam-diam rusak karena path tak sinkron.
export const REFRESH_COOKIE_PATH = `${API_BASE_PATH}/auth`;
export const LOCKOUT_MAX = 10;
export const LOCKOUT_TTL_SECONDS = 900;
export const lockoutKey = (email: string): string => `auth:lockout:${email}`;
