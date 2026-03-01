process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3099';
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ??
  'postgresql://sapar:sapar_secret@localhost:5442/sapar_admin_test';
process.env['LOG_LEVEL'] = 'silent';
process.env['JWT_ACCESS_SECRET'] = 'test-jwt-secret-at-least-32-characters-long!!';
process.env['SLA_RESOLVE_HOURS'] = '12';
