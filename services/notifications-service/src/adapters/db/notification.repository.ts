import { Injectable } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface NotificationRow {
  id: string;
  user_id: string;
  channel: string;
  template_key: string;
  payload_json: unknown;
  status: string;
  idempotency_key: string | null;
  try_count: number;
  next_retry_at: Date;
  last_error: string | null;
  provider_message_id: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: {
      userId: string;
      channel: 'SMS' | 'EMAIL' | 'PUSH';
      templateKey: string;
      payloadJson: object;
      idempotencyKey?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<Notification> {
    const client = tx ?? this.prisma;
    return client.notification.create({
      data: {
        userId: data.userId,
        channel: data.channel,
        templateKey: data.templateKey,
        payloadJson: data.payloadJson,
        status: 'PENDING',
        idempotencyKey: data.idempotencyKey,
        tryCount: 0,
        nextRetryAt: new Date(),
      },
    });
  }

  async findById(id: string): Promise<Notification | null> {
    return this.prisma.notification.findUnique({ where: { id } });
  }

  async findByIdempotencyKey(idempotencyKey: string, userId: string): Promise<Notification | null> {
    return this.prisma.notification.findUnique({
      where: {
        idempotencyKey_userId: { idempotencyKey, userId },
      },
    });
  }

  async updateStatus(
    id: string,
    status: 'SENT' | 'FAILED_RETRY' | 'FAILED_FINAL' | 'CANCELLED',
    extra?: {
      tryCount?: number;
      nextRetryAt?: Date;
      lastError?: string;
      providerMessageId?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.notification.update({
      where: { id },
      data: { status, ...extra },
    });
  }

  async findDueIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM notifications
      WHERE status IN ('PENDING', 'FAILED_RETRY')
        AND next_retry_at <= NOW()
      ORDER BY next_retry_at ASC
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `;
    return rows.map((r) => r.id);
  }

  async lockById(id: string, tx: Prisma.TransactionClient): Promise<NotificationRow | null> {
    const rows = await tx.$queryRaw<NotificationRow[]>`
      SELECT * FROM notifications
      WHERE id = ${id}::uuid
        AND status IN ('PENDING', 'FAILED_RETRY')
      FOR UPDATE SKIP LOCKED
    `;
    return rows[0] ?? null;
  }
}
