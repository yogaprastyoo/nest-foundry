import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../../generated/prisma/client';
import { AuthService } from './auth.service';
import { GoogleExchangeDto } from './dto/google-exchange.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { GoogleOAuthGuard } from './guards/google-oauth.guard';
import { GoogleReauthGuard } from './guards/google-reauth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';
import type {
  GoogleProfileInput,
  GoogleReauthState,
} from './google-oauth.service';
import { GoogleOAuthService } from './google-oauth.service';
import { VerificationService } from './verification.service';
import { PasswordService } from './password.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { UnlinkGoogleDto } from './dto/unlink-google.dto';
import { GoogleReauthQueryDto } from './dto/google-reauth-query.dto';
import { RefreshToken } from './decorators/refresh-token.decorator';
import { SetRefreshCookie } from './interceptors/set-refresh-cookie.interceptor';
import { ClearRefreshCookie } from './interceptors/clear-refresh-cookie.interceptor';

type GoogleCallbackRequest = express.Request & {
  googleOAuthFailed?: boolean;
  user?: GoogleProfileInput;
};

type GoogleReauthCallbackRequest = express.Request & {
  googleReauthFailed?: boolean;
  googleReauthBinding?: GoogleReauthState;
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
    private readonly password: PasswordService,
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
      this.redirectOAuthFailure(res);
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
      this.redirectOAuthFailure(res);
    }
  }

  @Public()
  @Post('google/exchange')
  @HttpCode(HttpStatus.OK)
  @SetRefreshCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange a one-time Google sign-in code' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid Google sign-in code' })
  @ResponseMessage('Login successful.')
  async googleExchange(@Body() dto: GoogleExchangeDto) {
    const userId = await this.googleOAuth.consumeExchangeCode(dto.code);
    if (!userId) {
      throw new UnauthorizedException('Unable to complete Google sign-in.');
    }
    const user = await this.auth.findUserForGoogleExchange(userId);
    if (!user) {
      throw new UnauthorizedException('Unable to complete Google sign-in.');
    }
    return this.auth.login(user);
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
  @SetRefreshCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  @ApiResponse({ status: 403, description: 'Email not verified' })
  @ApiResponse({ status: 429, description: 'Too many login attempts' })
  @ResponseMessage('Login successful.')
  async login(@Body() _dto: LoginDto, @Req() req: express.Request) {
    return this.auth.login(req.user as User);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @SetRefreshCookie()
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
  async refresh(@RefreshToken() token: string) {
    return this.auth.refresh(token);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ClearRefreshCookie()
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
  async logout(@RefreshToken() token: string): Promise<null> {
    await (this.auth as unknown as { logout(t: string): Promise<void> }).logout(
      token,
    );
    return null;
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request password reset email' })
  @ApiResponse({
    status: 200,
    description: 'If the email is registered, a reset link has been sent',
  })
  @ResponseMessage(
    'If an account with that email exists, password reset instructions have been sent.',
  )
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<null> {
    await this.password.requestReset(dto.email);
    return null;
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reset password using token' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  @ResponseMessage(
    'Password reset successful. Please log in with your new password.',
  )
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<null> {
    await this.password.resetPassword(dto);
    return null;
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ClearRefreshCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Change the password with the current password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 400, description: 'Current password is incorrect' })
  @ResponseMessage('Password changed successfully. Please sign in again.')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: { id: string },
  ): Promise<null> {
    await this.password.changePassword({ ...dto, userId: user.id });
    return null;
  }

  @Get('google/reauth')
  @UseGuards(GoogleReauthGuard)
  @ApiOperation({
    summary: 'Start Google reauthentication for a sensitive action',
  })
  googleReauth(@Query() query: GoogleReauthQueryDto): GoogleReauthQueryDto {
    return query;
  }

  @Public()
  @Get('google/reauth/callback')
  @UseGuards(GoogleReauthGuard)
  @ApiOperation({ summary: 'Complete Google reauthentication' })
  async googleReauthCallback(
    @Req() req: GoogleReauthCallbackRequest,
    @Res() res: express.Response,
  ): Promise<void> {
    const binding = req.googleReauthBinding;
    const purpose = binding?.purpose;
    if (req.googleReauthFailed || !req.user || !binding || !purpose) {
      this.redirectOAuthFailure(res);
      return;
    }

    try {
      const userId = binding.userId;
      if (!req.user.emailVerified || req.user.googleId === null) {
        throw new Error('reauth_failed');
      }
      const account = await this.auth.findUserForGoogleExchange(userId);
      if (!account || account.googleId !== req.user.googleId) {
        throw new Error('reauth_failed');
      }
      const code = await this.googleOAuth.createReauthCode({
        userId,
        purpose,
      });
      const redirect = new URL(
        this.config.get('GOOGLE_FRONTEND_CALLBACK_URL', { infer: true }),
      );
      redirect.searchParams.set('code', code);
      redirect.searchParams.set('purpose', purpose);
      res.redirect(redirect.toString());
    } catch {
      this.redirectOAuthFailure(res);
    }
  }

  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  @ClearRefreshCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Set a password for a Google-only account' })
  @ApiResponse({ status: 200, description: 'Password set successfully' })
  @ApiResponse({
    status: 403,
    description: 'Google reauthentication is required',
  })
  @ResponseMessage('Password set successfully. Please sign in again.')
  async setPassword(
    @Body() dto: SetPasswordDto,
    @CurrentUser() user: { id: string },
  ): Promise<null> {
    await this.password.setPassword({ ...dto, userId: user.id });
    return null;
  }

  @Post('unlink-google')
  @HttpCode(HttpStatus.OK)
  @ClearRefreshCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Unlink the Google identity from the account' })
  @ApiResponse({
    status: 200,
    description: 'Google account unlinked successfully',
  })
  @ApiResponse({ status: 400, description: 'Current password is incorrect' })
  @ResponseMessage(
    'Google account unlinked successfully. Please sign in again.',
  )
  async unlinkGoogle(
    @Body() dto: UnlinkGoogleDto,
    @CurrentUser() user: { id: string },
  ): Promise<null> {
    await this.password.unlinkGoogle({ ...dto, userId: user.id });
    return null;
  }

  private redirectOAuthFailure(res: express.Response): void {
    const redirect = new URL(
      this.config.get('GOOGLE_FRONTEND_CALLBACK_URL', { infer: true }),
    );
    redirect.searchParams.set('error', 'oauth_failed');
    res.redirect(redirect.toString());
  }
}
