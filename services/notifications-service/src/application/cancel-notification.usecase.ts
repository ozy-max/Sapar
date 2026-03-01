import { Injectable, Logger } from '@nestjs/common';
import { NotificationRepository } from '../adapters/db/notification.repository';
import { NotificationEventRepository } from '../adapters/db/notification-event.repository';
import { PrismaService } from '../adapters/db/prisma.service';
import { NotificationNotFoundError, InvalidStateError } from '../shared/errors';

export interface CancelOutput {
  notificationId: string;
  status: string;
}

@Injectable()
export class CancelNotificationUseCase {
  private readonly logger = new Logger(CancelNotificationUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifRepo: NotificationRepository,
    private readonly eventRepo: NotificationEventRepository,
  ) {}

  async execute(id: string, userId: string): Promise<CancelOutput> {
    await this.prisma.$transaction(async (tx) => {
      const notif = await this.notifRepo.lockById(id, tx);
      if (!notif || notif.user_id !== userId) {
        throw new NotificationNotFoundError();
      }

      if (notif.status !== 'PENDING' && notif.status !== 'FAILED_RETRY') {
        throw new InvalidStateError(
          `Cannot cancel notification in status '${notif.status}'`,
        );
      }

      await this.notifRepo.updateStatus(id, 'CANCELLED', undefined, tx);
      await this.eventRepo.create(
        {
          notificationId: id,
          type: 'CANCELLED',
          payloadJson: { previousStatus: notif.status },
        },
        tx,
      );
    }, { timeout: 5000 });

    this.logger.log(`Notification ${id} cancelled`);

    return { notificationId: id, status: 'CANCELLED' };
  }
}
