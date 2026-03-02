import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../adapters/db/prisma.service';
import { AuditLogRepository } from '../adapters/db/audit-log.repository';
import { ConfigNotFoundError } from '../shared/errors';

interface DeleteConfigInput {
  key: string;
  actorUserId: string;
  actorRoles: string[];
  traceId: string;
}

@Injectable()
export class DeleteConfigUseCase {
  private readonly logger = new Logger(DeleteConfigUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  async execute(input: DeleteConfigInput): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.config.findUnique({ where: { key: input.key } });
        if (!existing) {
          throw new ConfigNotFoundError(input.key);
        }

        try {
          await tx.config.delete({ where: { key: input.key } });
        } catch (error: unknown) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            throw new ConfigNotFoundError(input.key);
          }
          throw error;
        }

        await this.auditLogRepo.create(
          {
            actorUserId: input.actorUserId,
            actorRoles: input.actorRoles,
            action: 'CONFIG_DELETE',
            targetType: 'Config',
            targetId: input.key,
            payloadJson: { deletedValue: existing.valueJson },
            traceId: input.traceId,
          },
          tx,
        );
      },
      { timeout: 5_000 },
    );

    this.logger.log(`Config deleted: key=${input.key} by=${input.actorUserId}`);
  }
}
