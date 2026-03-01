import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../adapters/db/prisma.service';
import { BookingRepository } from '../adapters/db/booking.repository';
import { TripRepository } from '../adapters/db/trip.repository';
import { OutboxService } from '../shared/outbox.service';
import {
  BookingNotFoundError,
  BookingNotActiveError,
  ForbiddenError,
  TripNotFoundError,
} from '../shared/errors';

interface CancelBookingInput {
  bookingId: string;
  userId: string;
  traceId: string;
}

interface CancelBookingOutput {
  bookingId: string;
  status: string;
}

const CANCELLABLE_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED'];

@Injectable()
export class CancelBookingUseCase {
  private readonly logger = new Logger(CancelBookingUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingRepo: BookingRepository,
    private readonly tripRepo: TripRepository,
    private readonly outboxService: OutboxService,
  ) {}

  async execute(input: CancelBookingInput): Promise<CancelBookingOutput> {
    const booking = await this.bookingRepo.findById(input.bookingId);
    if (!booking) throw new BookingNotFoundError();

    const trip = await this.tripRepo.findById(booking.tripId);
    if (!trip) throw new TripNotFoundError();

    if (booking.passengerId !== input.userId && trip.driverId !== input.userId) {
      throw new ForbiddenError();
    }

    if (!CANCELLABLE_STATUSES.includes(booking.status)) throw new BookingNotActiveError();

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM trips WHERE id = ${booking.tripId}::uuid FOR UPDATE`;

        const freshBooking = await tx.booking.findUnique({ where: { id: input.bookingId } });
        if (!freshBooking || !CANCELLABLE_STATUSES.includes(freshBooking.status)) {
          throw new BookingNotActiveError();
        }

        await tx.booking.update({
          where: { id: input.bookingId },
          data: { status: 'CANCELLED' },
        });

        await tx.trip.update({
          where: { id: booking.tripId },
          data: { seatsAvailable: { increment: freshBooking.seats } },
        });

        await this.outboxService.publish(
          {
            eventType: 'booking.cancelled',
            payload: {
              bookingId: input.bookingId,
              tripId: booking.tripId,
              passengerId: booking.passengerId,
              seats: freshBooking.seats,
              reason: 'USER_CANCELLED',
            },
            traceId: input.traceId,
          },
          tx,
        );
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 10_000,
      },
    );

    this.logger.log(
      `Booking cancelled: bookingId=${input.bookingId} by userId=${input.userId}`,
    );

    return { bookingId: input.bookingId, status: 'CANCELLED' };
  }
}
