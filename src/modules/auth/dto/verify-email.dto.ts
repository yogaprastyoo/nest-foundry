import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ValidationMessage as V } from '../../../common/validation/validation-message';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Verification token from the email link' })
  @IsNotEmpty({ message: V.required('Token') })
  @IsString({ message: V.string('Token') })
  @MaxLength(200, { message: V.max('Token', 200) })
  token!: string;
}
