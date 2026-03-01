import { Injectable } from '@nestjs/common';
import { Prisma, PaymentEvent, PaymentEventType } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface CreateEventData {
  paymentIntentId: string;
  type: PaymentEventType;
  externalEventId?: string;
  payloadJson?: Prisma.InputJsonValue;
}

@Injectable()
export class PaymentEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: CreateEventData,
    tx?: Prisma.TransactionClient,
  ): Promise<PaymentEvent> {
    const client = tx ?? this.prisma;
    return client.paymentEvent.create({
      data: {
        paymentIntentId: data.paymentIntentId,
        type: data.type,
        externalEventId: data.externalEventId,
        payloadJson: data.payloadJson ?? {},
      },
    });
  }

  async existsByExternalEventId(externalEventId: string): Promise<boolean> {
    const event = await this.prisma.paymentEvent.findUnique({
      where: { externalEventId },
      select: { id: true },
    });
    return event !== null;
  }
}
