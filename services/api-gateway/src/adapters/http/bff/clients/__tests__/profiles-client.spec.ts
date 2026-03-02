import { getDriverRatingAggregate } from '../profiles.client';

const mockBffFetch = jest.fn();

jest.mock('../bff-http.client', () => ({
  bffFetch: (...args: unknown[]): unknown => mockBffFetch(...args),
  BffHttpError: class BffHttpError extends Error {
    constructor(
      public readonly upstream: string,
      public readonly status: number,
      public readonly body: unknown,
      public readonly isTimeout: boolean,
      public readonly isCircuitOpen = false,
    ) {
      super('');
      this.name = 'BffHttpError';
    }
  },
}));

jest.mock('../../../../../config/env', () => ({
  loadEnv: (): Record<string, unknown> => ({
    PROFILES_BASE_URL: 'http://profiles-service:3006',
    BFF_TIMEOUT_MS: 2500,
  }),
}));

describe('getDriverRatingAggregate', () => {
  const headers: Record<string, string> = { 'x-request-id': 'req-1' };

  beforeEach(() => {
    mockBffFetch.mockReset();
  });

  it('calls bffFetch with path containing encodeURIComponent for driverId', async () => {
    mockBffFetch.mockResolvedValue({
      status: 200,
      data: {
        userId: 'usr-1',
        displayName: 'Driver One',
        ratingAvg: 4.5,
        ratingCount: 10,
      },
    });

    await getDriverRatingAggregate('driver/with-slash', headers);

    expect(mockBffFetch).toHaveBeenCalledWith(
      'profiles',
      expect.objectContaining({
        path: '/profiles/driver%2Fwith-slash',
      }),
    );
  });

  it('encodes special characters in driverId correctly', async () => {
    mockBffFetch.mockResolvedValue({
      status: 200,
      data: {
        userId: 'usr-2',
        displayName: 'Driver Two',
        ratingAvg: 4.0,
        ratingCount: 5,
      },
    });

    await getDriverRatingAggregate('user@example.com', headers);

    expect(mockBffFetch).toHaveBeenCalledWith(
      'profiles',
      expect.objectContaining({
        path: '/profiles/user%40example.com',
      }),
    );
  });
});
