import { Prisma } from '@prisma/client';
import { EventEnvelope } from './event-envelope';

export interface EventHandler {
  readonly eventType: string;
  handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void>;
}
