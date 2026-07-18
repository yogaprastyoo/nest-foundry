import { buildDefaultAvatarUrl, resolveAvatarUrl } from './avatar.util';

describe('avatar.util', () => {
  it('builds a ui-avatars URL from the name, URL-encoding it', () => {
    const url = buildDefaultAvatarUrl('Test User');
    expect(url).toContain('https://ui-avatars.com/api/');
    expect(url).toContain('name=Test+User');
    expect(url).toContain('size=256');
  });

  it('encodes names with special characters safely', () => {
    const url = buildDefaultAvatarUrl('Aña & Co');
    expect(url).not.toContain(' ');
    expect(url).toContain('%26'); // & encoded, cannot inject extra params
  });

  it('resolveAvatarUrl prefers an explicit avatar', () => {
    expect(
      resolveAvatarUrl({
        name: 'Test User',
        avatarUrl: 'https://cdn.test/a.png',
      }),
    ).toBe('https://cdn.test/a.png');
  });

  it('resolveAvatarUrl falls back to the generated avatar when none is set', () => {
    expect(resolveAvatarUrl({ name: 'Test User', avatarUrl: null })).toContain(
      'ui-avatars.com',
    );
  });
});
