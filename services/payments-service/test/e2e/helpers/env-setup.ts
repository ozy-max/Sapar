process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3097';
process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] ??
  'postgresql://sapar:sapar_secret@localhost:5438/sapar_payments_test';
process.env['LOG_LEVEL'] = 'silent';
process.env['JWT_ACCESS_SECRET'] = 'test-jwt-secret-at-least-32-characters-long!!';
process.env['PSP_TIMEOUT_MS'] = '3000';
process.env['PAYMENTS_WEBHOOK_SECRET'] = 'test-webhook-secret';
process.env['RECEIPT_RETRY_N'] = '3';
process.env['RECEIPT_BACKOFF_SEC_LIST'] = '0,0,0';
process.env['RECEIPT_POLL_INTERVAL_MS'] = '60000';
