import { Injectable, Inject, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';
import { OutboxService } from '../../shared/outbox.service';
import { PSP_ADAPTER, PspAdapter } from '../../adapters/psp/psp.interface';
import { withTimeout } from '../../shared/psp-timeout';
import { loadEnv } from '../../config/env';

interface DisputeResolvedPayload {
  disputeId: string;
  bookingId: string;
  resolution: 'REFUND' | 'PARTIAL' | 'NO_REFUND';
  refundAmountKgs?: number;
}

interface PaymentIntentRow {
  id: string;
  booking_id: string;
  payer_id: string;
  amount_kgs: number;
  currency: string;
  status: string;
  psp_intent_id: string | null;
}

@Injectable()
export class OnDisputeResolvedHandler implements EventHandler {
  readonly eventType = 'dispute.resolved';
  private readonly logger = new Logger(OnDisputeResolvedHandler.name);

  constructor(
    private readonly outboxService: OutboxService,
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
  ) {}

  async handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const p = event.payload as unknown as DisputeResolvedPayload;

    if (p.resolution === 'NO_REFUND') {
      this.logger.log({ msg: 'Dispute resolved with NO_REFUND, skipping', disputeId: p.disputeId, traceId: event.traceId });
      return;
    }

    const intents = await tx.$queryRaw<PaymentIntentRow[]>`
      SELECT id, booking_id, payer_id, amount_kgs, currency, status, psp_intent_id
      FROM payment_intents
      WHERE booking_id = ${p.bookingId}::uuid
      FOR UPDATE
    `;
    const row = intents[0];

    if (!row) {
      this.logger.log({ msg: 'No payment intent for dispute', bookingId: p.bookingId, traceId: event.traceId });
      return;
    }

    if (row.status === 'REFUNDED') {
      this.logger.log({ msg: 'Payment already refunded', bookingId: p.bookingId, traceId: event.traceId });
      return;
    }

    if (row.status !== 'CAPTURED') {
      this.logger.warn({ msg: 'Cannot refund: payment not captured', bookingId: p.bookingId, status: row.status, traceId: event.traceId });
      return;
    }

    const refundAmount = p.resolution === 'PARTIAL' && p.refundAmountKgs
      ? p.refundAmountKgs
      : row.amount_kgs;

    const env = loadEnv();

    try {
      await withTimeout(
        this.psp.refund(row.psp_intent_id!, refundAmount),
        env.PSP_TIMEOUT_MS,
      );
    } catch (error) {
      this.logger.error({ msg: 'PSP refund failed for dispute', disputeId: p.disputeId, error: String(error), traceId: event.traceId });
      throw error;
    }

    await tx.paymentIntent.update({
      where: { id: row.id },
      data: { status: 'REFUNDED' },
    });

    await tx.paymentEvent.create({
      data: {
        paymentIntentId: row.id,
        type: 'REFUNDED',
        payloadJson: {
          reason: 'dispute_resolved',
          disputeId: p.disputeId,
          resolution: p.resolution,
          refundAmountKgs: refundAmount,
          triggeredBy: event.eventType,
        },
      },
    });

    await this.outboxService.publish(
      {
        eventType: 'payment.refunded',
        payload: {
          paymentIntentId: row.id,
          bookingId: p.bookingId,
          amountKgs: refundAmount,
          disputeId: p.disputeId,
        },
        traceId: event.traceId,
      },
      tx,
    );

    this.logger.log({
      msg: 'Payment refunded for dispute',
      disputeId: p.disputeId,
      bookingId: p.bookingId,
      resolution: p.resolution,
      refundAmountKgs: refundAmount,
      traceId: event.traceId,
    });
  }
}
