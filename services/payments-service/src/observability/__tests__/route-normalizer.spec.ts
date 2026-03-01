import { normalizeRoute } from '../route-normalizer';

describe('normalizeRoute', () => {
  it('replaces UUID segments with :id', () => {
    expect(
      normalizeRoute('/intents/550e8400-e29b-41d4-a716-446655440000/capture'),
    ).toBe('/intents/:id/capture');
  });

  it('replaces numeric segments with :id', () => {
    expect(normalizeRoute('/intents/123/refund')).toBe('/intents/:id/refund');
  });

  it('preserves static routes', () => {
    expect(normalizeRoute('/webhooks/psp')).toBe('/webhooks/psp');
  });

  it('handles root path', () => {
    expect(normalizeRoute('/')).toBe('/');
  });

  it('strips query parameters before normalizing', () => {
    expect(normalizeRoute('/intents?status=pending')).toBe('/intents');
  });
});
