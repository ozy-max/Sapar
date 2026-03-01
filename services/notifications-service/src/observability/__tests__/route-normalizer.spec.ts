import { normalizeRoute } from '../route-normalizer';

describe('normalizeRoute', () => {
  it('replaces UUID segments with :id', () => {
    expect(normalizeRoute('/notifications/550e8400-e29b-41d4-a716-446655440000')).toBe(
      '/notifications/:id',
    );
  });

  it('replaces numeric segments with :id', () => {
    expect(normalizeRoute('/notifications/123/cancel')).toBe('/notifications/:id/cancel');
  });

  it('preserves static routes', () => {
    expect(normalizeRoute('/notifications/enqueue')).toBe('/notifications/enqueue');
  });

  it('handles root path', () => {
    expect(normalizeRoute('/')).toBe('/');
  });

  it('strips query parameters before normalizing', () => {
    expect(normalizeRoute('/notifications?channel=sms')).toBe('/notifications');
  });
});
