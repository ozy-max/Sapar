export interface EventEnvelope {
  eventId: string;
  eventType: string;
  occurredAt: string;
  producer: string;
  traceId: string;
  payload: Record<string, unknown>;
  version: number;
}
