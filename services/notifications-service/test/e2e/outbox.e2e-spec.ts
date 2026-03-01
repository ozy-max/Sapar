import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/adapters/http/filters/all-exceptions.filter';
import { requestIdMiddleware } from '../../src/adapters/http/middleware/request-id.middleware';
import { PrismaService } from '../../src/adapters/db/prisma.service';
import { signEvent } from '../../src/shared/hmac';
import { EventEnvelope } from '../../src/shared/event-envelope';

const HMAC_SECRET = 'test-hmac-secret-at-least-32-characters-long!!';

function makeHoldPlacedEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: randomUUID(),
    eventType: 'payment.intent.hold_placed',
    occurredAt: new Date().toISOString(),
    producer: 'payments-service',
    traceId: randomUUID(),
    payload: {
      paymentIntentId: randomUUID(),
      bookingId: randomUUID(),
      passengerId: randomUUID(),
      amountKgs: 2000,
    },
    version: 1,
    ...overrides,
  };
}

function signedHeaders(body: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signEvent(body, timestamp, HMAC_SECRET);
  return {
    'Content-Type': 'application/json',
    'X-Event-Signature': signature,
    'X-Event-Timestamp': String(timestamp),
  };
}

describe('Outbox + Consumer E2E — notifications-service', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env['EVENTS_HMAC_SECRET'] = HMAC_SECRET;
    process.env['OUTBOX_TARGETS'] = '';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.use(requestIdMiddleware);
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.consumedEvent.deleteMany();
    await prisma.notificationEvent.deleteMany();
    await prisma.notification.deleteMany();
  });

  // ─── 1) Consumer processes payment.intent.hold_placed ───
  it('should consume payment.intent.hold_placed and enqueue notification', async () => {
    const envelope = makeHoldPlacedEnvelope();
    const body = JSON.stringify(envelope);

    const res = await request(app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    expect(res.body.status).toBe('processed');

    const consumed = await prisma.consumedEvent.findUnique({
      where: { eventId: envelope.eventId },
    });
    expect(consumed).not.toBeNull();

    const notifications = await prisma.notification.findMany();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.status).toBe('PENDING');
    expect(notifications[0]!.templateKey).toBe('PAYMENT_HOLD_PLACED');
    expect(notifications[0]!.channel).toBe('PUSH');
  });

  // ─── 2) Consumer idempotency ───
  it('should return duplicate for repeated event', async () => {
    const envelope = makeHoldPlacedEnvelope();
    const body = JSON.stringify(envelope);

    await request(app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    const res2 = await request(app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    expect(res2.body.status).toBe('duplicate');

    const notifications = await prisma.notification.findMany();
    expect(notifications).toHaveLength(1);
  });

  // ─── 3) HMAC rejects invalid signature ───
  it('should reject invalid HMAC', async () => {
    const envelope = makeHoldPlacedEnvelope();
    const timestamp = Math.floor(Date.now() / 1000);

    await request(app.getHttpServer())
      .post('/internal/events')
      .set({
        'Content-Type': 'application/json',
        'X-Event-Signature': 'bad-sig',
        'X-Event-Timestamp': String(timestamp),
      })
      .send(envelope)
      .expect(401);
  });

  // ─── 4) traceId propagation ───
  it('should store traceId in consumed event', async () => {
    const traceId = 'notif-trace-propagation-test-123';
    const envelope = makeHoldPlacedEnvelope({ traceId });
    const body = JSON.stringify(envelope);

    await request(app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    const consumed = await prisma.consumedEvent.findUnique({
      where: { eventId: envelope.eventId },
    });
    expect(consumed!.traceId).toBe(traceId);
  });

  // ─── 5) Unknown event type ignored ───
  it('should ignore unknown event types', async () => {
    const envelope = makeHoldPlacedEnvelope({ eventType: 'unknown.type' });
    const body = JSON.stringify(envelope);

    const res = await request(app.getHttpServer())
      .post('/internal/events')
      .set(signedHeaders(body))
      .send(envelope)
      .expect(200);

    expect(res.body.status).toBe('ignored');
  });
});
