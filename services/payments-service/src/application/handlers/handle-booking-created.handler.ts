import { Injectable, Inject, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventHandler } from '../../shared/event-handler.interface';
import { EventEnvelope } from '../../shared/event-envelope';
import { OutboxService } from '../../shared/outbox.service';
import { PSP_ADAPTER, PspAdapter } from '../../adapters/psp/psp.interface';
import { withTimeout } from '../../shared/psp-timeout';
import { loadEnv } from '../../config/env';
import { recordSagaOutcome } from '../../observability/saga-metrics';

interface BookingCreatedPayload {
  bookingId: string;
  tripId: string;
  passengerId: string;
  seats: number;
  amountKgs: number;
  currency?: string;
  departAt?: string;
  createdAt?: string;
}

@Injectable()
export class HandleBookingCreatedHandler implements EventHandler {
  readonly eventType = 'booking.created';
  private readonly logger = new Logger(HandleBookingCreatedHandler.name);

  constructor(
    private readonly outboxService: OutboxService,
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
  ) {}

  async handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void> {
    const p = event.payload as unknown as BookingCreatedPayload;
    const amountKgs = p.amountKgs ?? 0;
    const currency = p.currency ?? 'KGS';

    const existing = await tx.paymentIntent.findUnique({
      where: { bookingId: p.bookingId },
      select: { id: true, status: true },
    });
    if (existing) {
      this.logger.log({
        msg: 'Payment intent already exists for booking',
        bookingId: p.bookingId,
        status: existing.status,
        traceId: event.traceId,
      });
      return;
    }

    const intent = await tx.paymentIntent.create({
      data: {
        bookingId: p.bookingId,
        payerId: p.passengerId,
        amountKgs,
        currency,
        status: 'CREATED',
        pspProvider: 'event-driven',
      },
    });

    let pspIntentId: string | undefined;
    let holdFailed = false;
    let failReason = '';

    try {
      const env = loadEnv();
      const result = await withTimeout(
        this.psp.placeHold(amountKgs, currency, { bookingId: p.bookingId }),
        env.PSP_TIMEOUT_MS,
      );
      pspIntentId = result.pspIntentId;
    } catch (error) {
      holdFailed = true;
      failReason = error instanceof Error ? error.message : String(error);
      this.logger.error({
        msg: 'PSP placeHold failed',
        bookingId: p.bookingId,
        error: failReason,
        traceId: event.traceId,
      });
    }

    if (holdFailed) {
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'FAILED' },
      });

      await tx.paymentEvent.create({
        data: {
          paymentIntentId: intent.id,
          type: 'FAILED',
          payloadJson: { reason: failReason, triggeredBy: event.eventType },
        },
      });

      await this.outboxService.publish(
        {
          eventType: 'payment.intent.failed',
          payload: {
            paymentIntentId: intent.id,
            bookingId: p.bookingId,
            passengerId: p.passengerId,
            reason: failReason,
          },
          traceId: event.traceId,
        },
        tx,
      );

      recordSagaOutcome('payments', 'hold', 'fail');
    } else {
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'HOLD_PLACED', pspIntentId },
      });

      await tx.paymentEvent.create({
        data: {
          paymentIntentId: intent.id,
          type: 'HOLD_PLACED',
          payloadJson: { triggeredBy: event.eventType, bookingId: p.bookingId },
        },
      });

      await this.outboxService.publish(
        {
          eventType: 'payment.intent.hold_placed',
          payload: {
            paymentIntentId: intent.id,
            bookingId: p.bookingId,
            passengerId: p.passengerId,
            amountKgs,
            pspIntentId,
            status: 'HOLD_PLACED',
            occurredAt: new Date().toISOString(),
          },
          traceId: event.traceId,
        },
        tx,
      );

      recordSagaOutcome('payments', 'hold', 'success');

      this.logger.log({
        msg: 'Payment intent created and hold placed',
        bookingId: p.bookingId,
        paymentIntentId: intent.id,
        traceId: event.traceId,
      });
    }
  }
}
