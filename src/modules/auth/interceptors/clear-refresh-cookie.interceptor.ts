import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import * as express from 'express';
import { Observable, tap } from 'rxjs';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from '../auth.constants';

@Injectable()
export class ClearRefreshCookieInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<express.Response>();
    return next.handle().pipe(
      tap(() => {
        res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
      }),
    );
  }
}

export const ClearRefreshCookie = () =>
  UseInterceptors(ClearRefreshCookieInterceptor);
