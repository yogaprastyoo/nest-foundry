import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { GoogleOAuthService } from '../google-oauth.service';
import type { GoogleReauthState } from '../google-oauth.service';
import { GOOGLE_REAUTH_PURPOSES } from '../password.constants';

interface GoogleReauthRequest extends Request {
  googleReauthState?: string;
  googleReauthFailed?: boolean;
  googleReauthBinding?: GoogleReauthState;
  user?: { id?: string };
}

@Injectable()
export class GoogleReauthGuard extends AuthGuard('google') {
  constructor(private readonly googleOAuth: GoogleOAuthService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GoogleReauthRequest>();
    const code = request.query.code;
    const error = request.query.error;

    if (typeof error === 'string') {
      request.googleReauthFailed = true;
      return true;
    }

    if (typeof code === 'string') {
      const state = request.query.state;
      if (typeof state !== 'string') {
        request.googleReauthFailed = true;
        return true;
      }
      const binding = await this.googleOAuth.consumeReauthState(state);
      if (!binding) {
        request.googleReauthFailed = true;
        return true;
      }
      request.googleReauthBinding = binding;
    } else {
      // Initiation: JwtAuthGuard (global) runs first, so the authenticated
      // user is already on the request. Bind the proof to that user + purpose.
      const userId = request.user?.id;
      const purpose = request.query.purpose;
      if (
        !userId ||
        typeof purpose !== 'string' ||
        !GOOGLE_REAUTH_PURPOSES.includes(purpose as never)
      ) {
        request.googleReauthFailed = true;
        return true;
      }
      request.googleReauthState = await this.googleOAuth.createReauthState({
        userId,
        purpose: purpose as GoogleReauthState['purpose'],
      });
    }

    return (await super.canActivate(context)) as boolean;
  }

  getAuthenticateOptions(context: ExecutionContext): { state?: string } {
    const request = context.switchToHttp().getRequest<GoogleReauthRequest>();
    return { state: request.googleReauthState };
  }
}
