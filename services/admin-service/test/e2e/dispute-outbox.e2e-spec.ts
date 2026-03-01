import request from 'supertest';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { resetEnvCache } from '../../src/config/env';
import { ADMIN_AUTH, ADMIN_USER_ID } from './helpers/jwt';

describe('Dispute Resolution Outbox (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    resetEnvCache();
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanDatabase(ctx.prisma);
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);
  });

  async function createDispute(bookingId: string): Promise<string> {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await request(ctx.app.getHttpServer())
      .post('/disputes')
      .set('Authorization', ADMIN_AUTH)
      .set('X-Request-Id', 'trace-dispute')
      .send({
        type: 'NO_SHOW',
        bookingId,
        departAt: futureDate,
        evidenceUrls: [],
      });
    return res.body.id;
  }

  it('should emit dispute.resolved outbox event on REFUND resolution', async () => {
    const disputeId = await createDispute('00000000-0000-4000-b000-000000000001');

    await request(ctx.app.getHttpServer())
      .post(`/disputes/${disputeId}/resolve`)
      .set('Authorization', ADMIN_AUTH)
      .set('X-Request-Id', 'trace-resolve-refund')
      .send({ resolution: 'REFUND' });

    const events = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'dispute.resolved' },
    });

    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('PENDING');

    const payload = events[0].payloadJson as Record<string, unknown>;
    expect(payload['disputeId']).toBe(disputeId);
    expect(payload['bookingId']).toBe('00000000-0000-4000-b000-000000000001');
    expect(payload['resolution']).toBe('REFUND');
    expect(events[0].traceId).toBe('trace-resolve-refund');
  });

  it('should emit dispute.resolved with refundAmountKgs on PARTIAL resolution', async () => {
    const disputeId = await createDispute('00000000-0000-4000-b000-000000000002');

    await request(ctx.app.getHttpServer())
      .post(`/disputes/${disputeId}/resolve`)
      .set('Authorization', ADMIN_AUTH)
      .set('X-Request-Id', 'trace-partial')
      .send({ resolution: 'PARTIAL', refundAmountKgs: 500 });

    const events = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'dispute.resolved' },
    });

    expect(events).toHaveLength(1);
    const payload = events[0].payloadJson as Record<string, unknown>;
    expect(payload['resolution']).toBe('PARTIAL');
    expect(payload['refundAmountKgs']).toBe(500);
  });

  it('should NOT emit outbox event on BAN_USER resolution', async () => {
    const disputeId = await createDispute('00000000-0000-4000-b000-000000000003');

    await request(ctx.app.getHttpServer())
      .post(`/disputes/${disputeId}/resolve`)
      .set('Authorization', ADMIN_AUTH)
      .set('X-Request-Id', 'trace-ban')
      .send({ resolution: 'BAN_USER' });

    const events = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'dispute.resolved' },
    });

    expect(events).toHaveLength(0);
  });

  it('should emit outbox event on NO_REFUND resolution', async () => {
    const disputeId = await createDispute('00000000-0000-4000-b000-000000000004');

    await request(ctx.app.getHttpServer())
      .post(`/disputes/${disputeId}/resolve`)
      .set('Authorization', ADMIN_AUTH)
      .set('X-Request-Id', 'trace-norefund')
      .send({ resolution: 'NO_REFUND' });

    const events = await ctx.prisma.outboxEvent.findMany({
      where: { eventType: 'dispute.resolved' },
    });

    expect(events).toHaveLength(1);
    const payload = events[0].payloadJson as Record<string, unknown>;
    expect(payload['resolution']).toBe('NO_REFUND');
  });

  it('should require refundAmountKgs for PARTIAL resolution', async () => {
    const disputeId = await createDispute('00000000-0000-4000-b000-000000000005');

    const res = await request(ctx.app.getHttpServer())
      .post(`/disputes/${disputeId}/resolve`)
      .set('Authorization', ADMIN_AUTH)
      .send({ resolution: 'PARTIAL' });

    expect(res.status).toBe(400);
  });

  it('should create audit log on resolution', async () => {
    const disputeId = await createDispute('00000000-0000-4000-b000-000000000006');

    await request(ctx.app.getHttpServer())
      .post(`/disputes/${disputeId}/resolve`)
      .set('Authorization', ADMIN_AUTH)
      .set('X-Request-Id', 'trace-audit')
      .send({ resolution: 'REFUND' });

    const audits = await ctx.prisma.auditLog.findMany({
      where: { targetType: 'Dispute', targetId: disputeId, action: 'DISPUTE_RESOLVE' },
    });

    expect(audits).toHaveLength(1);
    expect(audits[0].actorUserId).toBe(ADMIN_USER_ID);
  });
});
