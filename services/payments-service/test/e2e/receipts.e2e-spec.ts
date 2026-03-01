import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp, TestContext } from './helpers/test-app';
import { cleanDatabase } from './helpers/db-cleanup';
import { signToken } from './helpers/jwt-helper';
import { resetEnvCache } from '../../src/config/env';
import { PrismaService } from '../../src/adapters/db/prisma.service';
import { FakeReceiptIssuer } from '../../src/adapters/psp/fake-psp.adapter';
import { ProcessReceiptsUseCase } from '../../src/application/process-receipts.usecase';

describe('Receipt Worker (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeReceiptIssuer: FakeReceiptIssuer;
  let processReceipts: ProcessReceiptsUseCase;
  let token: string;
  const userId = randomUUID();

  beforeAll(async () => {
    resetEnvCache();
    const ctx: TestContext = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    fakeReceiptIssuer = ctx.fakeReceiptIssuer;
    processReceipts = ctx.processReceipts;
    token = signToken(userId);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    fakeReceiptIssuer.setShouldFail(false);
  });

  async function createAndCapture(): Promise<string> {
    const bookingId = randomUUID();

    const createRes = await request(app.getHttpServer())
      .post('/payments/intents')
      .set('Authorization', `Bearer ${token}`)
      .send({ bookingId, amountKgs: 1500 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/payments/intents/${createRes.body.paymentIntentId}/capture`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    return createRes.body.paymentIntentId as string;
  }

  it('should issue receipt successfully on first try', async () => {
    const intentId = await createAndCapture();

    await processReceipts.processOnce();

    const receipt = await prisma.receipt.findFirst({
      where: { paymentIntentId: intentId },
    });
    expect(receipt!.status).toBe('ISSUED');
    expect(receipt!.tryCount).toBe(0);
  });

  it('should retry and eventually reach FAILED_FINAL after N retries', async () => {
    const intentId = await createAndCapture();
    fakeReceiptIssuer.setShouldFail(true);

    await processReceipts.processOnce();
    let receipt = await prisma.receipt.findFirst({
      where: { paymentIntentId: intentId },
    });
    expect(receipt!.status).toBe('PENDING');
    expect(receipt!.tryCount).toBe(1);
    expect(receipt!.lastError).toContain('Receipt issuing failed');

    await processReceipts.processOnce();
    receipt = await prisma.receipt.findFirst({
      where: { paymentIntentId: intentId },
    });
    expect(receipt!.status).toBe('PENDING');
    expect(receipt!.tryCount).toBe(2);

    await processReceipts.processOnce();
    receipt = await prisma.receipt.findFirst({
      where: { paymentIntentId: intentId },
    });
    expect(receipt!.status).toBe('FAILED_FINAL');
    expect(receipt!.tryCount).toBe(3);
  });

  it('should succeed after retries if issuer recovers', async () => {
    const intentId = await createAndCapture();
    fakeReceiptIssuer.setShouldFail(true);

    await processReceipts.processOnce();
    let receipt = await prisma.receipt.findFirst({
      where: { paymentIntentId: intentId },
    });
    expect(receipt!.tryCount).toBe(1);

    fakeReceiptIssuer.setShouldFail(false);

    await processReceipts.processOnce();
    receipt = await prisma.receipt.findFirst({
      where: { paymentIntentId: intentId },
    });
    expect(receipt!.status).toBe('ISSUED');
  });
});
