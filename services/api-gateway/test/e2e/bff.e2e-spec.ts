import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { createTestApp } from './helpers/test-app';
import { createMockDownstream, MockDownstream } from './helpers/mock-downstream';
import { resetEnvCache } from '../../src/config/env';
import { resetSharedDispatcher } from '../../src/adapters/http/proxy/http-client';

const TRIPS_PORT = 19102;
const PAYMENTS_PORT = 19103;

const TRIP_UUID = '11111111-1111-1111-1111-111111111111';
const BOOKING_UUID = '22222222-2222-2222-2222-222222222222';
const DRIVER_UUID = '33333333-3333-3333-3333-333333333333';

beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgresql://x:x@localhost:5432/test';
  process.env['IDENTITY_BASE_URL'] = 'http://127.0.0.1:19101';
  process.env['TRIPS_BASE_URL'] = `http://127.0.0.1:${TRIPS_PORT}`;
  process.env['PAYMENTS_BASE_URL'] = `http://127.0.0.1:${PAYMENTS_PORT}`;
  process.env['ADMIN_BASE_URL'] = 'http://127.0.0.1:19105';
  process.env['HTTP_TIMEOUT_MS'] = '3000';
  process.env['BFF_TIMEOUT_MS'] = '2500';
  process.env['MAX_BODY_BYTES'] = '1048576';
  resetEnvCache();
  resetSharedDispatcher();
});

describe('BFF v1 endpoints', () => {
  let app: INestApplication;
  let tripsDs: MockDownstream;
  let paymentsDs: MockDownstream;

  beforeAll(async () => {
    tripsDs = await createMockDownstream(TRIPS_PORT);
    paymentsDs = await createMockDownstream(PAYMENTS_PORT);
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await tripsDs?.close();
    await paymentsDs?.close();
  });

  beforeEach(() => {
    tripsDs.lastRequest = null;
    paymentsDs.lastRequest = null;
    tripsDs.handler = defaultTripsHandler;
    paymentsDs.handler = defaultPaymentsHandler;
  });

  /* ── 1) Trips Search: stable envelope and correct mapping ── */

  it('GET /v1/trips/search returns stable envelope', async () => {
    tripsDs.handler = (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          items: [
            {
              tripId: TRIP_UUID,
              driverId: DRIVER_UUID,
              fromCity: 'Бишкек',
              toCity: 'Ош',
              departAt: '2026-06-15T08:00:00.000Z',
              seatsTotal: 4,
              seatsAvailable: 3,
              priceKgs: 1500,
              status: 'ACTIVE',
            },
          ],
          count: 1,
        }),
      );
    };

    const res = await request(app.getHttpServer())
      .get('/v1/trips/search?fromCity=Бишкек&toCity=Ош')
      .set('x-request-id', 'trace-1')
      .expect(200);

    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('paging');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta.traceId).toBe('trace-1');

    const card = res.body.items[0];
    expect(card.tripId).toBe(TRIP_UUID);
    expect(card.fromCity).toBe('Бишкек');
    expect(card.toCity).toBe('Ош');
    expect(card.priceKgs).toBe(1500);
    expect(card.seatsAvailable).toBe(3);
    expect(card.status).toBe('ACTIVE');

    expect(res.body.paging.limit).toBe(20);
    expect(res.body.paging.offset).toBe(0);
    expect(res.body.paging.total).toBe(1);
  });

  /* ── 2) Booking Details: aggregates trips + payments ── */

  it('GET /v1/bookings/:id aggregates booking + payment', async () => {
    tripsDs.handler = (req: IncomingMessage, res: ServerResponse) => {
      if (req.url?.startsWith('/bff/bookings/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            bookingId: BOOKING_UUID,
            tripId: TRIP_UUID,
            passengerId: 'pass-1',
            seats: 2,
            status: 'CONFIRMED',
            createdAt: '2026-06-14T10:00:00.000Z',
            updatedAt: '2026-06-14T10:05:00.000Z',
            trip: {
              tripId: TRIP_UUID,
              driverId: DRIVER_UUID,
              fromCity: 'Бишкек',
              toCity: 'Ош',
              departAt: '2026-06-15T08:00:00.000Z',
              seatsTotal: 4,
              seatsAvailable: 2,
              priceKgs: 1500,
              status: 'ACTIVE',
            },
          }),
        );
        return;
      }
      defaultTripsHandler(req, res);
    };

    paymentsDs.handler = (req: IncomingMessage, res: ServerResponse) => {
      if (req.url?.startsWith('/bff/bookings/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            bookingId: BOOKING_UUID,
            paymentIntentId: 'pi-1',
            paymentStatus: 'HOLD_PLACED',
            amountKgs: 3000,
            receiptStatus: null,
          }),
        );
        return;
      }
      defaultPaymentsHandler(req, res);
    };

    const res = await request(app.getHttpServer())
      .get(`/v1/bookings/${BOOKING_UUID}`)
      .set('x-request-id', 'trace-2')
      .set('authorization', 'Bearer test-jwt-token')
      .expect(200);

    expect(res.body.bookingId).toBe(BOOKING_UUID);
    expect(res.body.status).toBe('CONFIRMED');
    expect(res.body.trip.fromCity).toBe('Бишкек');
    expect(res.body.payment.paymentStatus).toBe('HOLD_PLACED');
    expect(res.body.payment.amountKgs).toBe(3000);
    expect(res.body.meta.traceId).toBe('trace-2');
  });

  /* ── 3) My Bookings: batch payment summary ── */

  it('GET /v1/me/bookings returns items with payment summary via batch', async () => {
    tripsDs.handler = (req: IncomingMessage, res: ServerResponse) => {
      if (req.url?.startsWith('/bff/me/bookings')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            items: [
              {
                bookingId: BOOKING_UUID,
                tripId: TRIP_UUID,
                seats: 1,
                status: 'CONFIRMED',
                createdAt: '2026-06-14T10:00:00.000Z',
                trip: {
                  fromCity: 'Бишкек',
                  toCity: 'Ош',
                  departAt: '2026-06-15T08:00:00.000Z',
                  priceKgs: 1500,
                },
              },
            ],
            total: 1,
          }),
        );
        return;
      }
      defaultTripsHandler(req, res);
    };

    paymentsDs.handler = (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/bff/payments/summary' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            items: [
              {
                bookingId: BOOKING_UUID,
                paymentIntentId: 'pi-2',
                paymentStatus: 'CAPTURED',
                amountKgs: 1500,
                receiptStatus: 'ISSUED',
              },
            ],
          }),
        );
        return;
      }
      defaultPaymentsHandler(req, res);
    };

    const res = await request(app.getHttpServer())
      .get('/v1/me/bookings')
      .set('x-request-id', 'trace-3')
      .set('authorization', 'Bearer fake-jwt-token')
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].bookingId).toBe(BOOKING_UUID);
    expect(res.body.items[0].payment.paymentStatus).toBe('CAPTURED');
    expect(res.body.items[0].payment.receiptStatus).toBe('ISSUED');
    expect(res.body.paging.total).toBe(1);
    expect(res.body.meta.traceId).toBe('trace-3');
  });

  /* ── 4) Downstream error → unified error with traceId ── */

  it('downstream 404 → unified 404 with traceId', async () => {
    tripsDs.handler = (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'TRIP_NOT_FOUND', message: 'Trip not found', traceId: 'x' }));
    };

    const res = await request(app.getHttpServer())
      .get(`/v1/trips/${TRIP_UUID}`)
      .set('x-request-id', 'trace-4')
      .expect(404);

    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.traceId).toBe('trace-4');
  });

  it('downstream 500 → unified 502 BAD_GATEWAY with traceId', async () => {
    tripsDs.handler = (_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'INTERNAL_ERROR', message: 'boom' }));
    };

    const res = await request(app.getHttpServer())
      .get(`/v1/trips/${TRIP_UUID}`)
      .set('x-request-id', 'trace-5')
      .expect(502);

    expect(res.body.code).toBe('BAD_GATEWAY');
    expect(res.body.traceId).toBe('trace-5');
  });

  /* ── 5) Timeout → unified 504 with traceId ── */

  it('downstream timeout → 504 GATEWAY_TIMEOUT with traceId', async () => {
    process.env['BFF_TIMEOUT_MS'] = '200';
    resetEnvCache();

    tripsDs.handler = (_req: IncomingMessage, _res: ServerResponse) => {
      // Never respond → triggers timeout
    };

    const res = await request(app.getHttpServer())
      .get(`/v1/trips/${TRIP_UUID}`)
      .set('x-request-id', 'trace-6')
      .expect(504);

    expect(res.body.code).toBe('DOWNSTREAM_TIMEOUT');
    expect(res.body.traceId).toBe('trace-6');

    process.env['BFF_TIMEOUT_MS'] = '2500';
    resetEnvCache();
  });

  /* ── 6) Auth & input validation ── */

  it('GET /v1/me/bookings without Authorization → 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/me/bookings')
      .set('x-request-id', 'trace-noauth-1');

    expect(res.status).toBe(401);
    expect(res.body.code).toBeDefined();
    expect(res.body.traceId).toBe('trace-noauth-1');
  });

  it('GET /v1/me/bookings with non-Bearer Authorization → 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/me/bookings')
      .set('x-request-id', 'trace-noauth-2')
      .set('authorization', 'Basic dXNlcjpwYXNz');

    expect(res.status).toBe(401);
    expect(res.body.code).toBeDefined();
    expect(res.body.traceId).toBe('trace-noauth-2');
  });

  it('GET /v1/bookings/:bookingId with non-UUID bookingId → 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/bookings/not-a-uuid')
      .set('x-request-id', 'trace-baduuid-1');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.traceId).toBe('trace-baduuid-1');
  });

  it('GET /v1/trips/:tripId with path traversal attempt → 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/trips/../../admin')
      .set('x-request-id', 'trace-traversal-1');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.traceId).toBe('trace-traversal-1');
  });
});

/* ── Default handlers ── */

function defaultTripsHandler(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

function defaultPaymentsHandler(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}
