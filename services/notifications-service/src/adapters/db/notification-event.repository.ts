import { Injectable } from '@nestjs/common';
import { NotificationEvent, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class NotificationEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: {
      notificationId: string;
      type: string;
      payloadJson?: object;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<NotificationEvent> {
    const client = tx ?? this.prisma;
    return client.notificationEvent.create({
      data: {
        notificationId: data.notificationId,
        type: data.type,
        payloadJson: data.payloadJson ?? {},
      },
    });
  }
}
