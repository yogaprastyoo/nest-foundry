import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ForgotPasswordDto } from './forgot-password.dto';
import { ResetPasswordDto } from './reset-password.dto';
import { ChangePasswordDto } from './change-password.dto';
import { SetPasswordDto } from './set-password.dto';
import { UnlinkGoogleDto } from './unlink-google.dto';
import { GoogleReauthQueryDto } from './google-reauth-query.dto';

describe('password DTOs', () => {
  it('normalizes email in ForgotPasswordDto', () => {
    const dto = plainToInstance(ForgotPasswordDto, {
      email: '  USER@Example.test  ',
    });
    expect(dto.email).toBe('user@example.test');
  });

  it('rejects a short new password', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      token: 'token',
      newPassword: 'short',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'newPassword')).toBe(true);
  });

  it('rejects a short set-password value', async () => {
    const dto = plainToInstance(SetPasswordDto, {
      newPassword: 'short',
      googleReauthCode: 'code',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'newPassword')).toBe(true);
  });

  it('requires current and new password in ChangePasswordDto', async () => {
    const dto = plainToInstance(ChangePasswordDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'currentPassword')).toBe(true);
    expect(errors.some((e) => e.property === 'newPassword')).toBe(true);
  });

  it('requires password and reauth code in UnlinkGoogleDto', async () => {
    const dto = plainToInstance(UnlinkGoogleDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
    expect(errors.some((e) => e.property === 'googleReauthCode')).toBe(true);
  });

  it('accepts a valid reauth purpose and rejects an invalid one', async () => {
    const valid = plainToInstance(GoogleReauthQueryDto, {
      purpose: 'set_password',
    });
    expect((await validate(valid)).length).toBe(0);

    const invalid = plainToInstance(GoogleReauthQueryDto, {
      purpose: 'delete_account',
    });
    expect((await validate(invalid)).length).toBeGreaterThan(0);
  });
});
