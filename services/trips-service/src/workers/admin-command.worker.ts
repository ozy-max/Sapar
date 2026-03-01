import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { TripStatus } from '@prisma/client';
import { PrismaService } from '../adapters/db/prisma.service';
import { OutboxService } from '../shared/outbox.service';
import { loadEnv } from '../config/env';
import { signEvent } from '../shared/hmac';

interface AdminCommandItem {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  traceId: string;
}

@Injectable()
export class AdminCommandWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminCommandWorker.name);
  private intervalHandle?: ReturnType<typeof setInterval>;
  private currentTick?: Promise<void>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxService: OutboxService,
  ) {}

  onModuleInit(): void {
    const env = loadEnv();
    if (env.NODE_ENV === 'test') {
      this.logger.log('AdminCommandWorker disabled in test environment');
      return;
    }
    this.logger.log(`Starting AdminCommandWorker, poll interval: ${env.COMMAND_POLL_INTERVAL_MS}ms`);
    this.intervalHandle = setInterval(() => {
      this.currentTick = this.tick();
    }, env.COMMAND_POLL_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    if (this.currentTick) await this.currentTick;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const commands = await this.fetchCommands();
      for (const cmd of commands) {
        await this.processCommand(cmd);
      }
    } catch (error) {
      this.logger.error(error, 'AdminCommandWorker tick failed');
    } finally {
      this.running = false;
    }
  }

  private async fetchCommands(): Promise<AdminCommandItem[]> {
    const env = loadEnv();
    const url = `${env.ADMIN_BASE_URL}/internal/commands?service=trips&limit=10`;
    const body = '';
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signEvent(body, timestamp, env.EVENTS_HMAC_SECRET);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.COMMAND_POLL_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Event-Signature': signature,
          'X-Event-Timestamp': String(timestamp),
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.warn(`Failed to fetch commands: HTTP ${response.status}`);
        return [];
      }

      const data = (await response.json()) as { items: AdminCommandItem[] };
      return data.items;
    } catch (error) {
      clearTimeout(timeout);
      this.logger.warn(`Failed to fetch commands: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async processCommand(cmd: AdminCommandItem): Promise<void> {
    const startMs = Date.now();
    let ackStatus: 'APPLIED' | 'FAILED_RETRY' = 'APPLIED';
    let ackError: string | undefined;

    try {
      switch (cmd.type) {
        case 'CANCEL_TRIP': {
          const p = cmd.payload as { tripId: string; reason: string };
          await this.cancelTrip(p.tripId, p.reason, cmd.traceId);
          break;
        }
        default:
          this.logger.warn({ msg: 'Unknown command type', type: cmd.type, commandId: cmd.id });
      }
    } catch (error) {
      ackStatus = 'FAILED_RETRY';
      ackError = error instanceof Error ? error.message : String(error);
      this.logger.error({ msg: 'Command processing failed', commandId: cmd.id, error: ackError, traceId: cmd.traceId });
    }

    await this.ackCommand(cmd.id, ackStatus, ackError);
    const durationMs = Date.now() - startMs;
    this.logger.log({ msg: 'Command processed', commandId: cmd.id, type: cmd.type, status: ackStatus, durationMs, traceId: cmd.traceId });
  }

  /**
   * Admin-initiated cancellation — no ownership check, allows any non-terminal status,
   * emits adminCancelled flag. Intentionally separate from CancelTripUseCase which
   * enforces driver ownership and stricter status checks.
   */
  private async cancelTrip(tripId: string, reason: string, traceId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const trips = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM trips WHERE id = ${tripId}::uuid FOR UPDATE
      `;

      const trip = trips[0];
      if (!trip) {
        this.logger.log({ msg: 'Trip not found for admin cancel', tripId, traceId });
        return;
      }

      if (trip.status === 'CANCELLED' || trip.status === 'COMPLETED') {
        this.logger.log({ msg: 'Trip already terminal', tripId, status: trip.status, traceId });
        return;
      }

      await tx.trip.update({
        where: { id: tripId },
        data: { status: TripStatus.CANCELLED },
      });

      const bookingsToCancel = await tx.booking.findMany({
        where: {
          tripId,
          status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
        },
        select: { id: true, passengerId: true, seats: true, status: true },
      });

      await tx.booking.updateMany({
        where: {
          tripId,
          status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
        },
        data: { status: 'CANCELLED' },
      });

      for (const booking of bookingsToCancel) {
        await this.outboxService.publish(
          {
            eventType: 'booking.cancelled',
            payload: {
              bookingId: booking.id,
              tripId,
              passengerId: booking.passengerId,
              seats: booking.seats,
              reason: 'ADMIN_CANCELLED',
            },
            traceId,
          },
          tx,
        );
      }

      await this.outboxService.publish(
        {
          eventType: 'trip.cancelled',
          payload: { tripId, reason, adminCancelled: true },
          traceId,
        },
        tx,
      );
    }, { timeout: 15_000 });
  }

  private async ackCommand(
    id: string,
    status: 'APPLIED' | 'FAILED_RETRY',
    error?: string,
  ): Promise<void> {
    const env = loadEnv();
    const url = `${env.ADMIN_BASE_URL}/internal/commands/${id}/ack`;
    const body = JSON.stringify({ status, error });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signEvent(body, timestamp, env.EVENTS_HMAC_SECRET);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.COMMAND_POLL_TIMEOUT_MS);

    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Event-Signature': signature,
          'X-Event-Timestamp': String(timestamp),
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
    } catch (err) {
      clearTimeout(timeout);
      this.logger.warn(`Failed to ack command ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
