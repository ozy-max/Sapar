import http from 'k6/http';
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';

const BASE_URL = __ENV.ADMIN_BASE_URL || 'http://localhost:3005';
const HMAC_SECRET = __ENV.HMAC_SECRET || 'hmac-secret-for-dev-at-least-32-chars!!';

export const options = {
  scenarios: {
    admin_config_read: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = '';
  const signature = crypto.hmac('sha256', HMAC_SECRET, `${timestamp}.${payload}`, 'hex');

  const res = http.get(`${BASE_URL}/internal/configs`, {
    headers: {
      'X-Event-Signature': signature,
      'X-Event-Timestamp': timestamp,
      'Content-Type': 'application/json',
    },
    tags: { name: 'admin_configs' },
  });

  check(res, {
    'status is 200 or 304': (r) => r.status === 200 || r.status === 304,
    'has items': (r) => {
      if (r.status === 304) return true;
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.items);
      } catch {
        return false;
      }
    },
  });

  sleep(0.05);
}
