import { normalizeRoute } from '../route-normalizer';

describe('normalizeRoute', () => {
  it('replaces UUID segments with :id', () => {
    expect(normalizeRoute('/trips/550e8400-e29b-41d4-a716-446655440000/book')).toBe(
      '/trips/:id/book',
    );
  });

  it('replaces numeric segments with :id', () => {
    expect(normalizeRoute('/payments/intents/123/capture')).toBe('/payments/intents/:id/capture');
  });

  it('preserves static routes', () => {
    expect(normalizeRoute('/auth/login')).toBe('/auth/login');
  });

  it('handles root path', () => {
    expect(normalizeRoute('/')).toBe('/');
  });

  it('strips query parameters before normalizing', () => {
    expect(normalizeRoute('/search?from=A&to=B')).toBe('/search');
  });

  it('handles multiple UUIDs in one path', () => {
    expect(
      normalizeRoute(
        '/users/550e8400-e29b-41d4-a716-446655440000/bookings/660e8400-e29b-41d4-a716-446655440001',
      ),
    ).toBe('/users/:id/bookings/:id');
  });

  it('does not touch non-id-like segments', () => {
    expect(normalizeRoute('/identity/auth/register')).toBe('/identity/auth/register');
  });

  it('handles trailing slash', () => {
    expect(normalizeRoute('/trips/550e8400-e29b-41d4-a716-446655440000/')).toBe('/trips/:id/');
  });
});
