import { PaymentIntentStatus, canTransition } from '../payment-intent.entity';

describe('PaymentIntentStatus state machine', () => {
  describe('valid transitions', () => {
    const validCases: [PaymentIntentStatus, PaymentIntentStatus][] = [
      [PaymentIntentStatus.CREATED, PaymentIntentStatus.HOLD_REQUESTED],
      [PaymentIntentStatus.CREATED, PaymentIntentStatus.HOLD_PLACED],
      [PaymentIntentStatus.CREATED, PaymentIntentStatus.CANCELLED],
      [PaymentIntentStatus.CREATED, PaymentIntentStatus.FAILED],
      [PaymentIntentStatus.HOLD_REQUESTED, PaymentIntentStatus.HOLD_PLACED],
      [PaymentIntentStatus.HOLD_REQUESTED, PaymentIntentStatus.CANCELLED],
      [PaymentIntentStatus.HOLD_REQUESTED, PaymentIntentStatus.FAILED],
      [PaymentIntentStatus.HOLD_PLACED, PaymentIntentStatus.CAPTURED],
      [PaymentIntentStatus.HOLD_PLACED, PaymentIntentStatus.CANCELLED],
      [PaymentIntentStatus.HOLD_PLACED, PaymentIntentStatus.FAILED],
      [PaymentIntentStatus.CAPTURED, PaymentIntentStatus.REFUNDED],
    ];

    it.each(validCases)('%s → %s is allowed', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
    });
  });

  describe('invalid transitions', () => {
    const invalidCases: [PaymentIntentStatus, PaymentIntentStatus][] = [
      [PaymentIntentStatus.CANCELLED, PaymentIntentStatus.CREATED],
      [PaymentIntentStatus.CANCELLED, PaymentIntentStatus.CAPTURED],
      [PaymentIntentStatus.REFUNDED, PaymentIntentStatus.CAPTURED],
      [PaymentIntentStatus.FAILED, PaymentIntentStatus.HOLD_PLACED],
      [PaymentIntentStatus.CAPTURED, PaymentIntentStatus.HOLD_PLACED],
      [PaymentIntentStatus.CAPTURED, PaymentIntentStatus.CAPTURED],
      [PaymentIntentStatus.HOLD_REQUESTED, PaymentIntentStatus.CREATED],
      [PaymentIntentStatus.HOLD_REQUESTED, PaymentIntentStatus.HOLD_REQUESTED],
      [PaymentIntentStatus.HOLD_REQUESTED, PaymentIntentStatus.CAPTURED],
      [PaymentIntentStatus.HOLD_REQUESTED, PaymentIntentStatus.REFUNDED],
    ];

    it.each(invalidCases)('%s → %s is forbidden', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
    });
  });

  describe('no double capture / no double refund invariants', () => {
    it('CAPTURED cannot transition to CAPTURED (no double capture)', () => {
      expect(canTransition(PaymentIntentStatus.CAPTURED, PaymentIntentStatus.CAPTURED)).toBe(false);
    });

    it('REFUNDED is terminal (no double refund)', () => {
      const allStatuses = Object.values(PaymentIntentStatus);
      for (const target of allStatuses) {
        expect(canTransition(PaymentIntentStatus.REFUNDED, target)).toBe(false);
      }
    });

    it('CANCELLED is terminal', () => {
      const allStatuses = Object.values(PaymentIntentStatus);
      for (const target of allStatuses) {
        expect(canTransition(PaymentIntentStatus.CANCELLED, target)).toBe(false);
      }
    });

    it('FAILED is terminal', () => {
      const allStatuses = Object.values(PaymentIntentStatus);
      for (const target of allStatuses) {
        expect(canTransition(PaymentIntentStatus.FAILED, target)).toBe(false);
      }
    });
  });
});
