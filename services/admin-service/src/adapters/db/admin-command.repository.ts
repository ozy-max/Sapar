import { Injectable } from '@nestjs/common';
import { AdminCommand, AdminCommandType, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class AdminCommandRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: {
      targetService: string;
      type: AdminCommandType;
      payload: unknown;
      createdBy: string;
      traceId: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<AdminCommand> {
    const client = tx ?? this.prisma;
    return client.adminCommand.create({
      data: {
        targetService: data.targetService,
        type: data.type,
        payload: data.payload as never,
        createdBy: data.createdBy,
        traceId: data.traceId,
      },
    });
  }

  async findPendingByService(service: string, limit: number): Promise<AdminCommand[]> {
    const rows = await this.prisma.$queryRaw<AdminCommand[]>`
      SELECT id, target_service AS "targetService", type, payload, status,
             try_count AS "tryCount", next_retry_at AS "nextRetryAt",
             last_error AS "lastError", trace_id AS "traceId",
             created_by AS "createdBy", created_at AS "createdAt",
             updated_at AS "updatedAt"
      FROM admin_commands
      WHERE target_service = ${service}
        AND status IN ('PENDING'::"AdminCommandStatus", 'FAILED_RETRY'::"AdminCommandStatus")
        AND next_retry_at <= NOW()
      ORDER BY next_retry_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    return rows;
  }

  async markApplied(id: string): Promise<void> {
    await this.prisma.adminCommand.update({
      where: { id },
      data: { status: 'APPLIED' },
    });
  }

  async markFailedRetry(
    id: string,
    tryCount: number,
    nextRetryAt: Date,
    lastError: string,
  ): Promise<void> {
    await this.prisma.adminCommand.update({
      where: { id },
      data: {
        status: 'FAILED_RETRY',
        tryCount,
        nextRetryAt,
        lastError,
      },
    });
  }

  async markFailedFinal(id: string, tryCount: number, lastError: string): Promise<void> {
    await this.prisma.adminCommand.update({
      where: { id },
      data: {
        status: 'FAILED_FINAL',
        tryCount,
        lastError,
      },
    });
  }

  async findById(id: string): Promise<AdminCommand | null> {
    return this.prisma.adminCommand.findUnique({ where: { id } });
  }

  async ack(
    id: string,
    status: 'APPLIED' | 'FAILED_RETRY' | 'FAILED_FINAL',
    error?: string,
  ): Promise<AdminCommand> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<AdminCommand[]>`
        SELECT * FROM admin_commands
        WHERE id = ${id}::uuid
          AND status IN ('PENDING'::"AdminCommandStatus", 'FAILED_RETRY'::"AdminCommandStatus")
        FOR UPDATE
      `;
      const command = rows[0];
      if (!command) {
        const existing = await tx.adminCommand.findUnique({ where: { id } });
        if (!existing) throw new Error(`AdminCommand ${id} not found`);
        return existing;
      }

      const nextTry = command.tryCount + 1;

      const data: Prisma.AdminCommandUpdateInput = { tryCount: nextTry };
      if (status === 'APPLIED') {
        data.status = 'APPLIED';
      } else if (status === 'FAILED_FINAL') {
        data.status = 'FAILED_FINAL';
        data.lastError = error;
      } else {
        const backoffSec = Math.min(30 * Math.pow(2, nextTry - 1), 900);
        data.status = 'FAILED_RETRY';
        data.nextRetryAt = new Date(Date.now() + backoffSec * 1000);
        data.lastError = error;
      }

      return tx.adminCommand.update({ where: { id }, data });
    });
  }
}
