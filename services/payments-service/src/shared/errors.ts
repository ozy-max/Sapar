export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(details: Record<string, unknown>) {
    super('VALIDATION_ERROR', 400, 'Validation failed', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor() {
    super('FORBIDDEN', 403, 'You do not have permission to perform this action');
  }
}

export class PaymentIntentNotFoundError extends AppError {
  constructor() {
    super('PAYMENT_INTENT_NOT_FOUND', 404, 'Payment intent not found');
  }
}

export class InvalidPaymentStateError extends AppError {
  constructor(detail?: string) {
    super('INVALID_PAYMENT_STATE', 409, detail ?? 'Invalid payment state for this operation');
  }
}

export class IdempotencyConflictError extends AppError {
  constructor() {
    super(
      'IDMP_CONFLICT',
      409,
      'Idempotency key already used with different payload',
    );
  }
}

export class PspUnavailableError extends AppError {
  constructor(detail?: string) {
    super('PSP_UNAVAILABLE', 502, detail ?? 'Payment service provider is unavailable');
  }
}

export class WebhookSignatureInvalidError extends AppError {
  constructor() {
    super('WEBHOOK_SIGNATURE_INVALID', 401, 'Invalid webhook signature');
  }
}
