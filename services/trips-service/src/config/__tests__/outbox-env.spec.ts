import { getOutboxBackoffSchedule, parseOutboxTargets, resetEnvCache } from '../env';

beforeEach(() => {
  resetEnvCache();
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['JWT_ACCESS_SECRET'] = 'test-jwt';
  process.env['EVENTS_HMAC_SECRET'] = 'test-hmac';
});

afterEach(() => {
  resetEnvCache();
});

describe('getOutboxBackoffSchedule', () => {
  it('parses default schedule "5,30,120,300,900"', () => {
    process.env['OUTBOX_BACKOFF_SEC_LIST'] = '5,30,120,300,900';
    const schedule = getOutboxBackoffSchedule();
    expect(schedule).toEqual([5, 30, 120, 300, 900]);
  });

  it('parses single value', () => {
    process.env['OUTBOX_BACKOFF_SEC_LIST'] = '10';
    const schedule = getOutboxBackoffSchedule();
    expect(schedule).toEqual([10]);
  });

  it('handles whitespace in values', () => {
    process.env['OUTBOX_BACKOFF_SEC_LIST'] = ' 5 , 30 , 120 ';
    const schedule = getOutboxBackoffSchedule();
    expect(schedule).toEqual([5, 30, 120]);
  });

  it('throws on negative value', () => {
    process.env['OUTBOX_BACKOFF_SEC_LIST'] = '5,-1,10';
    expect(() => getOutboxBackoffSchedule()).toThrow('Invalid OUTBOX_BACKOFF_SEC_LIST');
  });

  it('throws on non-numeric value', () => {
    process.env['OUTBOX_BACKOFF_SEC_LIST'] = 'abc';
    expect(() => getOutboxBackoffSchedule()).toThrow('Invalid OUTBOX_BACKOFF_SEC_LIST');
  });
});

describe('parseOutboxTargets', () => {
  it('parses event>url pairs', () => {
    const raw =
      'booking.created>http://payments:3003/events,trip.cancelled>http://notif:3004/events';
    const map = parseOutboxTargets(raw);
    expect(map.size).toBe(2);
    expect(map.get('booking.created')).toEqual(['http://payments:3003/events']);
    expect(map.get('trip.cancelled')).toEqual(['http://notif:3004/events']);
  });

  it('returns empty map for empty string', () => {
    expect(parseOutboxTargets('').size).toBe(0);
  });

  it('skips malformed entries without ">"', () => {
    const map = parseOutboxTargets('valid>http://a,malformed-no-arrow');
    expect(map.size).toBe(1);
    expect(map.get('valid')).toEqual(['http://a']);
  });

  it('trims whitespace from keys and urls', () => {
    const map = parseOutboxTargets(' foo > http://bar ');
    expect(map.get('foo')).toEqual(['http://bar']);
  });

  it('handles urls containing ">" in path', () => {
    const map = parseOutboxTargets('evt>http://host/path>extra');
    expect(map.get('evt')).toEqual(['http://host/path>extra']);
  });

  it('collects multiple URLs for the same event type', () => {
    const raw =
      'booking.cancelled>http://payments:3003/events,booking.cancelled>http://notif:3004/events';
    const map = parseOutboxTargets(raw);
    expect(map.size).toBe(1);
    expect(map.get('booking.cancelled')).toEqual([
      'http://payments:3003/events',
      'http://notif:3004/events',
    ]);
  });
});
