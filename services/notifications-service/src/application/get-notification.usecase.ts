import { Injectable } from '@nestjs/common';
import { NotificationRepository } from '../adapters/db/notification.repository';
import { NotificationNotFoundError } from '../shared/errors';

export interface GetNotificationOutput {
  id: string;
  userId: string;
  channel: string;
  templateKey: string;
  status: string;
  tryCount: number;
  providerMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class GetNotificationUseCase {
  constructor(private readonly notifRepo: NotificationRepository) {}

  async execute(id: string): Promise<GetNotificationOutput> {
    const notif = await this.notifRepo.findById(id);
    if (!notif) {
      throw new NotificationNotFoundError();
    }

    return {
      id: notif.id,
      userId: notif.userId,
      channel: notif.channel,
      templateKey: notif.templateKey,
      status: notif.status,
      tryCount: notif.tryCount,
      providerMessageId: notif.providerMessageId,
      createdAt: notif.createdAt.toISOString(),
      updatedAt: notif.updatedAt.toISOString(),
    };
  }
}
