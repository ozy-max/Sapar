import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  scenarios: {
    trips_search: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const CITIES = ['Almaty', 'Astana', 'Shymkent', 'Karaganda', 'Aktobe', 'Taraz'];

function randomCity() {
  return CITIES[Math.floor(Math.random() * CITIES.length)];
}

export default function () {
  const from = randomCity();
  let to = randomCity();
  while (to === from) {
    to = randomCity();
  }

  const url = `${BASE_URL}/v1/trips/search?fromCity=${from}&toCity=${to}&limit=10`;
  const res = http.get(url, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'trips_search' },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has items array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.items);
      } catch {
        return false;
      }
    },
  });

  sleep(0.1);
}
