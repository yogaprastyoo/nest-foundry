// Single source of truth for the API URL prefix & version, so paths that must
// track them (e.g. the refresh cookie path) never hardcode '/api/v1' separately.
export const API_PREFIX = 'api';
export const API_VERSION = '1';
export const API_BASE_PATH = `/${API_PREFIX}/v${API_VERSION}`;
