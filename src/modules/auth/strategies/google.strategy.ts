import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import { Env } from '../../../config/env.validation';
import type { GoogleProfileInput } from '../google-oauth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService<Env, true>) {
    super({
      clientID:
        config.get('GOOGLE_CLIENT_ID', { infer: true }) || 'oauth-disabled',
      clientSecret:
        config.get('GOOGLE_CLIENT_SECRET', { infer: true }) || 'oauth-disabled',
      callbackURL:
        config.get('GOOGLE_CALLBACK_URL', { infer: true }) ||
        'http://localhost/oauth-disabled',
      scope: ['openid', 'profile', 'email'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): GoogleProfileInput {
    const email = profile.emails?.[0];
    return {
      googleId: profile.id,
      email: email?.value ?? '',
      emailVerified: email?.verified === true,
      name: profile.displayName,
      avatarUrl: profile.photos?.[0]?.value ?? null,
    };
  }
}
