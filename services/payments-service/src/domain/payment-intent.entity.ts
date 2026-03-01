export enum PaymentIntentStatus {
  CREATED = 'CREATED',
  HOLD_PLACED = 'HOLD_PLACED',
  CAPTURED = 'CAPTURED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  FAILED = 'FAILED',
}

const VALID_TRANSITIONS: Record<PaymentIntentStatus, PaymentIntentStatus[]> = {
  [PaymentIntentStatus.CREATED]: [
    PaymentIntentStatus.HOLD_PLACED,
    PaymentIntentStatus.CANCELLED,
    PaymentIntentStatus.FAILED,
  ],
  [PaymentIntentStatus.HOLD_PLACED]: [
    PaymentIntentStatus.CAPTURED,
    PaymentIntentStatus.CANCELLED,
    PaymentIntentStatus.FAILED,
  ],
  [PaymentIntentStatus.CAPTURED]: [PaymentIntentStatus.REFUNDED],
  [PaymentIntentStatus.CANCELLED]: [],
  [PaymentIntentStatus.REFUNDED]: [],
  [PaymentIntentStatus.FAILED]: [],
};

export function canTransition(from: PaymentIntentStatus, to: PaymentIntentStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
