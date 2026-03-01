import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PspAdapter, PlaceHoldResult, ReceiptIssuer } from './psp.interface';

export type FakePspScenario = 'success' | 'failure' | 'timeout';

@Injectable()
export class FakePspAdapter implements PspAdapter {
  private scenario: FakePspScenario = 'success';

  setScenario(scenario: FakePspScenario): void {
    this.scenario = scenario;
  }

  async placeHold(
    amount: number,
    currency: string,
    _metadata: Record<string, string>,
  ): Promise<PlaceHoldResult> {
    await this.maybeThrow(`placeHold(${amount} ${currency})`);
    return { pspIntentId: `fake_hold_${randomUUID()}` };
  }

  async capture(pspIntentId: string): Promise<void> {
    await this.maybeThrow(`capture(${pspIntentId})`);
  }

  async cancelHold(pspIntentId: string): Promise<void> {
    await this.maybeThrow(`cancelHold(${pspIntentId})`);
  }

  async refund(pspIntentId: string, _amount?: number): Promise<void> {
    await this.maybeThrow(`refund(${pspIntentId})`);
  }

  async getStatus(_pspIntentId: string): Promise<{ status: string }> {
    return { status: 'hold_placed' };
  }

  private async maybeThrow(operation: string): Promise<void> {
    if (this.scenario === 'failure') {
      throw new Error(`PSP failure: ${operation}`);
    }
    if (this.scenario === 'timeout') {
      await new Promise(() => {
        /* never resolves — caller's timeout will fire */
      });
    }
  }
}

@Injectable()
export class FakeReceiptIssuer implements ReceiptIssuer {
  private shouldFail = false;

  setShouldFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  async issueReceipt(_paymentIntentId: string, _amount: number, _currency: string): Promise<void> {
    if (this.shouldFail) {
      throw new Error('Receipt issuing failed (fake)');
    }
  }
}
