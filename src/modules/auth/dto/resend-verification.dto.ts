import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';
import { NormalizeEmail } from '../../../common/transforms/normalize-email.transform';
import { ValidationMessage as V } from '../../../common/validation/validation-message';

export class ResendVerificationDto {
  @ApiProperty({
    description: 'Email to resend the verification link to',
    example: 'user@example.com',
  })
  @NormalizeEmail()
  @IsNotEmpty({ message: V.required('Email') })
  @IsEmail({}, { message: V.email('Email') })
  email!: string;
}
