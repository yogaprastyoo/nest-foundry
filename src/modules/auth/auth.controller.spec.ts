jest.mock('../../prisma/prisma.service');

import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import type { User } from '../../generated/prisma/client';

describe('AuthController', () => {
  const authService = {
    register: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    findUserForGoogleExchange: jest.fn(),
  };

  const configService = {
    get: jest.fn((key: string) =>
      key === 'GOOGLE_FRONTEND_CALLBACK_URL'
        ? 'https://app.test/oauth/callback'
        : undefined,
    ),
  };

  const verificationService = {
    verifyEmail: jest.fn(),
    resendVerification: jest.fn(),
  };

  const googleOAuthService = {
    resolveGoogleUser: jest.fn(),
    createExchangeCode: jest.fn(),
    consumeExchangeCode: jest.fn(),
    createReauthCode: jest.fn(),
  };

  const passwordService = {
    requestReset: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
    setPassword: jest.fn(),
    unlinkGoogle: jest.fn(),
  };

  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController(
      authService as never,
      configService as never,
      verificationService as never,
      googleOAuthService as never,
      passwordService as never,
    );
  });

  describe('google', () => {
    it('is a no-op endpoint for Guard initiation', () => {
      expect(() => controller.google()).not.toThrow();
    });
  });

  describe('googleCallback', () => {
    it('redirects with error parameter if OAuth failed', async () => {
      const res = { redirect: jest.fn() };
      await controller.googleCallback(
        { googleOAuthFailed: true } as never,
        res as never,
      );
      expect(res.redirect).toHaveBeenCalledWith(
        'https://app.test/oauth/callback?error=oauth_failed',
      );
    });

    it('resolves user and redirects with exchange code on success', async () => {
      const googleUser = {
        googleId: 'g1',
        email: 'user@example.test',
        emailVerified: true,
        name: 'User',
        avatarUrl: null,
      };
      googleOAuthService.resolveGoogleUser.mockResolvedValue({ id: 'u1' });
      googleOAuthService.createExchangeCode.mockResolvedValue('ex-code');

      const res = { redirect: jest.fn() };
      await controller.googleCallback(
        { user: googleUser } as never,
        res as never,
      );

      expect(googleOAuthService.resolveGoogleUser).toHaveBeenCalledWith(
        googleUser,
      );
      expect(googleOAuthService.createExchangeCode).toHaveBeenCalledWith('u1');
      expect(res.redirect).toHaveBeenCalledWith(
        'https://app.test/oauth/callback?code=ex-code',
      );
    });

    it('redirects with error parameter on thrown exception', async () => {
      googleOAuthService.resolveGoogleUser.mockRejectedValue(new Error('fail'));
      const res = { redirect: jest.fn() };
      await controller.googleCallback(
        { user: { googleId: 'g1' } } as never,
        res as never,
      );
      expect(res.redirect).toHaveBeenCalledWith(
        'https://app.test/oauth/callback?error=oauth_failed',
      );
    });
  });

  describe('googleExchange', () => {
    it('throws 401 if exchange code is invalid', async () => {
      googleOAuthService.consumeExchangeCode.mockResolvedValue(null);
      await expect(controller.googleExchange({ code: 'bad' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws 401 if target user does not exist', async () => {
      googleOAuthService.consumeExchangeCode.mockResolvedValue('u1');
      authService.findUserForGoogleExchange.mockResolvedValue(null);
      await expect(
        controller.googleExchange({ code: 'valid' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns login tokens for valid exchange code', async () => {
      googleOAuthService.consumeExchangeCode.mockResolvedValue('u1');
      authService.findUserForGoogleExchange.mockResolvedValue({ id: 'u1' });
      const tokens = { access_token: 'acc', refresh_token: 'ref' };
      authService.login.mockResolvedValue(tokens);

      await expect(
        controller.googleExchange({ code: 'valid' }),
      ).resolves.toEqual(tokens);
    });
  });

  describe('register', () => {
    it('delegates registration to authService', async () => {
      const dto = {
        email: 'user@example.test',
        password: 'password123',
        name: 'User',
      };
      const response = { id: 'u1', email: dto.email, name: dto.name };
      authService.register.mockResolvedValue(response);

      await expect(controller.register(dto)).resolves.toEqual(response);
      expect(authService.register).toHaveBeenCalledWith(dto);
    });
  });

  describe('verifyEmail', () => {
    it('delegates token verification to verificationService', async () => {
      verificationService.verifyEmail.mockResolvedValue(undefined);
      await expect(
        controller.verifyEmail({ token: 'tok' }),
      ).resolves.toBeNull();
      expect(verificationService.verifyEmail).toHaveBeenCalledWith('tok');
    });
  });

  describe('resendVerification', () => {
    it('delegates resend to verificationService', async () => {
      verificationService.resendVerification.mockResolvedValue(undefined);
      await expect(
        controller.resendVerification({ email: 'user@example.test' }),
      ).resolves.toBeNull();
      expect(verificationService.resendVerification).toHaveBeenCalledWith(
        'user@example.test',
      );
    });
  });

  describe('login', () => {
    it('logs in user attached to request', async () => {
      const user = { id: 'u1', email: 'user@example.test' } as User;
      const tokens = { access_token: 'acc', refresh_token: 'ref' };
      authService.login.mockResolvedValue(tokens);

      await expect(
        controller.login({ email: user.email, password: 'pw' }, {
          user,
        } as never),
      ).resolves.toEqual(tokens);
      expect(authService.login).toHaveBeenCalledWith(user);
    });
  });

  describe('refresh', () => {
    it('delegates token refresh to authService', async () => {
      const tokens = { access_token: 'new-acc', refresh_token: 'new-ref' };
      authService.refresh.mockResolvedValue(tokens);

      await expect(controller.refresh('ref-token')).resolves.toEqual(tokens);
      expect(authService.refresh).toHaveBeenCalledWith('ref-token');
    });
  });

  describe('logout', () => {
    it('delegates logout to authService', async () => {
      authService.logout.mockResolvedValue(undefined);
      await expect(controller.logout('ref-token')).resolves.toBeNull();
      expect(authService.logout).toHaveBeenCalledWith('ref-token');
    });
  });

  describe('forgotPassword', () => {
    it('delegates request reset to passwordService', async () => {
      passwordService.requestReset.mockResolvedValue(undefined);
      await expect(
        controller.forgotPassword({ email: 'user@example.test' }),
      ).resolves.toBeNull();
      expect(passwordService.requestReset).toHaveBeenCalledWith(
        'user@example.test',
      );
    });
  });

  describe('resetPassword', () => {
    it('delegates reset password to passwordService', async () => {
      const dto = { token: 't1', newPassword: 'NewPassword123!' };
      passwordService.resetPassword.mockResolvedValue(undefined);
      await expect(controller.resetPassword(dto)).resolves.toBeNull();
      expect(passwordService.resetPassword).toHaveBeenCalledWith(dto);
    });
  });

  describe('changePassword', () => {
    it('attaches current user id and delegates to passwordService', async () => {
      const dto = {
        currentPassword: 'OldPassword123!',
        newPassword: 'NewPassword123!',
      };
      passwordService.changePassword.mockResolvedValue(undefined);
      await expect(
        controller.changePassword(dto, { id: 'u1' }),
      ).resolves.toBeNull();
      expect(passwordService.changePassword).toHaveBeenCalledWith({
        ...dto,
        userId: 'u1',
      });
    });
  });

  describe('googleReauth', () => {
    it('returns query parameters verbatim', () => {
      const query = { purpose: 'set_password' as const };
      expect(controller.googleReauth(query)).toEqual(query);
    });
  });

  describe('googleReauthCallback', () => {
    it('redirects with error if reauth failed or binding missing', async () => {
      const res = { redirect: jest.fn() };
      await controller.googleReauthCallback(
        { googleReauthFailed: true } as never,
        res as never,
      );
      expect(res.redirect).toHaveBeenCalledWith(
        'https://app.test/oauth/callback?error=oauth_failed',
      );
    });

    it('creates reauth code and redirects with code and purpose on success', async () => {
      const req = {
        user: { emailVerified: true, googleId: 'g1' },
        googleReauthBinding: { userId: 'u1', purpose: 'set_password' },
      };
      authService.findUserForGoogleExchange.mockResolvedValue({
        id: 'u1',
        googleId: 'g1',
      });
      googleOAuthService.createReauthCode.mockResolvedValue('reauth-code');
      const res = { redirect: jest.fn() };

      await controller.googleReauthCallback(req as never, res as never);

      expect(googleOAuthService.createReauthCode).toHaveBeenCalledWith({
        userId: 'u1',
        purpose: 'set_password',
      });
      expect(res.redirect).toHaveBeenCalledWith(
        'https://app.test/oauth/callback?code=reauth-code&purpose=set_password',
      );
    });
  });

  describe('setPassword', () => {
    it('attaches current user id and delegates setPassword to passwordService', async () => {
      const dto = {
        newPassword: 'NewPassword123!',
        googleReauthCode: 'rcode',
      };
      passwordService.setPassword.mockResolvedValue(undefined);

      await expect(
        controller.setPassword(dto, { id: 'u1' }),
      ).resolves.toBeNull();
      expect(passwordService.setPassword).toHaveBeenCalledWith({
        ...dto,
        userId: 'u1',
      });
    });
  });

  describe('unlinkGoogle', () => {
    it('attaches current user id and delegates unlinkGoogle to passwordService', async () => {
      const dto = {
        password: 'Password123!',
        googleReauthCode: 'rcode',
      };
      passwordService.unlinkGoogle.mockResolvedValue(undefined);

      await expect(
        controller.unlinkGoogle(dto, { id: 'u1' }),
      ).resolves.toBeNull();
      expect(passwordService.unlinkGoogle).toHaveBeenCalledWith({
        ...dto,
        userId: 'u1',
      });
    });
  });
});
