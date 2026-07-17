import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NormalizeEmail } from '../../../common/transforms/normalize-email.transform';
import { ValidationMessage as V } from '../../../common/validation/validation-message';

// Field order (name → email → password) also drives error-message order, since
// class-validator validates in property-declaration order.
export class RegisterDto {
  @ApiProperty({
    description: 'User full name',
    example: 'John Doe',
    maxLength: 100,
  })
  @IsNotEmpty({ message: V.required('Name') })
  @MaxLength(100, { message: V.max('Name', 100) })
  name!: string;

  @ApiProperty({
    description: 'User email',
    example: 'user@example.com',
  })
  @NormalizeEmail()
  @IsNotEmpty({ message: V.required('Email') })
  @IsEmail({}, { message: V.email('Email') })
  email!: string;

  @ApiProperty({
    description: 'User password (min 8 characters)',
    example: 'Password123!',
    minLength: 8,
    maxLength: 128,
  })
  @IsNotEmpty({ message: V.required('Password') })
  @IsString({ message: V.string('Password') })
  @MinLength(8, { message: V.min('Password', 8) })
  @MaxLength(128, { message: V.max('Password', 128) })
  password!: string;
}
