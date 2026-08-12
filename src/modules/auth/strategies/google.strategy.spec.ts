import { GoogleStrategy } from './google.strategy';

const config = {
  get: jest.fn(
    (key: string) =>
      ({
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
        GOOGLE_CALLBACK_URL:
          'http://localhost:3000/api/v1/auth/google/callback',
      })[key],
  ),
} as never;

describe('GoogleStrategy', () => {
  it('maps a verified Google email and profile picture', () => {
    const strategy = new GoogleStrategy(config);

    expect(
      strategy.validate('', '', {
        id: 'google-1',
        displayName: 'Google User',
        emails: [{ value: 'user@example.test', verified: true }],
        photos: [{ value: 'https://lh3.googleusercontent.com/a/photo.jpg' }],
      } as never),
    ).toEqual({
      googleId: 'google-1',
      email: 'user@example.test',
      emailVerified: true,
      name: 'Google User',
      avatarUrl: 'https://lh3.googleusercontent.com/a/photo.jpg',
    });
  });

  it('fails closed when Google does not assert an email as verified', () => {
    const strategy = new GoogleStrategy(config);

    expect(
      strategy.validate('', '', {
        id: 'google-1',
        displayName: 'Google User',
        emails: [{ value: 'user@example.test', verified: false }],
      } as never),
    ).toMatchObject({ emailVerified: false });
  });
});
