import { Injectable } from '@nestjs/common';
import {
  SmsProvider,
  EmailProvider,
  PushProvider,
  ProviderResult,
} from '../adapters/providers/provider.interface';
import { FakeSmsProvider } from '../adapters/providers/fake-sms.provider';
import { FakeEmailProvider } from '../adapters/providers/fake-email.provider';
import { FakePushProvider } from '../adapters/providers/fake-push.provider';
import { externalCallDurationMs, externalCallErrorsTotal } from './metrics.registry';

function observe(provider: string, operation: string, startMs: number): void {
  externalCallDurationMs.labels(provider, operation).observe(performance.now() - startMs);
}

function observeError(provider: string, operation: string): void {
  externalCallErrorsTotal.labels(provider, operation).inc();
}

@Injectable()
export class InstrumentedSmsProvider implements SmsProvider {
  constructor(private readonly inner: FakeSmsProvider) {}

  async send(to: string, text: string): Promise<ProviderResult> {
    const start = performance.now();
    try {
      const result = await this.inner.send(to, text);
      observe('sms', 'send', start);
      return result;
    } catch (error) {
      observe('sms', 'send', start);
      observeError('sms', 'send');
      throw error;
    }
  }
}

@Injectable()
export class InstrumentedEmailProvider implements EmailProvider {
  constructor(private readonly inner: FakeEmailProvider) {}

  async send(to: string, subject: string, body: string): Promise<ProviderResult> {
    const start = performance.now();
    try {
      const result = await this.inner.send(to, subject, body);
      observe('email', 'send', start);
      return result;
    } catch (error) {
      observe('email', 'send', start);
      observeError('email', 'send');
      throw error;
    }
  }
}

@Injectable()
export class InstrumentedPushProvider implements PushProvider {
  constructor(private readonly inner: FakePushProvider) {}

  async send(userId: string, title: string, body: string): Promise<ProviderResult> {
    const start = performance.now();
    try {
      const result = await this.inner.send(userId, title, body);
      observe('push', 'send', start);
      return result;
    } catch (error) {
      observe('push', 'send', start);
      observeError('push', 'send');
      throw error;
    }
  }
}
