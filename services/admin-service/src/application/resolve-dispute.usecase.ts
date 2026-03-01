import { Injectable, Logger } from '@nestjs/common';
import { DisputeResolution } from '@prisma/client';
import { PrismaService } from '../adapters/db/prisma.service';
import { AuditLogRepository } from '../adapters/db/audit-log.repository';
import { OutboxService } from '../shared/outbox.service';
import { DisputeNotFoundError, SlaWindowExpiredError, InvalidStateError } from '../shared/errors';
import { loadEnv } from '../config/env';

interface ResolveDisputeInput {
  disputeId: string;
  resolution: string;
  refundAmountKgs?: number;
  actorUserId: string;
  actorRoles: string[];
  traceId: string;
}

interface DisputeOutput {
  id: string;
  type: string;
  bookingId: string;
  status: string;
  resolution: string;
  resolvedAt: string;
  resolvedBy: string;
}

const PAYMENT_RESOLUTIONS: string[] = ['REFUND', 'PARTIAL', 'NO_REFUND'];

@Injectable()
export class ResolveDisputeUseCase {
  private readonly logger = new Logger(ResolveDisputeUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly outboxService: OutboxService,
  ) {}

  async execute(input: ResolveDisputeInput): Promise<DisputeOutput> {
    const resolved = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string; type: string; booking_id: string; depart_at: Date }>>`
        SELECT id, status, type, booking_id, depart_at
        FROM disputes
        WHERE id = ${input.disputeId}::uuid
        FOR UPDATE
      `;
      const dispute = rows[0];
      if (!dispute) throw new DisputeNotFoundError();
      if (dispute.status !== 'OPEN') throw new InvalidStateError(`Dispute is already ${dispute.status}`);

      const env = loadEnv();
      const slaDeadline = new Date(dispute.depart_at.getTime() + env.SLA_RESOLVE_HOURS * 60 * 60 * 1000);
      if (new Date() > slaDeadline) throw new SlaWindowExpiredError();

      const updated = await tx.dispute.update({
        where: { id: input.disputeId },
        data: {
          status: 'RESOLVED',
          resolution: input.resolution as DisputeResolution,
          resolvedAt: new Date(),
          resolvedBy: input.actorUserId,
        },
      });

      if (PAYMENT_RESOLUTIONS.includes(input.resolution)) {
        await this.outboxService.publish(
          {
            eventType: 'dispute.resolved',
            payload: {
              disputeId: input.disputeId,
              bookingId: dispute.booking_id,
              resolution: input.resolution,
              refundAmountKgs: input.refundAmountKgs,
            },
            traceId: input.traceId,
          },
          tx,
        );
      }

      await this.auditLogRepo.create({
        actorUserId: input.actorUserId,
        actorRoles: input.actorRoles,
        action: 'DISPUTE_RESOLVE',
        targetType: 'Dispute',
        targetId: input.disputeId,
        payloadJson: { resolution: input.resolution, refundAmountKgs: input.refundAmountKgs },
        traceId: input.traceId,
      }, tx);

      return updated;
    }, { timeout: 10_000 });

    this.logger.log(`Dispute resolved: id=${input.disputeId} resolution=${input.resolution} by=${input.actorUserId}`);

    return {
      id: resolved.id,
      type: resolved.type,
      bookingId: resolved.bookingId,
      status: resolved.status,
      resolution: resolved.resolution!,
      resolvedAt: resolved.resolvedAt!.toISOString(),
      resolvedBy: resolved.resolvedBy!,
    };
  }
}
