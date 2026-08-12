import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ClearRefreshCookieInterceptor } from './clear-refresh-cookie.interceptor';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from '../auth.constants';

describe('ClearRefreshCookieInterceptor', () => {
  const interceptor = new ClearRefreshCookieInterceptor();

  it('clears refresh token cookie on response', (done) => {
    const clearCookieMock = jest.fn();
    const ctx = {
      switchToHttp: () => ({
        getResponse: () => ({ clearCookie: clearCookieMock }),
      }),
    } as unknown as ExecutionContext;

    const next: CallHandler = {
      handle: () => of(null),
    };

    interceptor.intercept(ctx, next).subscribe({
      next: () => {
        expect(clearCookieMock).toHaveBeenCalledWith(REFRESH_COOKIE, {
          path: REFRESH_COOKIE_PATH,
        });
        done();
      },
    });
  });
});
