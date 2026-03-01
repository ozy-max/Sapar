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

export class EmailTakenError extends AppError {
  constructor() {
    super('EMAIL_TAKEN', 409, 'Email is already registered');
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

export class InvalidRefreshTokenError extends AppError {
  constructor() {
    super('INVALID_REFRESH_TOKEN', 401, 'Refresh token is invalid or expired');
  }
}

export class ValidationError extends AppError {
  constructor(details: Record<string, unknown>) {
    super('VALIDATION_ERROR', 400, 'Validation failed', details);
  }
}
