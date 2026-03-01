import { Injectable } from '@nestjs/common';
import { AuditLog } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface CreateAuditLogInput {
  actorUserId: string;
  actorRoles: string[];
  action: string;
  targetType: string;
  targetId: string;
  payloadJson?: unknown;
  traceId: string;
}

@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateAuditLogInput): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        actorUserId: data.actorUserId,
        actorRoles: data.actorRoles,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        payloadJson: data.payloadJson as never,
        traceId: data.traceId,
      },
    });
  }

  async findByTarget(targetType: string, targetId: string): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { targetType, targetId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
