import { Injectable, Logger } from '@nestjs/common';
import { TripRepository } from '../adapters/db/trip.repository';
import { CityRepository } from '../adapters/db/city.repository';
import { ValidationError } from '../shared/errors';

interface CreateTripInput {
  driverId: string;
  fromCity: string;
  toCity: string;
  departAt: string;
  seatsTotal: number;
  priceKgs: number;
}

interface CreateTripOutput {
  tripId: string;
  driverId: string;
  fromCity: string;
  toCity: string;
  departAt: string;
  seatsTotal: number;
  seatsAvailable: number;
  priceKgs: number;
  status: string;
}

@Injectable()
export class CreateTripUseCase {
  private readonly logger = new Logger(CreateTripUseCase.name);

  constructor(
    private readonly tripRepo: TripRepository,
    private readonly cityRepo: CityRepository,
  ) {}

  async execute(input: CreateTripInput): Promise<CreateTripOutput> {
    const departAt = new Date(input.departAt);
    if (isNaN(departAt.getTime()) || departAt.getTime() <= Date.now()) {
      throw new ValidationError({ departAt: 'departAt must be a valid future date' });
    }

    const [fromCityRecord, toCityRecord] = await Promise.all([
      this.cityRepo.findByName(input.fromCity),
      this.cityRepo.findByName(input.toCity),
    ]);

    const trip = await this.tripRepo.create({
      driverId: input.driverId,
      fromCity: input.fromCity,
      toCity: input.toCity,
      departAt,
      seatsTotal: input.seatsTotal,
      priceKgs: input.priceKgs,
      fromCityId: fromCityRecord?.id,
      toCityId: toCityRecord?.id,
      fromLat: fromCityRecord?.lat,
      fromLon: fromCityRecord?.lon,
      toLat: toCityRecord?.lat,
      toLon: toCityRecord?.lon,
    });

    this.logger.log(`Trip created: tripId=${trip.id} driverId=${trip.driverId}`);

    return {
      tripId: trip.id,
      driverId: trip.driverId,
      fromCity: trip.fromCity,
      toCity: trip.toCity,
      departAt: trip.departAt.toISOString(),
      seatsTotal: trip.seatsTotal,
      seatsAvailable: trip.seatsAvailable,
      priceKgs: trip.priceKgs,
      status: trip.status,
    };
  }
}
