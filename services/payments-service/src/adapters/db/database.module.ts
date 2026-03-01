import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PaymentIntentRepository } from './payment-intent.repository';
import { PaymentEventRepository } from './payment-event.repository';
import { ReceiptRepository } from './receipt.repository';
import { OutboxEventRepository } from './outbox-event.repository';
import { ConsumedEventRepository } from './consumed-event.repository';
import { OutboxService } from '../../shared/outbox.service';

@Global()
@Module({
  providers: [
    PrismaService,
    PaymentIntentRepository,
    PaymentEventRepository,
    ReceiptRepository,
    OutboxEventRepository,
    ConsumedEventRepository,
    OutboxService,
  ],
  exports: [
    PrismaService,
    PaymentIntentRepository,
    PaymentEventRepository,
    ReceiptRepository,
    OutboxEventRepository,
    ConsumedEventRepository,
    OutboxService,
  ],
})
export class DatabaseModule {}
