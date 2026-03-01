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
  constructor() {
    super('UNAUTHORIZED', 401, 'Authentication required');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super('FORBIDDEN', 403, message);
  }
}

export class ConfigNotFoundError extends AppError {
  constructor(key: string) {
    super('CONFIG_NOT_FOUND', 404, `Config key '${key}' not found`);
  }
}

export class DisputeNotFoundError extends AppError {
  constructor() {
    super('DISPUTE_NOT_FOUND', 404, 'Dispute not found');
  }
}

export class SlaWindowExpiredError extends AppError {
  constructor() {
    super('SLA_WINDOW_EXPIRED', 409, 'SLA resolution window has expired');
  }
}

export class InvalidStateError extends AppError {
  constructor(message: string) {
    super('INVALID_STATE', 409, message);
  }
}
