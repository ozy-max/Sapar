import { Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@prisma/client';
import { PrismaService } from '../adapters/db/prisma.service';

interface UpsertConfigInput {
  key: string;
  type: string;
  value: unknown;
  description?: string;
  scope?: string;
  actorUserId: string;
  actorRoles: string[];
  traceId: string;
}

interface ConfigOutput {
  key: string;
  type: string;
  value: unknown;
  description: string | null;
  scope: string | null;
}

@Injectable()
export class UpsertConfigUseCase {
  private readonly logger = new Logger(UpsertConfigUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute(input: UpsertConfigInput): Promise<ConfigOutput> {
    const config = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.config.findUnique({ where: { key: input.key } });
      const nextVersion = (existing?.version ?? 0) + 1;

      const upserted = await tx.config.upsert({
        where: { key: input.key },
        update: {
          type: input.type as ConfigType,
          valueJson: input.value as never,
          description: input.description,
          scope: input.scope,
          version: nextVersion,
        },
        create: {
          key: input.key,
          type: input.type as ConfigType,
          valueJson: input.value as never,
          description: input.description,
          scope: input.scope,
          version: 1,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          actorRoles: input.actorRoles,
          action: 'CONFIG_UPSERT',
          targetType: 'Config',
          targetId: input.key,
          payloadJson: { type: input.type, value: input.value, description: input.description, scope: input.scope } as never,
          traceId: input.traceId,
        },
      });

      return upserted;
    });

    this.logger.log(`Config upserted: key=${input.key} by=${input.actorUserId}`);

    return {
      key: config.key,
      type: config.type,
      value: config.valueJson,
      description: config.description,
      scope: config.scope,
    };
  }
}
