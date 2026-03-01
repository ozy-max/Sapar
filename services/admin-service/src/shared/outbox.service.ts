import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { OutboxEventRepository } from '../adapters/db/outbox-event.repository';

@Injectable()
export class OutboxService {
  constructor(private readonly outboxRepo: OutboxEventRepository) {}

  async publish(
    params: {
      eventType: string;
      payload: Record<string, unknown>;
      traceId: string;
    },
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const eventId = randomUUID();
    await this.outboxRepo.create(
      {
        id: eventId,
        eventType: params.eventType,
        payloadJson: params.payload,
        occurredAt: new Date(),
        traceId: params.traceId,
      },
      tx,
    );
    return eventId;
  }
}
