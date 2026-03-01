import { Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@prisma/client';
import { ConfigRepository } from '../adapters/db/config.repository';
import { AuditLogRepository } from '../adapters/db/audit-log.repository';

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

  constructor(
    private readonly configRepo: ConfigRepository,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  async execute(input: UpsertConfigInput): Promise<ConfigOutput> {
    const config = await this.configRepo.upsert({
      key: input.key,
      type: input.type as ConfigType,
      valueJson: input.value,
      description: input.description,
      scope: input.scope,
    });

    await this.auditLogRepo.create({
      actorUserId: input.actorUserId,
      actorRoles: input.actorRoles,
      action: 'CONFIG_UPSERT',
      targetType: 'Config',
      targetId: input.key,
      payloadJson: { type: input.type, value: input.value, description: input.description, scope: input.scope },
      traceId: input.traceId,
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
