import { signPayload, verifyPayload } from '../hmac';

const SECRET = 'admin-hmac-secret-32-bytes!!!!!!!!';
const PAYLOAD = '{"key":"MAX_SEATS","type":"int","valueJson":10}';

describe('signPayload / verifyPayload (admin-service)', () => {
  it('produces a 64-char hex string', () => {
    const sig = signPayload(PAYLOAD, 1000000, SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(signPayload(PAYLOAD, 99, SECRET)).toBe(signPayload(PAYLOAD, 99, SECRET));
  });

  it('verifyPayload accepts a valid signature within replay window', () => {
    const now = Math.floor(Date.now() / 1000);
    const sig = signPayload(PAYLOAD, now, SECRET);
    expect(verifyPayload(PAYLOAD, now, sig, SECRET)).toBe(true);
  });

  it('rejects tampered payload', () => {
    const now = Math.floor(Date.now() / 1000);
    const sig = signPayload(PAYLOAD, now, SECRET);
    expect(verifyPayload(PAYLOAD + 'x', now, sig, SECRET)).toBe(false);
  });

  it('rejects wrong secret', () => {
    const now = Math.floor(Date.now() / 1000);
    const sig = signPayload(PAYLOAD, now, SECRET);
    expect(verifyPayload(PAYLOAD, now, sig, 'wrong-secret')).toBe(false);
  });

  it('rejects timestamp too far in the past', () => {
    const pastTs = Math.floor(Date.now() / 1000) - 600;
    const sig = signPayload(PAYLOAD, pastTs, SECRET);
    expect(verifyPayload(PAYLOAD, pastTs, sig, SECRET, 300)).toBe(false);
  });

  it('rejects timestamp too far in the future', () => {
    const futureTs = Math.floor(Date.now() / 1000) + 600;
    const sig = signPayload(PAYLOAD, futureTs, SECRET);
    expect(verifyPayload(PAYLOAD, futureTs, sig, SECRET, 300)).toBe(false);
  });

  it('accepts a custom maxAgeSec', () => {
    const now = Math.floor(Date.now() / 1000);
    const borderTs = now - 10;
    const sig = signPayload(PAYLOAD, borderTs, SECRET);
    expect(verifyPayload(PAYLOAD, borderTs, sig, SECRET, 10)).toBe(true);
    expect(
      verifyPayload(PAYLOAD, borderTs - 1, signPayload(PAYLOAD, borderTs - 1, SECRET), SECRET, 10),
    ).toBe(false);
  });
});
