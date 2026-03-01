/**
 * SHARED CODE — canonical source.
 * Copies: payments-service, notifications-service, admin-service.
 * TODO: Extract to @sapar/shared package when monorepo tooling is set up.
 * Any changes must be applied to all copies.
 */
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
