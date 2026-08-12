import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { extractRefreshTokenFromContext } from './refresh-token.decorator';
import { REFRESH_COOKIE } from '../auth.constants';

describe('RefreshToken decorator', () => {
  function mockContext(req: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  }

  it('extracts token from cookie when present', () => {
    const ctx = mockContext({
      cookies: { [REFRESH_COOKIE]: 'cookie-token' },
      body: {},
    });
    expect(extractRefreshTokenFromContext(ctx)).toBe('cookie-token');
  });

  it('extracts token from body when cookie is missing', () => {
    const ctx = mockContext({
      cookies: {},
      body: { refresh_token: 'body-token' },
    });
    expect(extractRefreshTokenFromContext(ctx)).toBe('body-token');
  });

  it('throws BadRequestException when token is missing in both cookie and body', () => {
    const ctx = mockContext({ cookies: {}, body: {} });
    expect(() => extractRefreshTokenFromContext(ctx)).toThrow(
      BadRequestException,
    );
  });
});
