import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import { Observable, tap } from 'rxjs';
import { Env } from '../../../config/env.validation';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from '../auth.constants';

@Injectable()
export class SetRefreshCookieInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService<Env, true>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<express.Response>();
    return next.handle().pipe(
      tap((data: unknown) => {
        if (
          data &&
          typeof data === 'object' &&
          'refresh_token' in data &&
          typeof (data as Record<string, unknown>).refresh_token === 'string'
        ) {
          const refreshToken = (data as Record<string, string>).refresh_token;
          res.cookie(REFRESH_COOKIE, refreshToken, {
            httpOnly: true,
            secure:
              this.config.get('NODE_ENV', { infer: true }) === 'production',
            sameSite: 'lax',
            path: REFRESH_COOKIE_PATH,
            maxAge: this.config.get('JWT_REFRESH_TTL', { infer: true }) * 1000,
          });
        }
      }),
    );
  }
}

export const SetRefreshCookie = () =>
  UseInterceptors(SetRefreshCookieInterceptor);
