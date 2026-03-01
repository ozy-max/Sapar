import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(data: { email: string; passwordHash: string }): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async updateRoles(id: string, roles: string[]): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { roles } });
  }

  async ban(id: string, reason: string, until?: Date): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        banReason: reason,
        bannedUntil: until ?? new Date('2099-12-31T23:59:59Z'),
      },
    });
  }

  async unban(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        banReason: null,
        bannedUntil: null,
      },
    });
  }

  async isBanned(id: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { bannedUntil: true },
    });
    if (!user?.bannedUntil) return false;
    return user.bannedUntil > new Date();
  }
}
