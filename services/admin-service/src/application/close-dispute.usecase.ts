import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../adapters/db/prisma.service';
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
    private readonly prisma: PrismaService,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  async execute(input: CloseDisputeInput): Promise<{ id: string; status: string }> {
    const closed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM disputes
        WHERE id = ${input.disputeId}::uuid
        FOR UPDATE
      `;
      const dispute = rows[0];
      if (!dispute) throw new DisputeNotFoundError();
      if (dispute.status === 'CLOSED') throw new InvalidStateError('Dispute is already closed');

      const updated = await tx.dispute.update({
        where: { id: input.disputeId },
        data: { status: 'CLOSED' },
      });

      await this.auditLogRepo.create(
        {
          actorUserId: input.actorUserId,
          actorRoles: input.actorRoles,
          action: 'DISPUTE_CLOSE',
          targetType: 'Dispute',
          targetId: input.disputeId,
          payloadJson: {},
          traceId: input.traceId,
        },
        tx,
      );

      return updated;
    });

    this.logger.log(`Dispute closed: id=${input.disputeId} by=${input.actorUserId}`);

    return { id: closed.id, status: closed.status };
  }
}
