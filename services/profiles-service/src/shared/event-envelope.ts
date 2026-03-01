/**
 * SHARED CODE — canonical source: trips-service.
 * TODO: Extract to @sapar/shared package when monorepo tooling is set up.
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
