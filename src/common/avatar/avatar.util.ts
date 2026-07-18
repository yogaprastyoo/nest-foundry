const UI_AVATARS_ENDPOINT = 'https://ui-avatars.com/api/';

/**
 * Fallback avatar generated from the user's name (initials), used when the user
 * has no explicit avatar. Derived on read rather than stored, so it always
 * follows the current name instead of going stale after a rename.
 */
export function buildDefaultAvatarUrl(name: string): string {
  const params = new URLSearchParams({ name, size: '256' });
  return `${UI_AVATARS_ENDPOINT}?${params.toString()}`;
}

/** The avatar to expose in API responses: the explicit one, or the generated fallback. */
export function resolveAvatarUrl(user: {
  name: string;
  avatarUrl: string | null;
}): string {
  return user.avatarUrl ?? buildDefaultAvatarUrl(user.name);
}
