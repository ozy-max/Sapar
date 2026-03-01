import { ConfigClient } from '../config-client';

let fetchCallCount = 0;
let fetchResponses: Array<{
  status: number;
  body?: unknown;
  etag?: string;
}> = [];

const originalFetch = globalThis.fetch;

beforeAll(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['EVENTS_HMAC_SECRET'] = 'test-secret-at-least-32-characters!!';
  process.env['CONFIG_BASE_URL'] = 'http://admin:3005';
  process.env['CONFIG_CACHE_TTL_MS'] = '100';
  process.env['CONFIG_FETCH_TIMEOUT_MS'] = '1000';
});

beforeEach(() => {
  fetchCallCount = 0;
  fetchResponses = [];

  globalThis.fetch = jest.fn(async (): Promise<Response> => {
    fetchCallCount++;
    const resp = fetchResponses.shift() ?? { status: 200, body: { items: [] } };

    const headers = new Headers();
    if (resp.etag) headers.set('etag', resp.etag);

    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      headers,
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body),
    } as unknown as Response;
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('ConfigClient', () => {
  it('should cache and not fetch on every get()', async () => {
    fetchResponses.push({
      status: 200,
      body: {
        items: [{ key: 'K1', type: 'INT', valueJson: 42, version: 1 }],
      },
      etag: '"v1"',
    });

    const client = new ConfigClient();
    await client.refresh();

    expect(fetchCallCount).toBe(1);

    const val1 = client.get<number>('K1');
    expect(val1).toBe(42);

    const val2 = client.get<number>('K1');
    expect(val2).toBe(42);

    expect(fetchCallCount).toBe(1);
  });

  it('should trigger background refresh when TTL expires', async () => {
    fetchResponses.push({
      status: 200,
      body: {
        items: [{ key: 'K2', type: 'INT', valueJson: 10, version: 1 }],
      },
      etag: '"v1"',
    });
    fetchResponses.push({
      status: 200,
      body: {
        items: [{ key: 'K2', type: 'INT', valueJson: 20, version: 2 }],
      },
      etag: '"v2"',
    });

    const client = new ConfigClient();
    await client.refresh();

    expect(fetchCallCount).toBe(1);
    expect(client.get<number>('K2')).toBe(10);

    await new Promise((r) => setTimeout(r, 150));

    client.get<number>('K2');

    await new Promise((r) => setTimeout(r, 50));

    expect(fetchCallCount).toBe(2);
  });

  it('should handle 304 Not Modified', async () => {
    fetchResponses.push({
      status: 200,
      body: {
        items: [{ key: 'K3', type: 'STRING', valueJson: 'hello', version: 1 }],
      },
      etag: '"v1"',
    });
    fetchResponses.push({ status: 304 });

    const client = new ConfigClient();
    await client.refresh();

    expect(client.get<string>('K3')).toBe('hello');

    await client.refresh();

    expect(fetchCallCount).toBe(2);
    expect(client.get<string>('K3')).toBe('hello');
  });

  it('should return undefined for missing key', async () => {
    fetchResponses.push({
      status: 200,
      body: { items: [] },
      etag: '"v0"',
    });

    const client = new ConfigClient();
    await client.refresh();

    expect(client.get('NONEXISTENT')).toBeUndefined();
  });
});
