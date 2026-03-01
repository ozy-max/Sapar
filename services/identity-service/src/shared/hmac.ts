/**
 * SHARED CODE — duplicated across services.
 * Canonical source: services/trips-service/src/shared/hmac.ts
 * TODO: Extract to @sapar/shared package when monorepo tooling is set up.
 * Any changes must be applied to all copies.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function signPayload(payload: string, timestamp: number, secret: string): string {
  const data = `${timestamp}.${payload}`;
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function verifyPayload(
  payload: string,
  timestamp: number,
  signature: string,
  secret: string,
  maxAgeSec = 300,
): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > maxAgeSec) return false;

  const expected = signPayload(payload, timestamp, secret);
  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return false;

  return timingSafeEqual(sigBuf, expBuf);
}
