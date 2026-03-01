import { Injectable, Logger } from '@nestjs/common';
import { AdminCommandType } from '@prisma/client';
import { AdminCommandRepository } from '../adapters/db/admin-command.repository';
import { AuditLogRepository } from '../adapters/db/audit-log.repository';

interface CancelTripInput {
  tripId: string;
  reason: string;
  actorUserId: string;
  actorRoles: string[];
  traceId: string;
}

@Injectable()
export class CancelTripUseCase {
  private readonly logger = new Logger(CancelTripUseCase.name);

  constructor(
    private readonly commandRepo: AdminCommandRepository,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  async execute(input: CancelTripInput): Promise<{ commandId: string; status: string }> {
    const command = await this.commandRepo.create({
      targetService: 'trips',
      type: AdminCommandType.CANCEL_TRIP,
      payload: { tripId: input.tripId, reason: input.reason },
      createdBy: input.actorUserId,
      traceId: input.traceId,
    });

    await this.auditLogRepo.create({
      actorUserId: input.actorUserId,
      actorRoles: input.actorRoles,
      action: 'TRIP_CANCEL',
      targetType: 'Trip',
      targetId: input.tripId,
      payloadJson: { reason: input.reason },
      traceId: input.traceId,
    });

    this.logger.log(`Trip cancel command: tripId=${input.tripId} by=${input.actorUserId}`);

    return { commandId: command.id, status: command.status };
  }
}
