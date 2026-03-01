process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3098';
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ??
  'postgresql://sapar:sapar_secret@localhost:5440/sapar_notifications_test';
process.env['LOG_LEVEL'] = 'silent';
process.env['JWT_ACCESS_SECRET'] = 'test-jwt-secret-at-least-32-characters-long!!';
process.env['NOTIF_RETRY_N'] = '3';
process.env['NOTIF_BACKOFF_SEC_LIST'] = '0,0,0';
process.env['WORKER_INTERVAL_MS'] = '60000';
process.env['PROVIDER_TIMEOUT_MS'] = '3000';
