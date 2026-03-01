process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '0';
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ??
  'postgresql://sapar:sapar_secret@localhost:5433/sapar_identity_test';
process.env['LOG_LEVEL'] = 'silent';
process.env['JWT_ACCESS_SECRET'] = 'test-jwt-secret-at-least-32-characters-long!!';
process.env['JWT_ACCESS_TTL_SEC'] = '900';
process.env['REFRESH_TOKEN_TTL_SEC'] = '2592000';
