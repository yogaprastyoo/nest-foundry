import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Format email tidak valid.' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'Password minimal 8 karakter.' })
  @MaxLength(128, { message: 'Password maksimal 128 karakter.' })
  password!: string;

  @IsNotEmpty({ message: 'Nama wajib diisi.' })
  @MaxLength(100, { message: 'Nama maksimal 100 karakter.' })
  name!: string;
}
