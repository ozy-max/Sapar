import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../adapters/db/prisma.service';
import { NotificationRepository } from '../adapters/db/notification.repository';
import { NotificationEventRepository } from '../adapters/db/notification-event.repository';
import { OutboxService } from '../shared/outbox.service';
import {
  SMS_PROVIDER,
  EMAIL_PROVIDER,
  PUSH_PROVIDER,
  SmsProvider,
  EmailProvider,
  PushProvider,
  ProviderResult,
} from '../adapters/providers/provider.interface';
import { getTemplate, renderTemplate } from '../domain/templates';
import { loadEnv, getBackoffSchedule } from '../config/env';
import { withTimeout } from '../shared/provider-timeout';

export interface NotificationProcessResult {
  total: number;
  sent: number;
  retried: number;
  failedFinal: number;
  channels: Record<string, { sent: number; retried: number; failedFinal: number }>;
}

function emptyChannelStats(): { sent: number; retried: number; failedFinal: number } {
  return { sent: 0, retried: 0, failedFinal: 0 };
}

@Injectable()
export class ProcessNotificationsUseCase {
  private readonly logger = new Logger(ProcessNotificationsUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifRepo: NotificationRepository,
    private readonly eventRepo: NotificationEventRepository,
    private readonly outboxService: OutboxService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  async processOnce(): Promise<NotificationProcessResult> {
    const env = loadEnv();
    const backoff = getBackoffSchedule();
    const maxRetries = env.NOTIF_RETRY_N;
    const result: NotificationProcessResult = {
      total: 0,
      sent: 0,
      retried: 0,
      failedFinal: 0,
      channels: {},
    };

    const dueIds = await this.notifRepo.findDueIds();

    for (const notifId of dueIds) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            // Provider HTTP call happens inside TX for atomicity; timeout bounds it

            const row = await this.notifRepo.lockById(notifId, tx);
            if (!row) return;

            const nextTry = row.try_count + 1;
            const payload = (row.payload_json ?? {}) as Record<string, unknown>;
            const channel = row.channel as 'SMS' | 'EMAIL' | 'PUSH';

            const chKey = channel.toLowerCase();
            if (!result.channels[chKey]) result.channels[chKey] = emptyChannelStats();
            const chStats = result.channels[chKey]!;

            const template = getTemplate(row.template_key, channel);
            if (!template) {
              this.logger.warn(
                `Notification ${row.id}: template '${row.template_key}' not found for channel '${channel}', marking FAILED_FINAL`,
              );
              await this.notifRepo.updateStatus(
                row.id,
                'FAILED_FINAL',
                { tryCount: nextTry, lastError: 'TEMPLATE_NOT_FOUND' },
                tx,
              );
              result.failedFinal++;
              chStats.failedFinal++;
              return;
            }

            try {
              const sendResult = await this.sendViaProvider(
                channel,
                row.user_id,
                template,
                payload,
                env.PROVIDER_TIMEOUT_MS,
              );

              await this.notifRepo.updateStatus(
                row.id,
                'SENT',
                { tryCount: nextTry, providerMessageId: sendResult.providerMessageId },
                tx,
              );

              await this.eventRepo.create(
                {
                  notificationId: row.id,
                  type: 'SENT',
                  payloadJson: { providerMessageId: sendResult.providerMessageId, try: nextTry },
                },
                tx,
              );

              await this.outboxService.publish(
                {
                  eventType: 'notification.sent',
                  payload: {
                    notificationId: row.id,
                    userId: row.user_id,
                    channel: row.channel,
                  },
                  traceId: randomUUID(),
                },
                tx,
              );

              result.sent++;
              chStats.sent++;
              this.logger.log(`Notification ${row.id} sent on try ${nextTry}`);
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);

              if (nextTry >= maxRetries) {
                await this.notifRepo.updateStatus(
                  row.id,
                  'FAILED_FINAL',
                  { tryCount: nextTry, lastError: errorMsg },
                  tx,
                );
                await this.eventRepo.create(
                  {
                    notificationId: row.id,
                    type: 'FAILED_FINAL',
                    payloadJson: { error: errorMsg, try: nextTry },
                  },
                  tx,
                );
                await this.outboxService.publish(
                  {
                    eventType: 'notification.failed_final',
                    payload: {
                      notificationId: row.id,
                      userId: row.user_id,
                      channel: row.channel,
                      error: errorMsg,
                    },
                    traceId: randomUUID(),
                  },
                  tx,
                );

                result.failedFinal++;
                chStats.failedFinal++;
                this.logger.error(
                  `Notification ${row.id} reached max retries (${maxRetries}), marking FAILED_FINAL`,
                );
              } else {
                const delaySec = backoff[nextTry - 1] ?? backoff[backoff.length - 1]!;
                const nextRetryAt = new Date(Date.now() + delaySec * 1000);

                await this.notifRepo.updateStatus(
                  row.id,
                  'FAILED_RETRY',
                  { tryCount: nextTry, nextRetryAt, lastError: errorMsg },
                  tx,
                );
                await this.eventRepo.create(
                  {
                    notificationId: row.id,
                    type: 'FAILED_RETRY',
                    payloadJson: {
                      error: errorMsg,
                      try: nextTry,
                      nextRetryAt: nextRetryAt.toISOString(),
                    },
                  },
                  tx,
                );
                result.retried++;
                chStats.retried++;
                this.logger.warn(
                  `Notification ${row.id} failed try ${nextTry}, next retry at ${nextRetryAt.toISOString()}`,
                );
              }
            }
          },
          { timeout: 15_000 },
        );

        result.total++;
      } catch (error) {
        this.logger.error(error, `Failed to process notification ${notifId}`);
      }
    }

    return result;
  }

  private async sendViaProvider(
    channel: 'SMS' | 'EMAIL' | 'PUSH',
    userId: string,
    template: { subject?: string; body: string },
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<ProviderResult> {
    const renderedBody = renderTemplate(template.body, payload);

    switch (channel) {
      case 'SMS':
        return withTimeout(this.sms.send(userId, renderedBody), timeoutMs);
      case 'EMAIL': {
        const subject = template.subject
          ? renderTemplate(template.subject, payload)
          : 'Notification';
        return withTimeout(this.email.send(userId, subject, renderedBody), timeoutMs);
      }
      case 'PUSH': {
        const title = template.subject ? renderTemplate(template.subject, payload) : 'Sapar';
        return withTimeout(this.push.send(userId, title, renderedBody), timeoutMs);
      }
    }
  }
}
