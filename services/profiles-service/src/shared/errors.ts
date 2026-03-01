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
  constructor() {
    super('FORBIDDEN', 403, 'You do not have permission to perform this action');
  }
}

export class ProfileNotFoundError extends AppError {
  constructor() {
    super('PROFILE_NOT_FOUND', 404, 'Profile not found');
  }
}

export class RatingNotFoundError extends AppError {
  constructor() {
    super('RATING_NOT_FOUND', 404, 'Rating not found');
  }
}

export class NotEligibleError extends AppError {
  constructor(reason: string) {
    super('NOT_ELIGIBLE', 403, `Not eligible to rate: ${reason}`);
  }
}

export class RatingWindowExpiredError extends AppError {
  constructor() {
    super('RATING_WINDOW_EXPIRED', 409, 'Rating window has expired');
  }
}

export class DuplicateRatingError extends AppError {
  constructor() {
    super('DUPLICATE_RATING', 409, 'You have already rated this trip in this direction');
  }
}
