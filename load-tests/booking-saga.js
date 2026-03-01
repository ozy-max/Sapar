import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

export const options = {
  scenarios: {
    booking_saga: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
  },
  thresholds: {
    'http_req_duration{name:book_seat}': ['p(95)<2000'],
    'http_req_duration{name:poll_booking}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const headers = {
  'Content-Type': 'application/json',
  Authorization: AUTH_TOKEN ? `Bearer ${AUTH_TOKEN}` : '',
};

export default function () {
  const searchRes = http.get(
    `${BASE_URL}/v1/trips/search?fromCity=Almaty&toCity=Astana&limit=5`,
    { headers, tags: { name: 'search_trips' } },
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

  const trip = trips.items[Math.floor(Math.random() * trips.items.length)];

  const bookRes = http.post(
    `${BASE_URL}/trips/bookings`,
    JSON.stringify({
      tripId: trip.tripId,
      seats: 1,
    }),
    {
      headers: {
        ...headers,
        'Idempotency-Key': `k6-${__VU}-${__ITER}-${Date.now()}`,
      },
      tags: { name: 'book_seat' },
    },
  );

  check(bookRes, {
    'booking created (201 or 409)': (r) => r.status === 201 || r.status === 409,
  });

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

  for (let attempt = 0; attempt < 10; attempt++) {
    sleep(2);

    const pollRes = http.get(
      `${BASE_URL}/v1/bookings/${bookingId}`,
      { headers, tags: { name: 'poll_booking' } },
    );

    check(pollRes, {
      'poll status 200': (r) => r.status === 200,
    });

    if (pollRes.status === 200) {
      try {
        const booking = JSON.parse(pollRes.body);
        if (booking.status === 'CONFIRMED' || booking.status === 'CAPTURED') {
          check(null, { 'booking confirmed/captured': () => true });
          break;
        }
        if (booking.status === 'FAILED' || booking.status === 'EXPIRED') {
          break;
        }
      } catch {
        break;
      }
    }
  }

  sleep(1);
}
