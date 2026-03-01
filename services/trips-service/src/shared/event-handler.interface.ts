/**
 * SHARED CODE — canonical source.
 * Copies: payments-service, notifications-service.
 * TODO: Extract to @sapar/shared package when monorepo tooling is set up.
 * Any changes must be applied to all copies.
 */
import { Prisma } from '@prisma/client';
import { EventEnvelope } from './event-envelope';

export interface EventHandler {
  readonly eventType: string;
  handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void>;
}
