import { Injectable } from '@nestjs/common';
import { Trip, TripStatus } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface SearchTripsParams {
  fromCity?: string;
  toCity?: string;
  fromCityId?: string;
  toCityId?: string;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
  radiusKm: number;
  bboxMinLat?: number;
  bboxMinLon?: number;
  bboxMaxLat?: number;
  bboxMaxLon?: number;
  dateFrom?: Date;
  dateTo?: Date;
  minSeats: number;
  priceMin?: number;
  priceMax?: number;
  limit: number;
  offset: number;
}

interface RawTripRow {
  id: string;
  driver_id: string;
  from_city: string;
  to_city: string;
  from_city_id: string | null;
  to_city_id: string | null;
  from_lat: number | null;
  from_lon: number | null;
  to_lat: number | null;
  to_lon: number | null;
  depart_at: Date;
  seats_total: number;
  seats_available: number;
  price_kgs: number;
  status: string;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function rawToTrip(r: RawTripRow): Trip {
  return {
    id: r.id,
    driverId: r.driver_id,
    fromCity: r.from_city,
    toCity: r.to_city,
    fromCityId: r.from_city_id,
    toCityId: r.to_city_id,
    fromLat: r.from_lat,
    fromLon: r.from_lon,
    toLat: r.to_lat,
    toLon: r.to_lon,
    departAt: r.depart_at,
    seatsTotal: r.seats_total,
    seatsAvailable: r.seats_available,
    priceKgs: r.price_kgs,
    status: r.status as TripStatus,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface CountRow {
  count: bigint;
}

interface GeoConditions {
  conditions: string[];
  values: unknown[];
  nextIdx: number;
}

/**
 * Builds WHERE conditions for geo-aware search.
 *
 * EXPLAIN/index usage notes:
 * - fromCityId/toCityId -> btree idx trips_from_city_id_to_city_id_depart_at_idx
 * - fromLat/fromLon + radius -> GiST trips_from_coords_idx via earth_box @> ll_to_earth
 *   (two-step: bounding box containment for index, then exact distance filter)
 * - bbox search -> sequential scan on lat/lon range (acceptable for MVP)
 * - fromCity/toCity string -> btree trips_from_city_to_city_depart_at_idx
 */
function buildGeoConditions(
  params: Omit<SearchTripsParams, 'limit' | 'offset'>,
  startIdx: number,
): GeoConditions {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = startIdx;

  if (params.fromCityId) {
    conditions.push(`t."from_city_id" = $${idx}::uuid`);
    values.push(params.fromCityId);
    idx++;
  } else if (params.fromLat != null && params.fromLon != null) {
    const radiusMeters = (params.radiusKm ?? 25) * 1000;
    conditions.push(
      `earth_box(ll_to_earth($${idx}, $${idx + 1}), $${idx + 2}) @> ll_to_earth(t."from_lat", t."from_lon")`,
    );
    conditions.push(
      `earth_distance(ll_to_earth($${idx}, $${idx + 1}), ll_to_earth(t."from_lat", t."from_lon")) <= $${idx + 2}`,
    );
    values.push(params.fromLat, params.fromLon, radiusMeters);
    idx += 3;
  } else if (params.fromCity) {
    conditions.push(`lower(t."from_city") = lower($${idx})`);
    values.push(params.fromCity);
    idx++;
  }

  if (params.toCityId) {
    conditions.push(`t."to_city_id" = $${idx}::uuid`);
    values.push(params.toCityId);
    idx++;
  } else if (params.toLat != null && params.toLon != null) {
    const radiusMeters = (params.radiusKm ?? 25) * 1000;
    conditions.push(
      `earth_box(ll_to_earth($${idx}, $${idx + 1}), $${idx + 2}) @> ll_to_earth(t."to_lat", t."to_lon")`,
    );
    conditions.push(
      `earth_distance(ll_to_earth($${idx}, $${idx + 1}), ll_to_earth(t."to_lat", t."to_lon")) <= $${idx + 2}`,
    );
    values.push(params.toLat, params.toLon, radiusMeters);
    idx += 3;
  } else if (params.toCity) {
    conditions.push(`lower(t."to_city") = lower($${idx})`);
    values.push(params.toCity);
    idx++;
  }

  if (
    params.bboxMinLat != null &&
    params.bboxMinLon != null &&
    params.bboxMaxLat != null &&
    params.bboxMaxLon != null
  ) {
    conditions.push(`t."from_lat" BETWEEN $${idx} AND $${idx + 1}`);
    conditions.push(`t."from_lon" BETWEEN $${idx + 2} AND $${idx + 3}`);
    values.push(params.bboxMinLat, params.bboxMaxLat, params.bboxMinLon, params.bboxMaxLon);
    idx += 4;
  }

  if (params.dateFrom) {
    conditions.push(`t."depart_at" >= $${idx}`);
    values.push(params.dateFrom);
    idx++;
  }
  if (params.dateTo) {
    conditions.push(`t."depart_at" <= $${idx}`);
    values.push(params.dateTo);
    idx++;
  }

  if (params.priceMin != null) {
    conditions.push(`t."price_kgs" >= $${idx}`);
    values.push(params.priceMin);
    idx++;
  }
  if (params.priceMax != null) {
    conditions.push(`t."price_kgs" <= $${idx}`);
    values.push(params.priceMax);
    idx++;
  }

  return { conditions, values, nextIdx: idx };
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
    fromCityId?: string;
    toCityId?: string;
    fromLat?: number;
    fromLon?: number;
    toLat?: number;
    toLon?: number;
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
        fromCityId: data.fromCityId,
        toCityId: data.toCityId,
        fromLat: data.fromLat,
        fromLon: data.fromLon,
        toLat: data.toLat,
        toLon: data.toLon,
      },
    });
  }

  async findById(id: string): Promise<Trip | null> {
    return this.prisma.trip.findUnique({ where: { id } });
  }

  async search(params: SearchTripsParams): Promise<Trip[]> {
    // $1 = minSeats, geo conditions start at $2
    const geo = buildGeoConditions(params, 2);
    const whereClause = geo.conditions.length > 0 ? `AND ${geo.conditions.join(' AND ')}` : '';

    // LIMIT and OFFSET are the last two params
    const limitIdx = geo.nextIdx;
    const offsetIdx = geo.nextIdx + 1;

    const sql = `
      SELECT t.*
      FROM "trips" t
      WHERE t."status" = 'ACTIVE'
        AND t."seats_available" >= $1
        ${whereClause}
      ORDER BY t."depart_at" ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const allValues = [params.minSeats, ...geo.values, params.limit, params.offset];
    const rows = await this.prisma.$queryRawUnsafe<RawTripRow[]>(sql, ...allValues);
    return rows.map(rawToTrip);
  }

  async searchCount(params: Omit<SearchTripsParams, 'limit' | 'offset'>): Promise<number> {
    // $1 = minSeats, geo conditions start at $2
    const geo = buildGeoConditions(params, 2);
    const whereClause = geo.conditions.length > 0 ? `AND ${geo.conditions.join(' AND ')}` : '';

    const sql = `
      SELECT COUNT(*)::bigint as count
      FROM "trips" t
      WHERE t."status" = 'ACTIVE'
        AND t."seats_available" >= $1
        ${whereClause}
    `;

    const allValues = [params.minSeats, ...geo.values];
    const rows = await this.prisma.$queryRawUnsafe<CountRow[]>(sql, ...allValues);
    return Number(rows[0]?.count ?? 0);
  }

  async updateStatus(id: string, status: TripStatus): Promise<Trip> {
    return this.prisma.trip.update({
      where: { id },
      data: { status },
    });
  }
}
