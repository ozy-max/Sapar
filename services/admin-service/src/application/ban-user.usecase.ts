import { Injectable, Logger } from '@nestjs/common';
import { AdminCommandType } from '@prisma/client';
import { AdminCommandRepository } from '../adapters/db/admin-command.repository';
import { AuditLogRepository } from '../adapters/db/audit-log.repository';

interface BanUserInput {
  userId: string;
  reason: string;
  until?: string;
  actorUserId: string;
  actorRoles: string[];
  traceId: string;
}

@Injectable()
export class BanUserUseCase {
  private readonly logger = new Logger(BanUserUseCase.name);

  constructor(
    private readonly commandRepo: AdminCommandRepository,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  async execute(input: BanUserInput): Promise<{ commandId: string; status: string }> {
    const command = await this.commandRepo.create({
      targetService: 'identity',
      type: AdminCommandType.BAN_USER,
      payload: { userId: input.userId, reason: input.reason, until: input.until },
      createdBy: input.actorUserId,
      traceId: input.traceId,
    });

    await this.auditLogRepo.create({
      actorUserId: input.actorUserId,
      actorRoles: input.actorRoles,
      action: 'USER_BAN',
      targetType: 'User',
      targetId: input.userId,
      payloadJson: { reason: input.reason, until: input.until },
      traceId: input.traceId,
    });

    this.logger.log(`User ban command: userId=${input.userId} by=${input.actorUserId}`);

    return { commandId: command.id, status: command.status };
  }
}
