import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

export const options = {
  scenarios: {
    cancel_booking: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 10,
      maxVUs: 50,
    },
  },
  thresholds: {
    'http_req_duration{name:cancel}': ['p(95)<1000'],
    http_req_failed: ['rate<0.05'],
  },
};

const headers = {
  'Content-Type': 'application/json',
  Authorization: AUTH_TOKEN ? `Bearer ${AUTH_TOKEN}` : '',
};

export default function () {
  const searchRes = http.get(
    `${BASE_URL}/v1/trips/search?fromCity=Almaty&toCity=Astana&limit=3`,
    { headers, tags: { name: 'search' } },
  );

  if (searchRes.status !== 200) {
    sleep(1);
    return;
  }

  let trips;
  try {
    trips = JSON.parse(searchRes.body);
  } catch {
    sleep(1);
    return;
  }

  if (!trips.items || trips.items.length === 0) {
    sleep(1);
    return;
  }

  const trip = trips.items[0];
  const bookRes = http.post(
    `${BASE_URL}/trips/bookings`,
    JSON.stringify({ tripId: trip.tripId, seats: 1 }),
    {
      headers: {
        ...headers,
        'Idempotency-Key': `k6-cancel-${__VU}-${__ITER}-${Date.now()}`,
      },
      tags: { name: 'book' },
    },
  );

  if (bookRes.status !== 201) {
    sleep(1);
    return;
  }

  let bookingId;
  try {
    bookingId = JSON.parse(bookRes.body).bookingId;
  } catch {
    sleep(1);
    return;
  }

  sleep(1);

  const cancelRes = http.post(
    `${BASE_URL}/trips/bookings/${bookingId}/cancel`,
    null,
    { headers, tags: { name: 'cancel' } },
  );

  check(cancelRes, {
    'cancel returns 200 or 409': (r) => r.status === 200 || r.status === 409,
  });

  sleep(0.5);
}
