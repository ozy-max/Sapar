import { registry } from '../metrics.registry';

describe('GET /metrics (smoke)', () => {
  it('registry produces output containing expected metric names', async () => {
    const output = await registry.metrics();

    expect(output).toContain('http_requests_total');
    expect(output).toContain('http_request_duration_ms');
    expect(output).toContain('http_in_flight_requests');
    expect(output).toContain('app_errors_total');
    expect(output).toContain('http_server_errors_total');
    expect(output).toContain('db_query_duration_ms');
    expect(output).toContain('db_errors_total');
    expect(output).toContain('external_call_duration_ms');
    expect(output).toContain('external_call_errors_total');
    expect(output).toContain('receipt_status_total');
  });
});
