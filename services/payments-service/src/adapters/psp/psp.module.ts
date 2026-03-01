import { Global, Module } from '@nestjs/common';
import { PSP_ADAPTER, RECEIPT_ISSUER } from './psp.interface';
import { FakePspAdapter, FakeReceiptIssuer } from './fake-psp.adapter';
import {
  InstrumentedPspAdapter,
  InstrumentedReceiptIssuer,
} from '../../observability/psp-metrics.adapter';
import { PspWithCircuitBreaker } from './psp-with-breaker';

@Global()
@Module({
  providers: [
    FakePspAdapter,
    InstrumentedPspAdapter,
    {
      provide: PSP_ADAPTER,
      useFactory: (instrumented: InstrumentedPspAdapter) => new PspWithCircuitBreaker(instrumented),
      inject: [InstrumentedPspAdapter],
    },
    FakeReceiptIssuer,
    InstrumentedReceiptIssuer,
    { provide: RECEIPT_ISSUER, useExisting: InstrumentedReceiptIssuer },
  ],
  exports: [PSP_ADAPTER, FakePspAdapter, RECEIPT_ISSUER, FakeReceiptIssuer],
})
export class PspModule {}
