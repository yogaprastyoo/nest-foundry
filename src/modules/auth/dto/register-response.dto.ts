import { ApiProperty } from '@nestjs/swagger';
import type { Role } from '../../../generated/prisma/client';

/** Shape of the user data returned after a successful registration (no password/token). */
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
    description: 'true if the email is verified (or verification is disabled)',
  })
  isEmailVerified!: boolean;
}
