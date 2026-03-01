import { Injectable } from '@nestjs/common';
import { Trip, TripStatus, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface SearchTripsParams {
  fromCity: string;
  toCity: string;
  dateFrom?: Date;
  dateTo?: Date;
  minSeats: number;
  limit: number;
  offset: number;
}

@Injectable()
export class TripRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    driverId: string;
    fromCity: string;
    toCity: string;
    departAt: Date;
    seatsTotal: number;
    priceKgs: number;
  }): Promise<Trip> {
    return this.prisma.trip.create({
      data: {
        driverId: data.driverId,
        fromCity: data.fromCity,
        toCity: data.toCity,
        departAt: data.departAt,
        seatsTotal: data.seatsTotal,
        seatsAvailable: data.seatsTotal,
        priceKgs: data.priceKgs,
        status: TripStatus.ACTIVE,
      },
    });
  }

  async findById(id: string): Promise<Trip | null> {
    return this.prisma.trip.findUnique({ where: { id } });
  }

  async search(params: SearchTripsParams): Promise<Trip[]> {
    const where: Prisma.TripWhereInput = {
      fromCity: { equals: params.fromCity, mode: 'insensitive' },
      toCity: { equals: params.toCity, mode: 'insensitive' },
      status: TripStatus.ACTIVE,
      seatsAvailable: { gte: params.minSeats },
    };

    if (params.dateFrom || params.dateTo) {
      where.departAt = {};
      if (params.dateFrom) where.departAt.gte = params.dateFrom;
      if (params.dateTo) where.departAt.lte = params.dateTo;
    }

    return this.prisma.trip.findMany({
      where,
      orderBy: { departAt: 'asc' },
      take: params.limit,
      skip: params.offset,
    });
  }

  async searchCount(params: Omit<SearchTripsParams, 'limit' | 'offset'>): Promise<number> {
    const where: Prisma.TripWhereInput = {
      fromCity: { equals: params.fromCity, mode: 'insensitive' },
      toCity: { equals: params.toCity, mode: 'insensitive' },
      status: TripStatus.ACTIVE,
      seatsAvailable: { gte: params.minSeats },
    };

    if (params.dateFrom || params.dateTo) {
      where.departAt = {};
      if (params.dateFrom) where.departAt.gte = params.dateFrom;
      if (params.dateTo) where.departAt.lte = params.dateTo;
    }

    return this.prisma.trip.count({ where });
  }

  async updateStatus(id: string, status: TripStatus): Promise<Trip> {
    return this.prisma.trip.update({
      where: { id },
      data: { status },
    });
  }
}
