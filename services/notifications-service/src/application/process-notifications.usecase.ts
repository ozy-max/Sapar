import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../adapters/db/prisma.service';
import { NotificationRepository, NotificationRow } from '../adapters/db/notification.repository';
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

const CLAIM_WINDOW_SEC = 120;

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
        await this.processOneNotification(
          notifId,
          env.PROVIDER_TIMEOUT_MS,
          maxRetries,
          backoff,
          result,
        );
      } catch (error) {
        this.logger.error(error, `Failed to process notification ${notifId}`);
      }
    }

    return result;
  }

  private async processOneNotification(
    notifId: string,
    providerTimeoutMs: number,
    maxRetries: number,
    backoff: number[],
    result: NotificationProcessResult,
  ): Promise<void> {
    const claimed = await this.claimNotification(notifId);
    if (!claimed) return;

    const { row, nextTry } = claimed;
    const channel = row.channel as 'SMS' | 'EMAIL' | 'PUSH';
    const chKey = channel.toLowerCase();
    if (!result.channels[chKey]) result.channels[chKey] = emptyChannelStats();
    const chStats = result.channels[chKey]!;

    const template = getTemplate(row.template_key, channel);
    if (!template) {
      this.logger.warn(
        `Notification ${row.id}: template '${row.template_key}' not found for channel '${channel}', marking FAILED_FINAL`,
      );
      await this.markFailedFinal(row.id, nextTry, 'TEMPLATE_NOT_FOUND');
      result.failedFinal++;
      chStats.failedFinal++;
      result.total++;
      return;
    }

    const payload = (row.payload_json ?? {}) as Record<string, unknown>;
    let sendResult: ProviderResult | undefined;
    let sendError: string | undefined;

    try {
      sendResult = await this.sendViaProvider(channel, row.user_id, template, payload, providerTimeoutMs);
    } catch (error) {
      sendError = error instanceof Error ? error.message : String(error);
    }

    if (sendResult) {
      await this.markSent(row, nextTry, sendResult);
      result.sent++;
      chStats.sent++;
      this.logger.log(`Notification ${row.id} sent on try ${nextTry}`);
    } else if (nextTry >= maxRetries) {
      await this.markFailedFinal(row.id, nextTry, sendError ?? 'Unknown error');
      result.failedFinal++;
      chStats.failedFinal++;
      this.logger.error(
        `Notification ${row.id} reached max retries (${maxRetries}), marking FAILED_FINAL`,
      );
    } else {
      const delaySec = backoff[nextTry - 1] ?? backoff[backoff.length - 1]!;
      const nextRetryAt = new Date(Date.now() + delaySec * 1000);
      await this.markRetry(row.id, nextTry, nextRetryAt, sendError ?? 'Unknown error');
      result.retried++;
      chStats.retried++;
      this.logger.warn(
        `Notification ${row.id} failed try ${nextTry}, next retry at ${nextRetryAt.toISOString()}`,
      );
    }

    result.total++;
  }

  private async claimNotification(
    notifId: string,
  ): Promise<{ row: NotificationRow; nextTry: number } | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await this.notifRepo.lockById(notifId, tx);
        if (!row) return null;

        const nextTry = row.try_count + 1;
        const claimUntil = new Date(Date.now() + CLAIM_WINDOW_SEC * 1000);
        await this.notifRepo.updateStatus(
          row.id,
          'FAILED_RETRY',
          { tryCount: nextTry, nextRetryAt: claimUntil, lastError: 'CLAIMED' },
          tx,
        );

        return { row, nextTry };
      },
      { timeout: 5_000 },
    );
  }

  private async markSent(
    row: NotificationRow,
    nextTry: number,
    sendResult: ProviderResult,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
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
      },
      { timeout: 5_000 },
    );
  }

  private async markFailedFinal(
    notifId: string,
    nextTry: number,
    errorMsg: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await this.notifRepo.updateStatus(
          notifId,
          'FAILED_FINAL',
          { tryCount: nextTry, lastError: errorMsg },
          tx,
        );
        await this.eventRepo.create(
          {
            notificationId: notifId,
            type: 'FAILED_FINAL',
            payloadJson: { error: errorMsg, try: nextTry },
          },
          tx,
        );
      },
      { timeout: 5_000 },
    );
  }

  private async markRetry(
    notifId: string,
    nextTry: number,
    nextRetryAt: Date,
    errorMsg: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await this.notifRepo.updateStatus(
          notifId,
          'FAILED_RETRY',
          { tryCount: nextTry, nextRetryAt, lastError: errorMsg },
          tx,
        );
        await this.eventRepo.create(
          {
            notificationId: notifId,
            type: 'FAILED_RETRY',
            payloadJson: {
              error: errorMsg,
              try: nextTry,
              nextRetryAt: nextRetryAt.toISOString(),
            },
          },
          tx,
        );
      },
      { timeout: 5_000 },
    );
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
