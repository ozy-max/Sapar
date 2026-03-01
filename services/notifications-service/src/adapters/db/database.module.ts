import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { NotificationRepository } from './notification.repository';
import { NotificationEventRepository } from './notification-event.repository';

@Global()
@Module({
  providers: [PrismaService, NotificationRepository, NotificationEventRepository],
  exports: [PrismaService, NotificationRepository, NotificationEventRepository],
})
export class DatabaseModule {}
