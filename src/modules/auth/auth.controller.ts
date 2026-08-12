import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as express from 'express';
import { Env } from '../../config/env.validation';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { User } from '../../generated/prisma/client';
import { AuthService } from './auth.service';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './auth.constants';
import { GoogleExchangeDto } from './dto/google-exchange.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { GoogleOAuthGuard } from './guards/google-oauth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';
import type { GoogleProfileInput } from './google-oauth.service';
import { GoogleOAuthService } from './google-oauth.service';
import { VerificationService } from './verification.service';

type GoogleCallbackRequest = express.Request & {
  googleOAuthFailed?: boolean;
  user?: GoogleProfileInput;
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly verification: VerificationService,
    private readonly googleOAuth: GoogleOAuthService,
  ) {}

  @Public()
  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({ summary: 'Start Google sign-in' })
  google(): void {}

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({ summary: 'Complete Google sign-in' })
  async googleCallback(
    @Req() req: GoogleCallbackRequest,
    @Res() res: express.Response,
  ): Promise<void> {
    if (req.googleOAuthFailed || !req.user) {
      this.redirectGoogleFailure(res);
      return;
    }

    try {
      const user = await this.googleOAuth.resolveGoogleUser(req.user);
      const code = await this.googleOAuth.createExchangeCode(user.id);
      const redirect = new URL(
        this.config.get('GOOGLE_FRONTEND_CALLBACK_URL', { infer: true }),
      );
      redirect.searchParams.set('code', code);
      res.redirect(redirect.toString());
    } catch {
      this.redirectGoogleFailure(res);
    }
  }

  @Public()
  @Post('google/exchange')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange a one-time Google sign-in code' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid Google sign-in code' })
  @ResponseMessage('Login successful.')
  async googleExchange(
    @Body() dto: GoogleExchangeDto,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const userId = await this.googleOAuth.consumeExchangeCode(dto.code);
    if (!userId) {
      throw new UnauthorizedException('Unable to complete Google sign-in.');
    }
    const user = await this.auth.findUserForGoogleExchange(userId);
    if (!user) {
      throw new UnauthorizedException('Unable to complete Google sign-in.');
    }
    const payload = await this.auth.login(user);
    this.setRefreshCookie(res, payload.refresh_token);
    return payload;
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    status: 201,
    description: 'Registration successful',
    type: RegisterResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  @ResponseMessage('Registration successful.')
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    return this.auth.register(dto);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify an email address with a token' })
  @ApiResponse({ status: 200, description: 'Email verified' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  @ResponseMessage('Email verified successfully.')
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<null> {
    await this.verification.verifyEmail(dto.token);
    return null;
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Resend the email verification link' })
  @ApiResponse({
    status: 200,
    description: 'Verification email sent if the account is eligible',
  })
  @ResponseMessage(
    'If the email is registered, a verification link has been sent.',
  )
  async resendVerification(@Body() dto: ResendVerificationDto): Promise<null> {
    await this.verification.resendVerification(dto.email);
    return null;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  @ApiResponse({ status: 403, description: 'Email not verified' })
  @ApiResponse({ status: 429, description: 'Too many login attempts' })
  @ResponseMessage('Login successful.')
  async login(
    @Body() dto: LoginDto,
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
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        refresh_token: {
          type: 'string',
          description: 'Refresh token (optional if already sent via cookie)',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  @ResponseMessage('Token refreshed successfully.')
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
  @ApiOperation({ summary: 'Log out and revoke the refresh token' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        refresh_token: {
          type: 'string',
          description: 'Refresh token (optional if already sent via cookie)',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Logout successful' })
  @ResponseMessage('Logout successful.')
  async logout(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ): Promise<null> {
    await this.auth.logout(this.extractRefreshToken(req));
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return null;
  }

  private redirectGoogleFailure(res: express.Response): void {
    const redirect = new URL(
      this.config.get('GOOGLE_FRONTEND_CALLBACK_URL', { infer: true }),
    );
    redirect.searchParams.set('error', 'oauth_failed');
    res.redirect(redirect.toString());
  }

  private extractRefreshToken(req: express.Request): string {
    const fromCookie = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    const fromBody = (req.body as { refresh_token?: string } | undefined)
      ?.refresh_token;
    const token = fromCookie ?? fromBody;
    if (!token) throw new BadRequestException('Refresh token not found.');
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
