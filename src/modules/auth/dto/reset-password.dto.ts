import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ValidationMessage as V } from '../../../common/validation/validation-message';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../password.constants';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Password reset token from the email link' })
  @IsNotEmpty({ message: V.required('Token') })
  @IsString({ message: V.string('Token') })
  @MaxLength(256, { message: V.max('Token', 256) })
  token!: string;

  @ApiProperty({
    description: 'New password',
    example: 'Password123!',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsNotEmpty({ message: V.required('New password') })
  @IsString({ message: V.string('New password') })
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: V.min('New password', PASSWORD_MIN_LENGTH),
  })
  @MaxLength(PASSWORD_MAX_LENGTH, {
    message: V.max('New password', PASSWORD_MAX_LENGTH),
  })
  newPassword!: string;
}
