import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../adapters/db/prisma.service';
import { IdempotencyRepository } from '../adapters/db/idempotency.repository';
import { OutboxService } from '../shared/outbox.service';
import {
  TripNotFoundError,
  TripNotActiveError,
  NotEnoughSeatsError,
  BookingExistsError,
} from '../shared/errors';

interface BookSeatInput {
  tripId: string;
  passengerId: string;
  seats: number;
  idempotencyKey?: string;
  traceId: string;
}

interface BookSeatOutput {
  bookingId: string;
  tripId: string;
  status: string;
}

@Injectable()
export class BookSeatUseCase {
  private readonly logger = new Logger(BookSeatUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencyRepo: IdempotencyRepository,
    private readonly outboxService: OutboxService,
  ) {}

  async execute(input: BookSeatInput): Promise<BookSeatOutput> {
    if (input.idempotencyKey) {
      const existing = await this.idempotencyRepo.findByKeyAndUser(
        input.idempotencyKey,
        input.passengerId,
      );
      if (existing) {
        this.logger.log(`Idempotent hit: key=${input.idempotencyKey} userId=${input.passengerId}`);
        return existing.response as unknown as BookSeatOutput;
      }
    }

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM trips WHERE id = ${input.tripId}::uuid FOR UPDATE`;

          const trip = await tx.trip.findUnique({ where: { id: input.tripId } });
          if (!trip) throw new TripNotFoundError();
          if (trip.status !== 'ACTIVE') throw new TripNotActiveError();
          if (trip.seatsAvailable < input.seats) throw new NotEnoughSeatsError();

          const existingBooking = await tx.booking.findFirst({
            where: {
              tripId: input.tripId,
              passengerId: input.passengerId,
              status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
            },
          });
          if (existingBooking) throw new BookingExistsError();

          const booking = await tx.booking.create({
            data: {
              tripId: input.tripId,
              passengerId: input.passengerId,
              seats: input.seats,
              status: 'PENDING_PAYMENT',
            },
          });

          await tx.trip.update({
            where: { id: input.tripId },
            data: { seatsAvailable: { decrement: input.seats } },
          });

          const output: BookSeatOutput = {
            bookingId: booking.id,
            tripId: booking.tripId,
            status: booking.status,
          };

          if (input.idempotencyKey) {
            await tx.idempotencyRecord.create({
              data: {
                key: input.idempotencyKey,
                userId: input.passengerId,
                response: output as unknown as Prisma.JsonObject,
              },
            });
          }

          const amountKgs = trip.priceKgs * input.seats;
          await this.outboxService.publish(
            {
              eventType: 'booking.created',
              payload: {
                bookingId: booking.id,
                tripId: input.tripId,
                passengerId: input.passengerId,
                seats: input.seats,
                amountKgs,
                currency: 'KGS',
                departAt: trip.departAt.toISOString(),
                createdAt: booking.createdAt.toISOString(),
              },
              traceId: input.traceId,
            },
            tx,
          );

          return output;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: 10_000,
        },
      );

      this.logger.log(
        `Seat booked: bookingId=${result.bookingId} tripId=${input.tripId} passengerId=${input.passengerId}`,
      );

      return result;
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (input.idempotencyKey) {
          const existing = await this.idempotencyRepo.findByKeyAndUser(
            input.idempotencyKey,
            input.passengerId,
          );
          if (existing) {
            return existing.response as unknown as BookSeatOutput;
          }
        }
        throw new BookingExistsError();
      }
      throw error;
    }
  }
}
