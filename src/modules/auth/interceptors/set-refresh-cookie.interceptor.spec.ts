import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { SetRefreshCookieInterceptor } from './set-refresh-cookie.interceptor';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from '../auth.constants';

describe('SetRefreshCookieInterceptor', () => {
  const config = {
    get: jest.fn((key: string) =>
      key === 'NODE_ENV'
        ? 'development'
        : key === 'JWT_REFRESH_TTL'
          ? 604800
          : undefined,
    ),
  };
  const interceptor = new SetRefreshCookieInterceptor(config as never);

  it('sets cookie when response data contains refresh_token', (done) => {
    const cookieMock = jest.fn();
    const ctx = {
      switchToHttp: () => ({
        getResponse: () => ({ cookie: cookieMock }),
      }),
    } as unknown as ExecutionContext;

    const next: CallHandler = {
      handle: () =>
        of({ refresh_token: 'test-refresh-token', access_token: 'acc' }),
    };

    interceptor.intercept(ctx, next).subscribe({
      next: () => {
        expect(cookieMock).toHaveBeenCalledWith(
          REFRESH_COOKIE,
          'test-refresh-token',
          {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: REFRESH_COOKIE_PATH,
            maxAge: 604800000,
          },
        );
        done();
      },
    });
  });

  it('does not set cookie when response data lacks refresh_token', (done) => {
    const cookieMock = jest.fn();
    const ctx = {
      switchToHttp: () => ({
        getResponse: () => ({ cookie: cookieMock }),
      }),
    } as unknown as ExecutionContext;

    const next: CallHandler = {
      handle: () => of({ success: true }),
    };

    interceptor.intercept(ctx, next).subscribe({
      next: () => {
        expect(cookieMock).not.toHaveBeenCalled();
        done();
      },
    });
  });
});
