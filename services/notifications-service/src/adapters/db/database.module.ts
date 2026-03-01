import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { NotificationRepository } from './notification.repository';
import { NotificationEventRepository } from './notification-event.repository';
import { OutboxEventRepository } from './outbox-event.repository';
import { ConsumedEventRepository } from './consumed-event.repository';
import { OutboxService } from '../../shared/outbox.service';

@Global()
@Module({
  providers: [
    PrismaService,
    NotificationRepository,
    NotificationEventRepository,
    OutboxEventRepository,
    ConsumedEventRepository,
    OutboxService,
  ],
  exports: [
    PrismaService,
    NotificationRepository,
    NotificationEventRepository,
    OutboxEventRepository,
    ConsumedEventRepository,
    OutboxService,
  ],
})
export class DatabaseModule {}
