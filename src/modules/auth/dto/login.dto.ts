import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { NormalizeEmail } from '../../../common/transforms/normalize-email.transform';
import { ValidationMessage as V } from '../../../common/validation/validation-message';

export class LoginDto {
  @ApiProperty({
    description: 'User email',
    example: 'user@example.com',
  })
  @NormalizeEmail()
  @IsNotEmpty({ message: V.required('Email') })
  @IsEmail({}, { message: V.email('Email') })
  email!: string;

  @ApiProperty({
    description: 'User password',
    example: 'Password123!',
  })
  @IsNotEmpty({ message: V.required('Password') })
  @IsString({ message: V.string('Password') })
  password!: string;
}
