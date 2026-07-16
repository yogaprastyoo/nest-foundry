import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Email pengguna',
    example: 'user@example.com',
  })
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
