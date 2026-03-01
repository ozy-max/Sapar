import { signEvent, verifyEvent } from '../hmac';

const SECRET = 'test-secret-key-32-bytes-long!!!';
const BODY = '{"eventType":"booking.created","bookingId":"b-1"}';

describe('signEvent / verifyEvent', () => {
  it('produces a 64-char hex string (sha256)', () => {
    const sig = signEvent(BODY, 1000000, SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for same inputs', () => {
    const a = signEvent(BODY, 12345, SECRET);
    const b = signEvent(BODY, 12345, SECRET);
    expect(a).toBe(b);
  });

  it('differs when body changes', () => {
    const a = signEvent('body-a', 1, SECRET);
    const b = signEvent('body-b', 1, SECRET);
    expect(a).not.toBe(b);
  });

  it('differs when timestamp changes', () => {
    const a = signEvent(BODY, 1, SECRET);
    const b = signEvent(BODY, 2, SECRET);
    expect(a).not.toBe(b);
  });

  it('differs when secret changes', () => {
    const a = signEvent(BODY, 1, SECRET);
    const b = signEvent(BODY, 1, 'other-secret-key-32-bytes-long!!');
    expect(a).not.toBe(b);
  });

  it('verifyEvent accepts a valid signature within the replay window', () => {
    const now = Math.floor(Date.now() / 1000);
    const sig = signEvent(BODY, now, SECRET);
    expect(verifyEvent(BODY, now, sig, SECRET)).toBe(true);
  });

  it('rejects a signature with the wrong secret', () => {
    const now = Math.floor(Date.now() / 1000);
    const sig = signEvent(BODY, now, SECRET);
    expect(verifyEvent(BODY, now, sig, 'wrong-secret')).toBe(false);
  });

  it('rejects a tampered body', () => {
    const now = Math.floor(Date.now() / 1000);
    const sig = signEvent(BODY, now, SECRET);
    expect(verifyEvent(BODY + 'x', now, sig, SECRET)).toBe(false);
  });

  it('rejects a timestamp outside the replay window (future)', () => {
    const futureTs = Math.floor(Date.now() / 1000) + 400;
    const sig = signEvent(BODY, futureTs, SECRET);
    expect(verifyEvent(BODY, futureTs, sig, SECRET, 300)).toBe(false);
  });

  it('rejects a timestamp outside the replay window (past)', () => {
    const pastTs = Math.floor(Date.now() / 1000) - 400;
    const sig = signEvent(BODY, pastTs, SECRET);
    expect(verifyEvent(BODY, pastTs, sig, SECRET, 300)).toBe(false);
  });

  it('accepts a timestamp exactly at the replay boundary', () => {
    const now = Math.floor(Date.now() / 1000);
    const borderTs = now - 300;
    const sig = signEvent(BODY, borderTs, SECRET);
    expect(verifyEvent(BODY, borderTs, sig, SECRET, 300)).toBe(true);
  });

  it('rejects a signature with wrong length (non-hex garbage)', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyEvent(BODY, now, 'short', SECRET)).toBe(false);
  });
});
