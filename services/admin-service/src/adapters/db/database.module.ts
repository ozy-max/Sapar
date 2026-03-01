import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ConfigRepository } from './config.repository';
import { DisputeRepository } from './dispute.repository';
import { AuditLogRepository } from './audit-log.repository';
import { AdminCommandRepository } from './admin-command.repository';
import { OutboxEventRepository } from './outbox-event.repository';

@Global()
@Module({
  providers: [
    PrismaService,
    ConfigRepository,
    DisputeRepository,
    AuditLogRepository,
    AdminCommandRepository,
    OutboxEventRepository,
  ],
  exports: [
    PrismaService,
    ConfigRepository,
    DisputeRepository,
    AuditLogRepository,
    AdminCommandRepository,
    OutboxEventRepository,
  ],
})
export class DatabaseModule {}
