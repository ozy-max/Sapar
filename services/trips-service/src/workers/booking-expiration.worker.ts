import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../adapters/db/prisma.service';
import { BookingRepository, BookingRow } from '../adapters/db/booking.repository';
import { OutboxService } from '../shared/outbox.service';
import { loadEnv } from '../config/env';
import { recordBookingExpired, recordBookingTransition } from '../observability/saga-metrics';

@Injectable()
export class BookingExpirationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingExpirationWorker.name);
  private intervalHandle?: ReturnType<typeof setInterval>;
  private currentTick?: Promise<void>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingRepo: BookingRepository,
    private readonly outboxService: OutboxService,
  ) {}

  onModuleInit(): void {
    const env = loadEnv();
    if (env.NODE_ENV === 'test') {
      this.logger.log('Expiration worker disabled in test environment');
      return;
    }
    this.logger.log(
      `Starting expiration worker, interval: ${env.EXPIRATION_WORKER_INTERVAL_MS}ms, TTL: ${env.BOOKING_TTL_SEC}s`,
    );
    this.intervalHandle = setInterval(() => {
      this.currentTick = this.tick();
    }, env.EXPIRATION_WORKER_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    if (this.currentTick) await this.currentTick;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const env = loadEnv();
      const cutoff = new Date(Date.now() - env.BOOKING_TTL_SEC * 1000);
      const ids = await this.bookingRepo.findExpiredPendingIds(cutoff);

      for (const id of ids) {
        try {
          await this.expireBooking(id);
        } catch (error) {
          this.logger.error(error, `Failed to expire booking ${id}`);
        }
      }
    } catch (error) {
      this.logger.error(error, 'Expiration worker tick failed');
    } finally {
      this.running = false;
    }
  }

  private async expireBooking(bookingId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
        SELECT id FROM trips
        WHERE id = (SELECT trip_id FROM bookings WHERE id = ${bookingId}::uuid)
        FOR UPDATE
      `;

        const locked = await tx.$queryRaw<BookingRow[]>`
        SELECT id, trip_id, passenger_id, seats, status, created_at, updated_at
        FROM bookings
        WHERE id = ${bookingId}::uuid
          AND status = 'PENDING_PAYMENT'::"BookingStatus"
        FOR UPDATE SKIP LOCKED
      `;
        const row = locked[0];
        if (!row) return;

        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'EXPIRED' },
        });

        await tx.$executeRaw`
        UPDATE trips SET seats_available = seats_available + ${row.seats}
        WHERE id = ${row.trip_id}::uuid
      `;

        await this.outboxService.publish(
          {
            eventType: 'booking.expired',
            payload: {
              bookingId: row.id,
              tripId: row.trip_id,
              passengerId: row.passenger_id,
              seats: row.seats,
              reason: 'EXPIRED',
            },
            traceId: randomUUID(),
          },
          tx,
        );
      },
      { timeout: 10_000 },
    );

    recordBookingExpired();
    recordBookingTransition('PENDING_PAYMENT', 'EXPIRED');
    this.logger.log({ msg: 'Booking expired', bookingId });
  }
}
