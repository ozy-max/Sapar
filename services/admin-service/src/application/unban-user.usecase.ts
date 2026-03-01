import { Injectable, Logger } from '@nestjs/common';
import { AdminCommandType } from '@prisma/client';
import { AdminCommandRepository } from '../adapters/db/admin-command.repository';
import { AuditLogRepository } from '../adapters/db/audit-log.repository';

interface UnbanUserInput {
  userId: string;
  reason: string;
  actorUserId: string;
  actorRoles: string[];
  traceId: string;
}

@Injectable()
export class UnbanUserUseCase {
  private readonly logger = new Logger(UnbanUserUseCase.name);

  constructor(
    private readonly commandRepo: AdminCommandRepository,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  async execute(input: UnbanUserInput): Promise<{ commandId: string; status: string }> {
    const command = await this.commandRepo.create({
      targetService: 'identity',
      type: AdminCommandType.UNBAN_USER,
      payload: { userId: input.userId, reason: input.reason },
      createdBy: input.actorUserId,
      traceId: input.traceId,
    });

    await this.auditLogRepo.create({
      actorUserId: input.actorUserId,
      actorRoles: input.actorRoles,
      action: 'USER_UNBAN',
      targetType: 'User',
      targetId: input.userId,
      payloadJson: { reason: input.reason },
      traceId: input.traceId,
    });

    this.logger.log(`User unban command: userId=${input.userId} by=${input.actorUserId}`);

    return { commandId: command.id, status: command.status };
  }
}
