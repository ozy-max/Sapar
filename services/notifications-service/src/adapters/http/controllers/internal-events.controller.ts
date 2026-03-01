import { Controller, Post, Body, Logger, UseGuards, HttpCode } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { ConsumedEventRepository } from '../../db/consumed-event.repository';
import { EventEnvelope } from '../../../shared/event-envelope';
import { EventHandler } from '../../../shared/event-handler.interface';
import { HmacGuard } from '../guards/hmac.guard';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { HandlePaymentHoldPlacedHandler } from '../../../application/handlers/handle-payment-hold-placed.handler';
import { HandlePaymentCapturedHandler } from '../../../application/handlers/handle-payment-captured.handler';
import { recordConsumerEvent } from '../../../observability/outbox-metrics';

const eventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1).max(200),
  payload: z.record(z.unknown()),
  occurredAt: z.string().min(1),
  producer: z.string().min(1),
  traceId: z.string().min(1),
  version: z.number().int().positive(),
});

@Controller('internal/events')
export class InternalEventsController {
  private readonly logger = new Logger(InternalEventsController.name);
  private readonly handlerMap: Map<string, EventHandler>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumedRepo: ConsumedEventRepository,
    paymentHoldPlacedHandler: HandlePaymentHoldPlacedHandler,
    paymentCapturedHandler: HandlePaymentCapturedHandler,
  ) {
    this.handlerMap = new Map<string, EventHandler>([
      [paymentHoldPlacedHandler.eventType, paymentHoldPlacedHandler],
      [paymentCapturedHandler.eventType, paymentCapturedHandler],
    ]);
  }

  @Post()
  @UseGuards(HmacGuard)
  @HttpCode(200)
  async handleEvent(
    @Body(new ZodValidationPipe(eventEnvelopeSchema)) envelope: EventEnvelope,
  ): Promise<{ status: string }> {
    const handler = this.handlerMap.get(envelope.eventType);
    if (!handler) {
      this.logger.debug(`No handler for event type: ${envelope.eventType}`);
      return { status: 'ignored' };
    }

    const existing = await this.consumedRepo.findByEventId(envelope.eventId);
    if (existing) {
      this.logger.log(`Event ${envelope.eventId} already consumed, skipping`);
      recordConsumerEvent(envelope.eventType, 'duplicate');
      return { status: 'duplicate' };
    }

    await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        try {
          await this.consumedRepo.create(
            {
              eventId: envelope.eventId,
              eventType: envelope.eventType,
              producer: envelope.producer,
              traceId: envelope.traceId,
            },
            tx,
          );
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return;
          }
          throw error;
        }

        await handler.handle(envelope, tx);
      },
      { timeout: 15_000 },
    );

    recordConsumerEvent(envelope.eventType, 'processed');
    this.logger.log({
      msg: 'Event consumed',
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      producer: envelope.producer,
      traceId: envelope.traceId,
    });

    return { status: 'processed' };
  }
}
