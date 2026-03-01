import { Injectable } from '@nestjs/common';
import { PspAdapter, PlaceHoldResult, ReceiptIssuer } from '../adapters/psp/psp.interface';
import { FakePspAdapter, FakeReceiptIssuer } from '../adapters/psp/fake-psp.adapter';
import { externalCallDurationMs, externalCallErrorsTotal } from './metrics.registry';

function observe(provider: string, operation: string, startMs: number): void {
  externalCallDurationMs.labels(provider, operation).observe(performance.now() - startMs);
}

function observeError(provider: string, operation: string): void {
  externalCallErrorsTotal.labels(provider, operation).inc();
}

@Injectable()
export class InstrumentedPspAdapter implements PspAdapter {
  constructor(private readonly inner: FakePspAdapter) {}

  async placeHold(
    amount: number,
    currency: string,
    metadata: Record<string, string>,
  ): Promise<PlaceHoldResult> {
    const start = performance.now();
    try {
      const result = await this.inner.placeHold(amount, currency, metadata);
      observe('psp', 'placeHold', start);
      return result;
    } catch (error) {
      observe('psp', 'placeHold', start);
      observeError('psp', 'placeHold');
      throw error;
    }
  }

  async capture(pspIntentId: string): Promise<void> {
    const start = performance.now();
    try {
      await this.inner.capture(pspIntentId);
      observe('psp', 'capture', start);
    } catch (error) {
      observe('psp', 'capture', start);
      observeError('psp', 'capture');
      throw error;
    }
  }

  async cancelHold(pspIntentId: string): Promise<void> {
    const start = performance.now();
    try {
      await this.inner.cancelHold(pspIntentId);
      observe('psp', 'cancelHold', start);
    } catch (error) {
      observe('psp', 'cancelHold', start);
      observeError('psp', 'cancelHold');
      throw error;
    }
  }

  async refund(pspIntentId: string, amount?: number): Promise<void> {
    const start = performance.now();
    try {
      await this.inner.refund(pspIntentId, amount);
      observe('psp', 'refund', start);
    } catch (error) {
      observe('psp', 'refund', start);
      observeError('psp', 'refund');
      throw error;
    }
  }
}

@Injectable()
export class InstrumentedReceiptIssuer implements ReceiptIssuer {
  constructor(private readonly inner: FakeReceiptIssuer) {}

  async issueReceipt(
    paymentIntentId: string,
    amount: number,
    currency: string,
  ): Promise<void> {
    const start = performance.now();
    try {
      await this.inner.issueReceipt(paymentIntentId, amount, currency);
      observe('receipt_issuer', 'issueReceipt', start);
    } catch (error) {
      observe('receipt_issuer', 'issueReceipt', start);
      observeError('receipt_issuer', 'issueReceipt');
      throw error;
    }
  }
}
