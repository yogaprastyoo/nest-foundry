import { API_BASE_PATH } from '../../common/constants/api.constants';

export const REFRESH_COOKIE = 'refresh_token';
// Derived from API_BASE_PATH so the cookie stays valid if the API version/
// prefix changes — prevents refresh/logout silently breaking on a stale path.
export const REFRESH_COOKIE_PATH = `${API_BASE_PATH}/auth`;
export const LOCKOUT_MAX = 10;
export const LOCKOUT_TTL_SECONDS = 900;
export const lockoutKey = (email: string): string => `auth:lockout:${email}`;
