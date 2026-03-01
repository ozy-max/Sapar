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

export class TripNotFoundError extends AppError {
  constructor() {
    super('TRIP_NOT_FOUND', 404, 'Trip not found');
  }
}

export class BookingNotFoundError extends AppError {
  constructor() {
    super('BOOKING_NOT_FOUND', 404, 'Booking not found');
  }
}

export class TripNotActiveError extends AppError {
  constructor() {
    super('TRIP_NOT_ACTIVE', 409, 'Trip is not active');
  }
}

export class NotEnoughSeatsError extends AppError {
  constructor() {
    super('NOT_ENOUGH_SEATS', 409, 'Not enough available seats');
  }
}

export class BookingExistsError extends AppError {
  constructor() {
    super('BOOKING_EXISTS', 409, 'You already have an active booking for this trip');
  }
}

export class BookingNotActiveError extends AppError {
  constructor() {
    super('BOOKING_NOT_ACTIVE', 409, 'Booking is not in a cancellable state');
  }
}

export class InvalidBookingTransitionError extends AppError {
  constructor(from: string, to: string) {
    super('INVALID_BOOKING_TRANSITION', 409, `Cannot transition booking from ${from} to ${to}`);
  }
}
