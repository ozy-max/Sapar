/**
 * SHARED CODE — duplicated across services.
 * Canonical source: services/trips-service/src/shared/event-envelope.ts
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
