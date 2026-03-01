/**
 * SHARED CODE — canonical source.
 * Copies: payments-service, notifications-service, admin-service.
 * TODO: Extract to @sapar/shared package when monorepo tooling is set up.
 * Any changes must be applied to all copies.
 */
export interface EventEnvelope {
  eventId: string;
  eventType: string;
  occurredAt: string;
  producer: string;
  traceId: string;
  payload: Record<string, unknown>;
  version: number;
}
