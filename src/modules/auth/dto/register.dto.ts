import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    description: 'Email pengguna',
    example: 'user@example.com',
  })
  @IsEmail({}, { message: 'Format email tidak valid.' })
  email!: string;

  @ApiProperty({
    description: 'Password pengguna (minimal 8 karakter)',
    example: 'Password123!',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8, { message: 'Password minimal 8 karakter.' })
  @MaxLength(128, { message: 'Password maksimal 128 karakter.' })
  password!: string;

  @ApiProperty({
    description: 'Nama lengkap pengguna',
    example: 'John Doe',
    maxLength: 100,
  })
  @IsNotEmpty({ message: 'Nama wajib diisi.' })
  @MaxLength(100, { message: 'Nama maksimal 100 karakter.' })
  name!: string;
}
