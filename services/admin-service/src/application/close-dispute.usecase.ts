import { Injectable, Logger } from '@nestjs/common';
import { DisputeRepository } from '../adapters/db/dispute.repository';
import { AuditLogRepository } from '../adapters/db/audit-log.repository';
import { DisputeNotFoundError, InvalidStateError } from '../shared/errors';

interface CloseDisputeInput {
  disputeId: string;
  actorUserId: string;
  actorRoles: string[];
  traceId: string;
}

@Injectable()
export class CloseDisputeUseCase {
  private readonly logger = new Logger(CloseDisputeUseCase.name);

  constructor(
    private readonly disputeRepo: DisputeRepository,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  async execute(input: CloseDisputeInput): Promise<{ id: string; status: string }> {
    const dispute = await this.disputeRepo.findById(input.disputeId);
    if (!dispute) {
      throw new DisputeNotFoundError();
    }

    if (dispute.status === 'CLOSED') {
      throw new InvalidStateError('Dispute is already closed');
    }

    const closed = await this.disputeRepo.close(input.disputeId);

    await this.auditLogRepo.create({
      actorUserId: input.actorUserId,
      actorRoles: input.actorRoles,
      action: 'DISPUTE_CLOSE',
      targetType: 'Dispute',
      targetId: input.disputeId,
      payloadJson: { previousStatus: dispute.status },
      traceId: input.traceId,
    });

    this.logger.log(`Dispute closed: id=${input.disputeId} by=${input.actorUserId}`);

    return { id: closed.id, status: closed.status };
  }
}
