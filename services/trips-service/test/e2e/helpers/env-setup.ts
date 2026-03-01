process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3098';
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ??
  'postgresql://sapar:sapar_secret@localhost:5436/sapar_trips_test';
process.env['LOG_LEVEL'] = 'silent';
process.env['JWT_ACCESS_SECRET'] = 'test-jwt-secret-at-least-32-characters-long!!';
process.env['EVENTS_HMAC_SECRET'] = 'test-hmac-secret-at-least-32-characters-long!!';
process.env['OUTBOX_TARGETS'] = '';
