import { Injectable } from '@nestjs/common';
import { Booking, BookingStatus } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class BookingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Booking | null> {
    return this.prisma.booking.findUnique({ where: { id } });
  }

  async findActiveByTripAndPassenger(
    tripId: string,
    passengerId: string,
  ): Promise<Booking | null> {
    return this.prisma.booking.findFirst({
      where: { tripId, passengerId, status: BookingStatus.ACTIVE },
    });
  }

  async cancelAllActiveByTripId(
    tripId: string,
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  ): Promise<void> {
    await (tx as unknown as PrismaService).booking.updateMany({
      where: { tripId, status: BookingStatus.ACTIVE },
      data: { status: BookingStatus.CANCELLED },
    });
  }
}
