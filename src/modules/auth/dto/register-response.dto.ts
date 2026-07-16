import { ApiProperty } from '@nestjs/swagger';
import type { Role } from '../../../generated/prisma/client';

/** Bentuk data user yang dikembalikan setelah registrasi berhasil (tanpa password/token). */
export class RegisterResponseDto {
  @ApiProperty({ example: '3f1c2b9a-...' })
  id!: string;

  @ApiProperty({ example: 'Budi' })
  name!: string;

  @ApiProperty({ example: 'budi@example.com' })
  email!: string;

  @ApiProperty({ example: 'USER', enum: ['USER', 'ADMIN'] })
  role!: Role;

  @ApiProperty({
    example: false,
    description:
      'true jika email sudah terverifikasi (atau verifikasi dimatikan)',
  })
  isEmailVerified!: boolean;
}
