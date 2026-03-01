import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface OutboxEventRow {
  id: string;
  event_type: string;
  payload_json: Prisma.JsonValue;
  occurred_at: Date;
  trace_id: string;
  status: string;
  try_count: number;
  next_retry_at: Date;
}

@Injectable()
export class OutboxEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: {
      id: string;
      eventType: string;
      payloadJson: Record<string, unknown>;
      occurredAt: Date;
      traceId: string;
    },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        id: data.id,
        eventType: data.eventType,
        payloadJson: data.payloadJson as unknown as Prisma.JsonObject,
        occurredAt: data.occurredAt,
        traceId: data.traceId,
        status: 'PENDING',
        tryCount: 0,
        nextRetryAt: new Date(),
      },
    });
  }

  async findDueIds(limit = 50): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM outbox_events
      WHERE status IN ('PENDING'::"OutboxEventStatus", 'FAILED_RETRY'::"OutboxEventStatus")
        AND next_retry_at <= NOW()
      ORDER BY next_retry_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    return rows.map((r) => r.id);
  }

  async lockById(id: string, tx: Prisma.TransactionClient): Promise<OutboxEventRow | null> {
    const rows = await tx.$queryRaw<OutboxEventRow[]>`
      SELECT id, event_type, payload_json, occurred_at, trace_id, status, try_count, next_retry_at
      FROM outbox_events
      WHERE id = ${id}::uuid
        AND status IN ('PENDING'::"OutboxEventStatus", 'FAILED_RETRY'::"OutboxEventStatus")
      FOR UPDATE SKIP LOCKED
    `;
    return rows[0] ?? null;
  }

  async markSent(id: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.outboxEvent.update({
      where: { id },
      data: { status: 'SENT' },
    });
  }

  async markFailedRetry(
    id: string,
    tryCount: number,
    nextRetryAt: Date,
    lastError: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.outboxEvent.update({
      where: { id },
      data: { status: 'FAILED_RETRY', tryCount, nextRetryAt, lastError },
    });
  }

  async markFailedFinal(
    id: string,
    tryCount: number,
    lastError: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.outboxEvent.update({
      where: { id },
      data: { status: 'FAILED_FINAL', tryCount, lastError },
    });
  }
}
