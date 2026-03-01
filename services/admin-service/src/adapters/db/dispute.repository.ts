import { Injectable } from '@nestjs/common';
import { Dispute, DisputeType, DisputeStatus, DisputeResolution } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class DisputeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    type: DisputeType;
    bookingId: string;
    departAt: Date;
    evidenceUrls: string[];
  }): Promise<Dispute> {
    return this.prisma.dispute.create({ data });
  }

  async findById(id: string): Promise<Dispute | null> {
    return this.prisma.dispute.findUnique({ where: { id } });
  }

  async resolve(
    id: string,
    resolution: DisputeResolution,
    resolvedBy: string,
  ): Promise<Dispute> {
    return this.prisma.dispute.update({
      where: { id },
      data: {
        status: DisputeStatus.RESOLVED,
        resolution,
        resolvedAt: new Date(),
        resolvedBy,
      },
    });
  }

  async close(id: string): Promise<Dispute> {
    return this.prisma.dispute.update({
      where: { id },
      data: { status: DisputeStatus.CLOSED },
    });
  }
}
