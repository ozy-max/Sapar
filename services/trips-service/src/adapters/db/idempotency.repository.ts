import { Injectable } from '@nestjs/common';
import { IdempotencyRecord } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class IdempotencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByKeyAndUser(key: string, userId: string): Promise<IdempotencyRecord | null> {
    return this.prisma.idempotencyRecord.findUnique({
      where: { key_userId: { key, userId } },
    });
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.prisma.idempotencyRecord.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}
