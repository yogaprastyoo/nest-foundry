import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { GoogleOAuthService } from '../google-oauth.service';

interface GoogleOAuthRequest extends Request {
  googleOAuthState?: string;
  googleOAuthFailed?: boolean;
}

@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  constructor(private readonly googleOAuth: GoogleOAuthService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GoogleOAuthRequest>();
    const code = request.query.code;
    const error = request.query.error;

    if (typeof error === 'string') {
      request.googleOAuthFailed = true;
      return true;
    }

    if (typeof code === 'string') {
      const state = request.query.state;
      if (
        typeof state !== 'string' ||
        !(await this.googleOAuth.consumeState(state))
      ) {
        request.googleOAuthFailed = true;
        return true;
      }
    } else {
      request.googleOAuthState = await this.googleOAuth.createState();
    }

    return (await super.canActivate(context)) as boolean;
  }

  getAuthenticateOptions(context: ExecutionContext): { state?: string } {
    const request = context.switchToHttp().getRequest<GoogleOAuthRequest>();
    return { state: request.googleOAuthState };
  }
}
