import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../adapters/db/prisma.service';
import { PaymentIntentRepository } from '../adapters/db/payment-intent.repository';
import { PaymentEventRepository } from '../adapters/db/payment-event.repository';
import { OutboxService } from '../shared/outbox.service';
import { PSP_ADAPTER, PspAdapter } from '../adapters/psp/psp.interface';
import { loadEnv } from '../config/env';
import { withTimeout } from '../shared/psp-timeout';
import {
  IdempotencyConflictError,
  PspUnavailableError,
  InvalidPaymentStateError,
} from '../shared/errors';

export interface CreateIntentInput {
  bookingId: string;
  amountKgs: number;
  payerId: string;
  idempotencyKey?: string;
  traceId: string;
}

export interface CreateIntentOutput {
  paymentIntentId: string;
  status: string;
  bookingId: string;
}

@Injectable()
export class CreateIntentUseCase {
  private readonly logger = new Logger(CreateIntentUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intentRepo: PaymentIntentRepository,
    private readonly eventRepo: PaymentEventRepository,
    private readonly outboxService: OutboxService,
    @Inject(PSP_ADAPTER) private readonly psp: PspAdapter,
  ) {}

  async execute(input: CreateIntentInput): Promise<CreateIntentOutput> {
    const env = loadEnv();

    if (input.idempotencyKey) {
      const existing = await this.intentRepo.findByIdempotencyKey(
        input.idempotencyKey,
        input.payerId,
      );
      if (existing) {
        if (
          existing.bookingId !== input.bookingId ||
          existing.amountKgs !== input.amountKgs
        ) {
          throw new IdempotencyConflictError();
        }
        return {
          paymentIntentId: existing.id,
          status: existing.status,
          bookingId: existing.bookingId,
        };
      }
    }

    const intent = await this.intentRepo.create({
      bookingId: input.bookingId,
      payerId: input.payerId,
      amountKgs: input.amountKgs,
      currency: 'KGS',
      idempotencyKey: input.idempotencyKey,
    });

    let pspIntentId: string;
    try {
      const result = await withTimeout(
        this.psp.placeHold(input.amountKgs, 'KGS', {
          bookingId: input.bookingId,
          payerId: input.payerId,
        }),
        env.PSP_TIMEOUT_MS,
      );
      pspIntentId = result.pspIntentId;
    } catch (error) {
      this.logger.error(error, 'PSP placeHold failed, marking intent as FAILED');
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.intentRepo.updateStatus(intent.id, 'FAILED', tx);
          await this.eventRepo.create(
            {
              paymentIntentId: intent.id,
              type: 'FAILED',
              payloadJson: { reason: String(error) },
            },
            tx,
          );
        });
      } catch (dbErr) {
        this.logger.error(dbErr, 'Failed to mark intent as FAILED after PSP error');
      }
      throw new PspUnavailableError();
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.intentRepo.findByIdForUpdate(intent.id, tx);
      if (!row || row.status !== 'CREATED') {
        throw new InvalidPaymentStateError('Intent state changed concurrently');
      }

      const result = await this.intentRepo.updateStatus(intent.id, 'HOLD_PLACED', tx, {
        pspIntentId,
      });

      await this.eventRepo.create(
        {
          paymentIntentId: intent.id,
          type: 'HOLD_PLACED',
          payloadJson: { pspIntentId },
        },
        tx,
      );

      await this.outboxService.publish(
        {
          eventType: 'payment.intent.hold_placed',
          payload: {
            paymentIntentId: intent.id,
            bookingId: input.bookingId,
            passengerId: input.payerId,
            amountKgs: input.amountKgs,
          },
          traceId: input.traceId,
        },
        tx,
      );

      return result;
    });

    return {
      paymentIntentId: updated.id,
      status: updated.status,
      bookingId: updated.bookingId,
    };
  }
}
