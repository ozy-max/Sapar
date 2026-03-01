import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EmailProvider, ProviderResult, FakeScenario } from './provider.interface';

@Injectable()
export class FakeEmailProvider implements EmailProvider {
  private scenario: FakeScenario = 'success';

  setScenario(scenario: FakeScenario): void {
    this.scenario = scenario;
  }

  async send(_to: string, _subject: string, _body: string): Promise<ProviderResult> {
    switch (this.scenario) {
      case 'success':
        return { providerMessageId: `email-${randomUUID()}` };
      case 'failure':
        throw new Error('EMAIL_PROVIDER_ERROR');
      case 'timeout':
        return new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error('EMAIL_PROVIDER_TIMEOUT')), 60_000);
        });
    }
  }
}
