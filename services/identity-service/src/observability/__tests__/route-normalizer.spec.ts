import { normalizeRoute } from '../route-normalizer';

describe('normalizeRoute', () => {
  it('replaces UUID segments with :id', () => {
    expect(normalizeRoute('/users/550e8400-e29b-41d4-a716-446655440000/profile')).toBe(
      '/users/:id/profile',
    );
  });

  it('replaces numeric segments with :id', () => {
    expect(normalizeRoute('/tokens/123/revoke')).toBe('/tokens/:id/revoke');
  });

  it('preserves static routes', () => {
    expect(normalizeRoute('/auth/login')).toBe('/auth/login');
  });

  it('handles root path', () => {
    expect(normalizeRoute('/')).toBe('/');
  });

  it('strips query parameters before normalizing', () => {
    expect(normalizeRoute('/auth/register?ref=abc')).toBe('/auth/register');
  });
});
