import { Global, Module } from '@nestjs/common';
import { PSP_ADAPTER, RECEIPT_ISSUER } from './psp.interface';
import { FakePspAdapter, FakeReceiptIssuer } from './fake-psp.adapter';
import { InstrumentedPspAdapter, InstrumentedReceiptIssuer } from '../../observability/psp-metrics.adapter';

@Global()
@Module({
  providers: [
    FakePspAdapter,
    InstrumentedPspAdapter,
    { provide: PSP_ADAPTER, useExisting: InstrumentedPspAdapter },
    FakeReceiptIssuer,
    InstrumentedReceiptIssuer,
    { provide: RECEIPT_ISSUER, useExisting: InstrumentedReceiptIssuer },
  ],
  exports: [PSP_ADAPTER, FakePspAdapter, RECEIPT_ISSUER, FakeReceiptIssuer],
})
export class PspModule {}
