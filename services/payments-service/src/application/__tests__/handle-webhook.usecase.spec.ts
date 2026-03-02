import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { HandleWebhookUseCase, WebhookPayload } from '../handle-webhook.usecase';
import { WebhookSignatureInvalidError } from '../../shared/errors';
import { PaymentIntentStatus } from '../../domain/payment-intent.entity';
import { PrismaService } from '../../adapters/db/prisma.service';
import { PaymentIntentRepository } from '../../adapters/db/payment-intent.repository';
import { PaymentEventRepository } from '../../adapters/db/payment-event.repository';

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
    findByPspIntentIdForUpdate: jest.fn(),
    updateStatus: jest.fn(),
  };

  const eventRepo = {
    existsByExternalEventId: jest.fn(),
    create: jest.fn(),
  };

  const useCase = new HandleWebhookUseCase(
    prisma as unknown as PrismaService,
    intentRepo as unknown as PaymentIntentRepository,
    eventRepo as unknown as PaymentEventRepository,
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

      expect(() =>
        useCase.verifySignature(body, 'bad-signature', String(Math.floor(Date.now() / 1000))),
      ).toThrow(WebhookSignatureInvalidError);
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

    it('should transition CREATED -> HOLD_PLACED for hold.succeeded (with FOR UPDATE)', async () => {
      const { useCase, eventRepo, intentRepo } = buildMocks();
      eventRepo.existsByExternalEventId.mockResolvedValue(false);
      intentRepo.findByPspIntentIdForUpdate.mockResolvedValue({
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

      expect(intentRepo.findByPspIntentIdForUpdate).toHaveBeenCalledWith(
        'psp-1',
        expect.anything(),
      );
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

    it('should handle P2002 duplicate as idempotent (return without error)', async () => {
      const { useCase, eventRepo, intentRepo } = buildMocks();
      eventRepo.existsByExternalEventId.mockResolvedValue(false);
      intentRepo.findByPspIntentIdForUpdate.mockResolvedValue({
        id: 'intent-1',
        status: PaymentIntentStatus.HOLD_PLACED,
      });
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      eventRepo.create.mockRejectedValue(p2002);

      const payload: WebhookPayload = {
        eventId: 'evt-race',
        type: 'hold.succeeded',
        pspIntentId: 'psp-1',
      };

      await expect(useCase.execute(payload)).resolves.toBeUndefined();
    });

    it('should record WEBHOOK_RECEIVED when already at target status', async () => {
      const { useCase, eventRepo, intentRepo } = buildMocks();
      eventRepo.existsByExternalEventId.mockResolvedValue(false);
      intentRepo.findByPspIntentIdForUpdate.mockResolvedValue({
        id: 'intent-1',
        status: PaymentIntentStatus.HOLD_PLACED,
      });
      eventRepo.create.mockResolvedValue({});

      const payload: WebhookPayload = {
        eventId: 'evt-hold-again',
        type: 'hold.succeeded',
        pspIntentId: 'psp-1',
      };

      await useCase.execute(payload);

      expect(intentRepo.updateStatus).not.toHaveBeenCalled();
      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentIntentId: 'intent-1',
          type: 'WEBHOOK_RECEIVED',
          externalEventId: 'evt-hold-again',
        }),
        expect.anything(),
      );
    });

    it('should throw PaymentIntentNotFoundError when intent missing', async () => {
      const { useCase, eventRepo, intentRepo } = buildMocks();
      eventRepo.existsByExternalEventId.mockResolvedValue(false);
      intentRepo.findByPspIntentIdForUpdate.mockResolvedValue(null);

      const payload: WebhookPayload = {
        eventId: 'evt-missing',
        type: 'hold.succeeded',
        pspIntentId: 'psp-unknown',
      };

      await expect(useCase.execute(payload)).rejects.toThrow('Payment intent not found');
    });

    it('should skip invalid transitions and record as WEBHOOK_RECEIVED', async () => {
      const { useCase, eventRepo, intentRepo } = buildMocks();
      eventRepo.existsByExternalEventId.mockResolvedValue(false);
      intentRepo.findByPspIntentIdForUpdate.mockResolvedValue({
        id: 'intent-1',
        status: PaymentIntentStatus.CANCELLED,
      });
      eventRepo.create.mockResolvedValue({});

      const payload: WebhookPayload = {
        eventId: 'evt-invalid',
        type: 'hold.succeeded',
        pspIntentId: 'psp-1',
      };

      await useCase.execute(payload);

      expect(intentRepo.updateStatus).not.toHaveBeenCalled();
      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'WEBHOOK_RECEIVED',
          payloadJson: expect.objectContaining({ skipped: true }),
        }),
        expect.anything(),
      );
    });
  });
});
