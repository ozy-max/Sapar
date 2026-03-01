import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class ConsumedEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEventId(eventId: string): Promise<{ eventId: string } | null> {
    return this.prisma.consumedEvent.findUnique({
      where: { eventId },
      select: { eventId: true },
    });
  }

  async existsInTx(eventId: string, tx: Prisma.TransactionClient): Promise<boolean> {
    const row = await tx.consumedEvent.findUnique({
      where: { eventId },
      select: { eventId: true },
    });
    return row !== null;
  }

  async create(
    data: {
      eventId: string;
      eventType: string;
      producer: string;
      traceId: string;
    },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.consumedEvent.create({
      data: {
        eventId: data.eventId,
        eventType: data.eventType,
        producer: data.producer,
        traceId: data.traceId,
      },
    });
  }
}
