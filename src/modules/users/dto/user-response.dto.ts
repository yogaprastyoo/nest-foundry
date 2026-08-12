import { ApiProperty } from '@nestjs/swagger';
import type { Role, User } from '../../../generated/prisma/client';
import { resolveAvatarUrl } from '../../../common/avatar/avatar.util';

export class UserResponseDto {
  @ApiProperty({ example: 'b33703c6-0158-450f-90e9-b54190c7f123' })
  id!: string;

  @ApiProperty({ example: 'user@example.test' })
  email!: string;

  @ApiProperty({ example: 'Jane Doe' })
  name!: string;

  @ApiProperty({
    example: 'https://ui-avatars.com/api/?name=Jane+Doe&size=256',
  })
  avatarUrl!: string;

  @ApiProperty({ example: true })
  isEmailVerified!: boolean;

  @ApiProperty({ enum: ['USER', 'ADMIN'], example: 'USER' })
  role!: Role;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromEntity(user: User): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: resolveAvatarUrl(user),
      isEmailVerified: user.isEmailVerified,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
