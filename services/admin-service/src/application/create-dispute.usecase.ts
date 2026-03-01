import { Injectable, Logger } from '@nestjs/common';
import { DisputeType } from '@prisma/client';
import { DisputeRepository } from '../adapters/db/dispute.repository';
import { AuditLogRepository } from '../adapters/db/audit-log.repository';

interface CreateDisputeInput {
  type: string;
  bookingId: string;
  departAt: string;
  evidenceUrls: string[];
  actorUserId: string;
  actorRoles: string[];
  traceId: string;
}

interface DisputeOutput {
  id: string;
  type: string;
  bookingId: string;
  departAt: string;
  evidenceUrls: string[];
  status: string;
}

@Injectable()
export class CreateDisputeUseCase {
  private readonly logger = new Logger(CreateDisputeUseCase.name);

  constructor(
    private readonly disputeRepo: DisputeRepository,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  async execute(input: CreateDisputeInput): Promise<DisputeOutput> {
    const dispute = await this.disputeRepo.create({
      type: input.type as DisputeType,
      bookingId: input.bookingId,
      departAt: new Date(input.departAt),
      evidenceUrls: input.evidenceUrls,
    });

    await this.auditLogRepo.create({
      actorUserId: input.actorUserId,
      actorRoles: input.actorRoles,
      action: 'DISPUTE_CREATE',
      targetType: 'Dispute',
      targetId: dispute.id,
      payloadJson: { type: input.type, bookingId: input.bookingId },
      traceId: input.traceId,
    });

    this.logger.log(`Dispute created: id=${dispute.id} by=${input.actorUserId}`);

    return {
      id: dispute.id,
      type: dispute.type,
      bookingId: dispute.bookingId,
      departAt: dispute.departAt.toISOString(),
      evidenceUrls: dispute.evidenceUrls,
      status: dispute.status,
    };
  }
}
