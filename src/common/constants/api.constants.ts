/**
 * Sumber kebenaran tunggal untuk prefix & versi URL API.
 * Dipakai di bootstrap (main.ts) sekaligus untuk menurunkan path lain yang
 * harus ikut berubah bila versi/prefix berubah (mis. path cookie refresh),
 * sehingga tidak ada string '/api/v1/...' yang di-hardcode terpisah.
 */
export const API_PREFIX = 'api';
export const API_VERSION = '1';

/** Basis path lengkap: `/api/v1`. */
export const API_BASE_PATH = `/${API_PREFIX}/v${API_VERSION}`;
