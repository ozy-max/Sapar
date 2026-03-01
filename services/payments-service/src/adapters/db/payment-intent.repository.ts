import { Injectable } from '@nestjs/common';
import { Prisma, PaymentIntent } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface CreateIntentData {
  bookingId: string;
  payerId: string;
  amountKgs: number;
  currency: string;
  idempotencyKey?: string;
}

interface PaymentIntentRow {
  id: string;
  booking_id: string;
  payer_id: string;
  amount_kgs: number;
  currency: string;
  status: string;
  psp_provider: string;
  psp_intent_id: string | null;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class PaymentIntentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<PaymentIntent | null> {
    return this.prisma.paymentIntent.findUnique({ where: { id } });
  }

  async findByIdempotencyKey(
    key: string,
    payerId: string,
  ): Promise<PaymentIntent | null> {
    return this.prisma.paymentIntent.findUnique({
      where: { idempotencyKey_payerId: { idempotencyKey: key, payerId } },
    });
  }

  async create(data: CreateIntentData): Promise<PaymentIntent> {
    return this.prisma.paymentIntent.create({
      data: {
        bookingId: data.bookingId,
        payerId: data.payerId,
        amountKgs: data.amountKgs,
        currency: data.currency,
        idempotencyKey: data.idempotencyKey,
        status: 'CREATED',
      },
    });
  }

  async findByIdForUpdate(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<PaymentIntentRow | null> {
    const rows = await tx.$queryRaw<PaymentIntentRow[]>`
      SELECT * FROM payment_intents WHERE id = ${id}::uuid FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async updateStatus(
    id: string,
    status: string,
    tx: Prisma.TransactionClient,
    extra?: { pspIntentId?: string },
  ): Promise<PaymentIntent> {
    return tx.paymentIntent.update({
      where: { id },
      data: {
        status: status as PaymentIntent['status'],
        ...(extra?.pspIntentId !== undefined && { pspIntentId: extra.pspIntentId }),
      },
    });
  }

  async findByPspIntentId(pspIntentId: string): Promise<PaymentIntent | null> {
    return this.prisma.paymentIntent.findFirst({
      where: { pspIntentId },
    });
  }
}
