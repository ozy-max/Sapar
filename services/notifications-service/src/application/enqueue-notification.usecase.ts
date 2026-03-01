import { Injectable, Logger } from '@nestjs/common';
import { NotificationRepository } from '../adapters/db/notification.repository';
import { NotificationEventRepository } from '../adapters/db/notification-event.repository';
import { PrismaService } from '../adapters/db/prisma.service';
import { getTemplate } from '../domain/templates';
import { TemplateNotFoundError, IdempotencyConflictError } from '../shared/errors';

export interface EnqueueInput {
  userId: string;
  channel: 'SMS' | 'EMAIL' | 'PUSH';
  templateKey: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface EnqueueOutput {
  notificationId: string;
  status: string;
}

function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const sorted = Object.keys(obj as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`);
  return `{${sorted.join(',')}}`;
}

@Injectable()
export class EnqueueNotificationUseCase {
  private readonly logger = new Logger(EnqueueNotificationUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifRepo: NotificationRepository,
    private readonly eventRepo: NotificationEventRepository,
  ) {}

  async execute(input: EnqueueInput): Promise<EnqueueOutput> {
    const template = getTemplate(input.templateKey, input.channel);
    if (!template) {
      throw new TemplateNotFoundError(input.templateKey, input.channel);
    }

    if (input.idempotencyKey) {
      const existing = await this.notifRepo.findByIdempotencyKey(
        input.idempotencyKey,
        input.userId,
      );

      if (existing) {
        const samePayload =
          existing.channel === input.channel &&
          existing.templateKey === input.templateKey &&
          stableStringify(existing.payloadJson) === stableStringify(input.payload);

        if (!samePayload) {
          throw new IdempotencyConflictError();
        }

        return { notificationId: existing.id, status: existing.status };
      }
    }

    const notification = await this.prisma.$transaction(async (tx) => {
      const notif = await this.notifRepo.create(
        {
          userId: input.userId,
          channel: input.channel,
          templateKey: input.templateKey,
          payloadJson: input.payload,
          idempotencyKey: input.idempotencyKey,
        },
        tx,
      );

      await this.eventRepo.create(
        {
          notificationId: notif.id,
          type: 'ENQUEUED',
          payloadJson: { channel: input.channel, templateKey: input.templateKey },
        },
        tx,
      );

      return notif;
    });

    this.logger.log(`Notification ${notification.id} enqueued for user ${input.userId}`);

    return { notificationId: notification.id, status: notification.status };
  }
}
