import { Injectable } from '@nestjs/common';
import { Prisma, Receipt } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface ReceiptRow {
  id: string;
  payment_intent_id: string;
  status: string;
  try_count: number;
  next_retry_at: Date;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class ReceiptRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    paymentIntentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Receipt> {
    const client = tx ?? this.prisma;
    return client.receipt.create({
      data: {
        paymentIntentId,
        status: 'PENDING',
        tryCount: 0,
        nextRetryAt: new Date(),
      },
    });
  }

  async findDueIds(limit = 10): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM receipts
      WHERE status = 'PENDING'
        AND next_retry_at <= NOW()
      ORDER BY next_retry_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    return rows.map((r) => r.id);
  }

  async lockById(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<ReceiptRow | null> {
    const rows = await tx.$queryRaw<ReceiptRow[]>`
      SELECT * FROM receipts
      WHERE id = ${id}::uuid AND status = 'PENDING'
      FOR UPDATE SKIP LOCKED
    `;
    return rows[0] ?? null;
  }

  async markIssued(id: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.receipt.update({
      where: { id },
      data: { status: 'ISSUED' },
    });
  }

  async markRetry(
    id: string,
    tryCount: number,
    nextRetryAt: Date,
    lastError: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.receipt.update({
      where: { id },
      data: { tryCount, nextRetryAt, lastError },
    });
  }

  async markFailedFinal(
    id: string,
    lastError: string,
    tryCount: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.receipt.update({
      where: { id },
      data: { status: 'FAILED_FINAL', lastError, tryCount },
    });
  }

  async findByPaymentIntentIds(
    paymentIntentIds: string[],
  ): Promise<Receipt[]> {
    if (paymentIntentIds.length === 0) return [];
    return this.prisma.receipt.findMany({
      where: { paymentIntentId: { in: paymentIntentIds } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByPaymentIntentId(paymentIntentId: string): Promise<Receipt | null> {
    return this.prisma.receipt.findFirst({
      where: { paymentIntentId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
