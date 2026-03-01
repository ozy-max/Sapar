import { Injectable } from '@nestjs/common';
import { UserProfile, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class ProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<UserProfile | null> {
    return this.prisma.userProfile.findUnique({ where: { userId } });
  }

  async upsert(
    userId: string,
    data: {
      displayName: string;
      avatarUrl?: string | null;
      bio?: string | null;
      city?: string | null;
    },
  ): Promise<UserProfile> {
    return this.prisma.userProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  async findByUserIdInTx(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<UserProfile | null> {
    return tx.userProfile.findUnique({ where: { userId } });
  }
}
