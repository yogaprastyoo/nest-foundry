jest.mock('../../../prisma/prisma.service');

import { ExecutionContext } from '@nestjs/common';
import { GoogleReauthGuard } from './google-reauth.guard';
import { GoogleOAuthService } from '../google-oauth.service';

function mockContext() {
  const req = { query: {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('GoogleReauthGuard', () => {
  it('points the OAuth callback at the reauth route, not the sign-in route', () => {
    const guard = new GoogleReauthGuard({} as unknown as GoogleOAuthService);
    const options = guard.getAuthenticateOptions(mockContext()) as {
      callbackURL?: string;
    };
    expect(options.callbackURL).toBe('/api/v1/auth/google/reauth/callback');
  });
});
