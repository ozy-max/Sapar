import { Injectable } from '@nestjs/common';
import { Config, ConfigType, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class ConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Config[]> {
    return this.prisma.config.findMany({ orderBy: { key: 'asc' } });
  }

  async findByKeys(keys: string[]): Promise<Config[]> {
    return this.prisma.config.findMany({
      where: { key: { in: keys } },
      orderBy: { key: 'asc' },
    });
  }

  async findByKey(key: string): Promise<Config | null> {
    return this.prisma.config.findUnique({ where: { key } });
  }

  async getMaxVersion(): Promise<number> {
    const result = await this.prisma.config.aggregate({
      _max: { version: true },
    });
    return result._max.version ?? 0;
  }

  async upsert(data: {
    key: string;
    type: ConfigType;
    valueJson: unknown;
    description?: string;
    scope?: string;
  }): Promise<Config> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.config.findUnique({ where: { key: data.key } });
      const nextVersion = (existing?.version ?? 0) + 1;

      return tx.config.upsert({
        where: { key: data.key },
        update: {
          type: data.type,
          valueJson: data.valueJson as never,
          description: data.description,
          scope: data.scope,
          version: nextVersion,
        },
        create: {
          key: data.key,
          type: data.type,
          valueJson: data.valueJson as never,
          description: data.description,
          scope: data.scope,
          version: 1,
        },
      });
    });
  }

  async deleteByKey(key: string): Promise<Config> {
    return this.prisma.config.delete({ where: { key } });
  }
}
