import {
  Controller,
  Post,
  Body,
  Logger,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { ConsumedEventRepository } from '../../db/consumed-event.repository';
import { EventEnvelope } from '../../../shared/event-envelope';
import { EventHandler } from '../../../shared/event-handler.interface';
import { HmacGuard } from '../guards/hmac.guard';
import { HandlePaymentHoldPlacedHandler } from '../../../application/handlers/handle-payment-hold-placed.handler';
import { recordConsumerEvent } from '../../../observability/outbox-metrics';

@Controller('internal/events')
export class InternalEventsController {
  private readonly logger = new Logger(InternalEventsController.name);
  private readonly handlerMap: Map<string, EventHandler>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumedRepo: ConsumedEventRepository,
    paymentHoldPlacedHandler: HandlePaymentHoldPlacedHandler,
  ) {
    this.handlerMap = new Map<string, EventHandler>([
      [paymentHoldPlacedHandler.eventType, paymentHoldPlacedHandler],
    ]);
  }

  @Post()
  @UseGuards(HmacGuard)
  @HttpCode(200)
  async handleEvent(@Body() envelope: EventEnvelope): Promise<{ status: string }> {
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

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const exists = await this.consumedRepo.existsInTx(envelope.eventId, tx);
      if (exists) return;

      await handler.handle(envelope, tx);

      await this.consumedRepo.create(
        {
          eventId: envelope.eventId,
          eventType: envelope.eventType,
          producer: envelope.producer,
          traceId: envelope.traceId,
        },
        tx,
      );
    });

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
