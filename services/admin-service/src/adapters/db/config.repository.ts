import { Injectable } from '@nestjs/common';
import { Config, ConfigType } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class ConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Config[]> {
    return this.prisma.config.findMany({ orderBy: { key: 'asc' } });
  }

  async findByKey(key: string): Promise<Config | null> {
    return this.prisma.config.findUnique({ where: { key } });
  }

  async upsert(data: {
    key: string;
    type: ConfigType;
    valueJson: unknown;
    description?: string;
    scope?: string;
  }): Promise<Config> {
    return this.prisma.config.upsert({
      where: { key: data.key },
      update: {
        type: data.type,
        valueJson: data.valueJson as never,
        description: data.description,
        scope: data.scope,
      },
      create: {
        key: data.key,
        type: data.type,
        valueJson: data.valueJson as never,
        description: data.description,
        scope: data.scope,
      },
    });
  }

  async deleteByKey(key: string): Promise<Config> {
    return this.prisma.config.delete({ where: { key } });
  }
}
