import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PaymentIntentRepository } from './payment-intent.repository';
import { PaymentEventRepository } from './payment-event.repository';
import { ReceiptRepository } from './receipt.repository';

@Global()
@Module({
  providers: [
    PrismaService,
    PaymentIntentRepository,
    PaymentEventRepository,
    ReceiptRepository,
  ],
  exports: [
    PrismaService,
    PaymentIntentRepository,
    PaymentEventRepository,
    ReceiptRepository,
  ],
})
export class DatabaseModule {}
