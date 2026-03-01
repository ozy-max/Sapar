import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PushProvider, ProviderResult, FakeScenario } from './provider.interface';

@Injectable()
export class FakePushProvider implements PushProvider {
  private scenario: FakeScenario = 'success';

  setScenario(scenario: FakeScenario): void {
    this.scenario = scenario;
  }

  async send(_userId: string, _title: string, _body: string): Promise<ProviderResult> {
    switch (this.scenario) {
      case 'success':
        return { providerMessageId: `push-${randomUUID()}` };
      case 'failure':
        throw new Error('PUSH_PROVIDER_ERROR');
      case 'timeout':
        return new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('PUSH_PROVIDER_TIMEOUT')), 60_000);
        });
    }
  }
}
