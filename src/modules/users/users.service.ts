import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { User } from '../../generated/prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';

interface CreateLocalUser {
  email: string;
  passwordHash: string;
  name: string;
  isEmailVerified: boolean;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
      omit: { password: false },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  findByIdWithPassword(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
      omit: { password: false },
    });
  }

  createLocal(data: CreateLocalUser): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: data.email,
        password: data.passwordHash,
        name: data.name,
        isEmailVerified: data.isEmailVerified,
      },
    });
  }

  async update(id: string, data: UpdateUserDto): Promise<User> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
        },
      });
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === 'P2025'
      ) {
        throw new NotFoundException('User not found.');
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prisma.user.delete({
        where: { id },
      });
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === 'P2025'
      ) {
        throw new NotFoundException('User not found.');
      }
      throw error;
    }
  }
}
