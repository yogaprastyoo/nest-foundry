import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { NormalizeEmail } from '../../../common/transforms/normalize-email.transform';

export class LoginDto {
  @ApiProperty({
    description: 'Email pengguna',
    example: 'user@example.com',
  })
  @NormalizeEmail()
  @IsEmail({}, { message: 'Format email tidak valid.' })
  email!: string;

  @ApiProperty({
    description: 'Password pengguna',
    example: 'Password123!',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password wajib diisi.' })
  password!: string;
}
