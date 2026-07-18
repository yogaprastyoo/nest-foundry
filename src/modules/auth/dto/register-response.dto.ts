import { ApiProperty } from '@nestjs/swagger';
import type { Role } from '../../../generated/prisma/client';

/** Shape of the user data returned after a successful registration (no password/token). */
export class RegisterResponseDto {
  @ApiProperty({ example: '3f1c2b9a-...' })
  id!: string;

  @ApiProperty({ example: 'John Doe' })
  name!: string;

  @ApiProperty({ example: 'user@example.com' })
  email!: string;

  @ApiProperty({
    example: 'https://ui-avatars.com/api/?name=John+Doe&size=256',
    description:
      "The user's avatar, or a generated fallback built from their name",
  })
  avatarUrl!: string;

  @ApiProperty({ example: 'USER', enum: ['USER', 'ADMIN'] })
  role!: Role;

  @ApiProperty({
    example: false,
    description: 'true if the email is verified (or verification is disabled)',
  })
  isEmailVerified!: boolean;
}
