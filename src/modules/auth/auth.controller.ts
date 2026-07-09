import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import * as express from 'express';
import { Env } from '../../config/env.validation';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './auth.constants';
import type { User } from '../../generated/prisma/client';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ResponseMessage('Registrasi berhasil.')
  async register(@Body() dto: RegisterDto): Promise<null> {
    await this.auth.register(dto);
    return null;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ResponseMessage('Login berhasil.')
  async login(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const payload = await this.auth.login(req.user as User);
    this.setRefreshCookie(res, payload.refresh_token);
    return payload;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ResponseMessage('Token berhasil diperbarui.')
  async refresh(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const payload = await this.auth.refresh(this.extractRefreshToken(req));
    this.setRefreshCookie(res, payload.refresh_token);
    return payload;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Logout berhasil.')
  async logout(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ): Promise<null> {
    await this.auth.logout(this.extractRefreshToken(req));
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return null;
  }

  private extractRefreshToken(req: express.Request): string {
    const fromCookie = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    const fromBody = (req.body as { refresh_token?: string } | undefined)
      ?.refresh_token;
    const token = fromCookie ?? fromBody;
    if (!token) throw new BadRequestException('Refresh token tidak ditemukan.');
    return token;
  }

  private setRefreshCookie(res: express.Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: this.config.get('JWT_REFRESH_TTL', { infer: true }) * 1000,
    });
  }
}
