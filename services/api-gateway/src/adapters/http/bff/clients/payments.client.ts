import { bffFetch, BffResponse } from './bff-http.client';
import { loadEnv } from '../../../../config/env';

export interface PaymentSummary {
  bookingId: string;
  paymentIntentId: string | null;
  paymentStatus: string | null;
  amountKgs: number | null;
  receiptStatus: string | null;
}

export interface BatchPaymentSummaryResponse {
  items: PaymentSummary[];
}

function paymentsBaseUrl(): string {
  return loadEnv().PAYMENTS_BASE_URL;
}

function timeoutMs(): number {
  return loadEnv().BFF_TIMEOUT_MS;
}

export async function getPaymentSummary(
  bookingId: string,
  headers: Record<string, string>,
): Promise<BffResponse<PaymentSummary>> {
  return bffFetch<PaymentSummary>('payments', {
    baseUrl: paymentsBaseUrl(),
    path: `/bff/bookings/${bookingId}/payment-summary`,
    timeoutMs: timeoutMs(),
    headers,
  });
}

export async function batchPaymentSummary(
  bookingIds: string[],
  headers: Record<string, string>,
): Promise<BffResponse<BatchPaymentSummaryResponse>> {
  return bffFetch<BatchPaymentSummaryResponse>('payments', {
    baseUrl: paymentsBaseUrl(),
    path: '/bff/payments/summary',
    method: 'POST',
    timeoutMs: timeoutMs(),
    headers,
    body: { bookingIds },
  });
}
