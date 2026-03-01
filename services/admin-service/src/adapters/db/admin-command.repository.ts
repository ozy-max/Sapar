import { Injectable } from '@nestjs/common';
import { AdminCommand, AdminCommandType } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class AdminCommandRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    type: AdminCommandType;
    payload: unknown;
    createdBy: string;
  }): Promise<AdminCommand> {
    return this.prisma.adminCommand.create({
      data: {
        type: data.type,
        payload: data.payload as never,
        createdBy: data.createdBy,
      },
    });
  }
}
