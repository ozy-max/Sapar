import { Injectable } from '@nestjs/common';
import { Booking, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface BookingRow {
  id: string;
  trip_id: string;
  passenger_id: string;
  seats: number;
  status: string;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class BookingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Booking | null> {
    return this.prisma.booking.findUnique({ where: { id } });
  }

  async findNonTerminalByTripAndPassenger(
    tripId: string,
    passengerId: string,
  ): Promise<Booking | null> {
    return this.prisma.booking.findFirst({
      where: {
        tripId,
        passengerId,
        status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
      },
    });
  }

  async findByIdForUpdate(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<BookingRow | null> {
    const rows = await tx.$queryRaw<BookingRow[]>`
      SELECT id, trip_id, passenger_id, seats, status, created_at, updated_at
      FROM bookings
      WHERE id = ${id}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async findExpiredPendingIds(cutoff: Date, limit = 50): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bookings
      WHERE status = 'PENDING_PAYMENT'::"BookingStatus"
        AND created_at <= ${cutoff}
      ORDER BY created_at
      LIMIT ${limit}
    `;
    return rows.map((r) => r.id);
  }

  async cancelAllNonTerminalByTripId(
    tripId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await tx.booking.updateMany({
      where: {
        tripId,
        status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
      },
      data: { status: 'CANCELLED' },
    });
    return result.count;
  }
}
