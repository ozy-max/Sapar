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

  async findByIdForUpdate(id: string, tx: Prisma.TransactionClient): Promise<BookingRow | null> {
    const rows = await tx.$queryRaw<BookingRow[]>`
      SELECT id, trip_id, passenger_id, seats, status, created_at, updated_at
      FROM bookings
      WHERE id = ${id}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async findExpiredPendingIds(
    cutoff: Date,
    limit = 50,
    tx?: Prisma.TransactionClient,
  ): Promise<string[]> {
    const client = tx ?? this.prisma;
    const rows = await client.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bookings
      WHERE status = 'PENDING_PAYMENT'::"BookingStatus"
        AND created_at <= ${cutoff}
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    return rows.map((r) => r.id);
  }

  async findByPassengerId(
    passengerId: string,
    statusFilter?: string,
    limit = 50,
    offset = 0,
  ): Promise<{
    items: (Booking & {
      trip: { fromCity: string; toCity: string; departAt: Date; priceKgs: number };
    })[];
    total: number;
  }> {
    const where: Prisma.BookingWhereInput = { passengerId };
    if (statusFilter) {
      where.status = statusFilter as Booking['status'];
    }

    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: {
          trip: { select: { fromCity: true, toCity: true, departAt: true, priceKgs: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.booking.count({ where }),
    ]);

    return { items, total };
  }

  async findByIdWithTrip(id: string): Promise<
    | (Booking & {
        trip: {
          id: string;
          driverId: string;
          fromCity: string;
          toCity: string;
          departAt: Date;
          seatsTotal: number;
          seatsAvailable: number;
          priceKgs: number;
          status: string;
        };
      })
    | null
  > {
    return this.prisma.booking.findUnique({
      where: { id },
      include: {
        trip: {
          select: {
            id: true,
            driverId: true,
            fromCity: true,
            toCity: true,
            departAt: true,
            seatsTotal: true,
            seatsAvailable: true,
            priceKgs: true,
            status: true,
          },
        },
      },
    });
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
