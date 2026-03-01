import { normalizeRoute } from '../route-normalizer';

describe('normalizeRoute', () => {
  it('replaces UUID segments with :id', () => {
    expect(normalizeRoute('/trips/550e8400-e29b-41d4-a716-446655440000/book')).toBe(
      '/trips/:id/book',
    );
  });

  it('replaces numeric segments with :id', () => {
    expect(normalizeRoute('/bookings/123/cancel')).toBe('/bookings/:id/cancel');
  });

  it('preserves static routes', () => {
    expect(normalizeRoute('/trips/search')).toBe('/trips/search');
  });

  it('handles root path', () => {
    expect(normalizeRoute('/')).toBe('/');
  });

  it('strips query parameters before normalizing', () => {
    expect(normalizeRoute('/trips/search?from=A&to=B')).toBe('/trips/search');
  });
});
