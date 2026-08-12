import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import * as express from 'express';
import { REFRESH_COOKIE } from '../auth.constants';

export const extractRefreshTokenFromContext = (
  ctx: ExecutionContext,
): string => {
  const req = ctx.switchToHttp().getRequest<express.Request>();
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[
    REFRESH_COOKIE
  ];
  const fromBody = (req.body as { refresh_token?: string } | undefined)
    ?.refresh_token;
  const token = fromCookie ?? fromBody;
  if (!token) throw new BadRequestException('Refresh token not found.');
  return token;
};

export const RefreshToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    return extractRefreshTokenFromContext(ctx);
  },
);
