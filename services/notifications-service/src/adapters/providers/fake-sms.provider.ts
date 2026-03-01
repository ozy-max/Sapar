import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SmsProvider, ProviderResult, FakeScenario } from './provider.interface';

@Injectable()
export class FakeSmsProvider implements SmsProvider {
  private scenario: FakeScenario = 'success';

  setScenario(scenario: FakeScenario): void {
    this.scenario = scenario;
  }

  async send(_to: string, _text: string): Promise<ProviderResult> {
    switch (this.scenario) {
      case 'success':
        return { providerMessageId: `sms-${randomUUID()}` };
      case 'failure':
        throw new Error('SMS_PROVIDER_ERROR');
      case 'timeout':
        return new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('SMS_PROVIDER_TIMEOUT')), 60_000);
        });
    }
  }
}
