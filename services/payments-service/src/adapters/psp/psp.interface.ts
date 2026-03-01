export interface PlaceHoldResult {
  pspIntentId: string;
}

export interface PspAdapter {
  placeHold(
    amount: number,
    currency: string,
    metadata: Record<string, string>,
  ): Promise<PlaceHoldResult>;

  capture(pspIntentId: string): Promise<void>;

  cancelHold(pspIntentId: string): Promise<void>;

  refund(pspIntentId: string, amount?: number): Promise<void>;

  getStatus(pspIntentId: string): Promise<{ status: string }>;
}

export const PSP_ADAPTER = Symbol('PSP_ADAPTER');

export interface ReceiptIssuer {
  issueReceipt(
    paymentIntentId: string,
    amount: number,
    currency: string,
  ): Promise<void>;
}

export const RECEIPT_ISSUER = Symbol('RECEIPT_ISSUER');
