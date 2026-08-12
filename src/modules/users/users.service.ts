import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { User } from '../../generated/prisma/client';

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
}
