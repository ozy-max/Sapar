import { Global, Module } from '@nestjs/common';
import { SMS_PROVIDER, EMAIL_PROVIDER, PUSH_PROVIDER } from './provider.interface';
import { FakeSmsProvider } from './fake-sms.provider';
import { FakeEmailProvider } from './fake-email.provider';
import { FakePushProvider } from './fake-push.provider';
import {
  InstrumentedSmsProvider,
  InstrumentedEmailProvider,
  InstrumentedPushProvider,
} from '../../observability/provider-metrics.adapter';

@Global()
@Module({
  providers: [
    FakeSmsProvider,
    InstrumentedSmsProvider,
    { provide: SMS_PROVIDER, useExisting: InstrumentedSmsProvider },
    FakeEmailProvider,
    InstrumentedEmailProvider,
    { provide: EMAIL_PROVIDER, useExisting: InstrumentedEmailProvider },
    FakePushProvider,
    InstrumentedPushProvider,
    { provide: PUSH_PROVIDER, useExisting: InstrumentedPushProvider },
  ],
  exports: [
    SMS_PROVIDER,
    FakeSmsProvider,
    EMAIL_PROVIDER,
    FakeEmailProvider,
    PUSH_PROVIDER,
    FakePushProvider,
  ],
})
export class ProvidersModule {}
