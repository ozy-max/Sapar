import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ConfigRepository } from './config.repository';
import { DisputeRepository } from './dispute.repository';
import { AuditLogRepository } from './audit-log.repository';
import { AdminCommandRepository } from './admin-command.repository';

@Global()
@Module({
  providers: [
    PrismaService,
    ConfigRepository,
    DisputeRepository,
    AuditLogRepository,
    AdminCommandRepository,
  ],
  exports: [
    PrismaService,
    ConfigRepository,
    DisputeRepository,
    AuditLogRepository,
    AdminCommandRepository,
  ],
})
export class DatabaseModule {}
