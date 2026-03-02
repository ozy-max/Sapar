/**
 * SHARED CODE — duplicated across services.
 * Canonical source: services/trips-service/src/shared/event-handler.interface.ts
 * TODO: Extract to @sapar/shared package when monorepo tooling is set up.
 * Any changes must be applied to all copies.
 */
import { Prisma } from '@prisma/client';
import { EventEnvelope } from './event-envelope';

export interface EventHandler {
  readonly eventType: string;
  handle(event: EventEnvelope, tx: Prisma.TransactionClient): Promise<void>;
}

/**
 * Handlers that perform external side-effects (PSP calls, HTTP, etc.) MUST
 * implement this interface so the controller does NOT wrap them in a single TX.
 * The handler is responsible for its own transaction management.
 */
export interface SideEffectHandler {
  readonly eventType: string;
  readonly hasSideEffects: true;
  handle(event: EventEnvelope): Promise<void>;
}

export type AnyEventHandler = EventHandler | SideEffectHandler;

export function isSideEffectHandler(h: AnyEventHandler): h is SideEffectHandler {
  return 'hasSideEffects' in h && (h as SideEffectHandler).hasSideEffects === true;
}
