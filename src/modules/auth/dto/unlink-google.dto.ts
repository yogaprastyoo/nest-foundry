import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ValidationMessage as V } from '../../../common/validation/validation-message';
import { PASSWORD_MAX_LENGTH } from '../password.constants';

export class UnlinkGoogleDto {
  @ApiProperty({
    description: 'Current local password',
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsNotEmpty({ message: V.required('Password') })
  @IsString({ message: V.string('Password') })
  @MaxLength(PASSWORD_MAX_LENGTH, {
    message: V.max('Password', PASSWORD_MAX_LENGTH),
  })
  password!: string;

  @ApiProperty({
    description:
      'One-time Google reauthentication code from the reauth callback',
  })
  @IsNotEmpty({ message: V.required('Google reauthentication code') })
  @IsString({ message: V.string('Google reauthentication code') })
  @MaxLength(256, {
    message: V.max('Google reauthentication code', 256),
  })
  googleReauthCode!: string;
}
