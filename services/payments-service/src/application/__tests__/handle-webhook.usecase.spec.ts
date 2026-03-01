import { createHmac } from 'node:crypto';
import { HandleWebhookUseCase, WebhookPayload } from '../handle-webhook.usecase';
import { WebhookSignatureInvalidError } from '../../shared/errors';
import { PaymentIntentStatus } from '../../domain/payment-intent.entity';

jest.mock('../../config/env', () => ({
  loadEnv: () => ({
    PAYMENTS_WEBHOOK_SECRET: 'test-webhook-secret-32-chars-long!!',
  }),
}));

function buildMocks() {
  const prisma: { $transaction: jest.Mock } = {
    $transaction: jest.fn((cb: (tx: unknown) => Promise<void>) => cb(prisma)),
  };

  const intentRepo = {
    findByPspIntentId: jest.fn(),
    updateStatus: jest.fn(),
  };

  const eventRepo = {
    existsByExternalEventId: jest.fn(),
    create: jest.fn(),
  };

  const useCase = new HandleWebhookUseCase(
    prisma as any,
    intentRepo as any,
    eventRepo as any,
  );

  return { prisma, intentRepo, eventRepo, useCase };
}

function sign(body: Buffer, secret = 'test-webhook-secret-32-chars-long!!'): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('HandleWebhookUseCase', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  describe('verifySignature', () => {
    it('should pass with a valid signature', () => {
      const { useCase } = buildMocks();
      const body = Buffer.from('{"test":true}');
      const sig = sign(body);
      const ts = String(Math.floor(Date.now() / 1000));

      expect(() => useCase.verifySignature(body, sig, ts)).not.toThrow();
    });

    it('should throw WebhookSignatureInvalidError for invalid signature', () => {
      const { useCase } = buildMocks();
      const body = Buffer.from('{"test":true}');

      expect(() => useCase.verifySignature(body, 'bad-signature', String(Math.floor(Date.now() / 1000)))).toThrow(
        WebhookSignatureInvalidError,
      );
    });

    it('should throw WebhookSignatureInvalidError for expired timestamp', () => {
      const { useCase } = buildMocks();
      const body = Buffer.from('{"test":true}');
      const sig = sign(body);
      const expiredTs = String(Math.floor(Date.now() / 1000) - 600);

      expect(() => useCase.verifySignature(body, sig, expiredTs)).toThrow(
        WebhookSignatureInvalidError,
      );
    });

    it('should throw WebhookSignatureInvalidError when timestamp missing in non-test env', () => {
      process.env.NODE_ENV = 'production';
      const { useCase } = buildMocks();
      const body = Buffer.from('{"test":true}');
      const sig = sign(body);

      expect(() => useCase.verifySignature(body, sig, undefined)).toThrow(
        WebhookSignatureInvalidError,
      );
    });
  });

  describe('execute', () => {
    it('should return silently for duplicate eventId (idempotent)', async () => {
      const { useCase, eventRepo } = buildMocks();
      eventRepo.existsByExternalEventId.mockResolvedValue(true);

      const payload: WebhookPayload = {
        eventId: 'evt-dup',
        type: 'hold.succeeded',
        pspIntentId: 'psp-1',
      };

      await expect(useCase.execute(payload)).resolves.toBeUndefined();
      expect(eventRepo.create).not.toHaveBeenCalled();
    });

    it('should ignore unknown event type gracefully', async () => {
      const { useCase, eventRepo } = buildMocks();
      eventRepo.existsByExternalEventId.mockResolvedValue(false);

      const payload: WebhookPayload = {
        eventId: 'evt-unknown',
        type: 'some.unknown.type',
        pspIntentId: 'psp-1',
      };

      await expect(useCase.execute(payload)).resolves.toBeUndefined();
    });

    it('should transition CREATED -> HOLD_PLACED for hold.succeeded', async () => {
      const { useCase, eventRepo, intentRepo } = buildMocks();
      eventRepo.existsByExternalEventId.mockResolvedValue(false);
      intentRepo.findByPspIntentId.mockResolvedValue({
        id: 'intent-1',
        status: PaymentIntentStatus.CREATED,
      });
      intentRepo.updateStatus.mockResolvedValue({});
      eventRepo.create.mockResolvedValue({});

      const payload: WebhookPayload = {
        eventId: 'evt-hold',
        type: 'hold.succeeded',
        pspIntentId: 'psp-1',
      };

      await useCase.execute(payload);

      expect(intentRepo.updateStatus).toHaveBeenCalledWith(
        'intent-1',
        PaymentIntentStatus.HOLD_PLACED,
        expect.anything(),
      );
      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentIntentId: 'intent-1',
          type: 'HOLD_PLACED',
          externalEventId: 'evt-hold',
        }),
        expect.anything(),
      );
    });
  });
});
