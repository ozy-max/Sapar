import { Injectable, Logger } from '@nestjs/common';
import { DisputeResolution } from '@prisma/client';
import { DisputeRepository } from '../adapters/db/dispute.repository';
import { AuditLogRepository } from '../adapters/db/audit-log.repository';
import { DisputeNotFoundError, SlaWindowExpiredError, InvalidStateError } from '../shared/errors';
import { loadEnv } from '../config/env';

interface ResolveDisputeInput {
  disputeId: string;
  resolution: string;
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

@Injectable()
export class ResolveDisputeUseCase {
  private readonly logger = new Logger(ResolveDisputeUseCase.name);

  constructor(
    private readonly disputeRepo: DisputeRepository,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  async execute(input: ResolveDisputeInput): Promise<DisputeOutput> {
    const dispute = await this.disputeRepo.findById(input.disputeId);
    if (!dispute) {
      throw new DisputeNotFoundError();
    }

    if (dispute.status !== 'OPEN') {
      throw new InvalidStateError(`Dispute is already ${dispute.status}`);
    }

    const env = loadEnv();
    const slaDeadline = new Date(dispute.departAt.getTime() + env.SLA_RESOLVE_HOURS * 60 * 60 * 1000);
    if (new Date() > slaDeadline) {
      throw new SlaWindowExpiredError();
    }

    const resolved = await this.disputeRepo.resolve(
      input.disputeId,
      input.resolution as DisputeResolution,
      input.actorUserId,
    );

    await this.auditLogRepo.create({
      actorUserId: input.actorUserId,
      actorRoles: input.actorRoles,
      action: 'DISPUTE_RESOLVE',
      targetType: 'Dispute',
      targetId: input.disputeId,
      payloadJson: { resolution: input.resolution },
      traceId: input.traceId,
    });

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
