import { BookingStatus, canTransitionBooking, isTerminalBookingStatus } from '../booking.entity';

describe('BookingStatus state machine', () => {
  describe('canTransitionBooking — valid transitions', () => {
    const validCases: [BookingStatus, BookingStatus][] = [
      [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED],
      [BookingStatus.PENDING_PAYMENT, BookingStatus.CANCELLED],
      [BookingStatus.PENDING_PAYMENT, BookingStatus.EXPIRED],
      [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
    ];

    it.each(validCases)('%s → %s is allowed', (from, to) => {
      expect(canTransitionBooking(from, to)).toBe(true);
    });
  });

  describe('canTransitionBooking — invalid transitions', () => {
    const invalidCases: [BookingStatus, BookingStatus][] = [
      [BookingStatus.CANCELLED, BookingStatus.CONFIRMED],
      [BookingStatus.CANCELLED, BookingStatus.PENDING_PAYMENT],
      [BookingStatus.EXPIRED, BookingStatus.CONFIRMED],
      [BookingStatus.EXPIRED, BookingStatus.CANCELLED],
      [BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT],
      [BookingStatus.CONFIRMED, BookingStatus.EXPIRED],
      [BookingStatus.PENDING_PAYMENT, BookingStatus.PENDING_PAYMENT],
      [BookingStatus.CONFIRMED, BookingStatus.CONFIRMED],
    ];

    it.each(invalidCases)('%s → %s is forbidden', (from, to) => {
      expect(canTransitionBooking(from, to)).toBe(false);
    });
  });

  describe('isTerminalBookingStatus', () => {
    it('CANCELLED is terminal', () => {
      expect(isTerminalBookingStatus(BookingStatus.CANCELLED)).toBe(true);
    });

    it('EXPIRED is terminal', () => {
      expect(isTerminalBookingStatus(BookingStatus.EXPIRED)).toBe(true);
    });

    it('PENDING_PAYMENT is not terminal', () => {
      expect(isTerminalBookingStatus(BookingStatus.PENDING_PAYMENT)).toBe(false);
    });

    it('CONFIRMED is not terminal (can still be cancelled)', () => {
      expect(isTerminalBookingStatus(BookingStatus.CONFIRMED)).toBe(false);
    });
  });

  describe('no double capture / no reconfirm invariants', () => {
    it('CONFIRMED cannot transition back to CONFIRMED (no double confirm)', () => {
      expect(canTransitionBooking(BookingStatus.CONFIRMED, BookingStatus.CONFIRMED)).toBe(false);
    });

    it('CANCELLED cannot be un-cancelled', () => {
      const allStatuses = Object.values(BookingStatus);
      for (const target of allStatuses) {
        expect(canTransitionBooking(BookingStatus.CANCELLED, target)).toBe(false);
      }
    });

    it('EXPIRED cannot transition anywhere', () => {
      const allStatuses = Object.values(BookingStatus);
      for (const target of allStatuses) {
        expect(canTransitionBooking(BookingStatus.EXPIRED, target)).toBe(false);
      }
    });
  });
});
