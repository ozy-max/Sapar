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

export class NotificationNotFoundError extends AppError {
  constructor() {
    super('NOTIFICATION_NOT_FOUND', 404, 'Notification not found');
  }
}

export class TemplateNotFoundError extends AppError {
  constructor(templateKey: string, channel: string) {
    super('TEMPLATE_NOT_FOUND', 400, `Template '${templateKey}' not found for channel '${channel}'`);
  }
}

export class InvalidStateError extends AppError {
  constructor(detail?: string) {
    super('INVALID_STATE', 409, detail ?? 'Invalid notification state for this operation');
  }
}

export class IdempotencyConflictError extends AppError {
  constructor() {
    super('IDMP_CONFLICT', 409, 'Idempotency key already used with different payload');
  }
}

export class ProviderUnavailableError extends AppError {
  constructor(detail?: string) {
    super('PROVIDER_UNAVAILABLE', 502, detail ?? 'Notification provider is unavailable');
  }
}
