import { Injectable } from '@nestjs/common';
import { DisputeRepository } from '../adapters/db/dispute.repository';
import { DisputeNotFoundError } from '../shared/errors';

interface DisputeOutput {
  id: string;
  type: string;
  bookingId: string;
  departAt: string;
  evidenceUrls: string[];
  status: string;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

@Injectable()
export class GetDisputeUseCase {
  constructor(private readonly disputeRepo: DisputeRepository) {}

  async execute(id: string): Promise<DisputeOutput> {
    const dispute = await this.disputeRepo.findById(id);
    if (!dispute) {
      throw new DisputeNotFoundError();
    }

    return {
      id: dispute.id,
      type: dispute.type,
      bookingId: dispute.bookingId,
      departAt: dispute.departAt.toISOString(),
      evidenceUrls: dispute.evidenceUrls,
      status: dispute.status,
      resolution: dispute.resolution,
      resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
      resolvedBy: dispute.resolvedBy,
    };
  }
}
