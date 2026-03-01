export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export interface ProviderResult {
  providerMessageId: string;
}

export interface SmsProvider {
  send(to: string, text: string): Promise<ProviderResult>;
}

export interface EmailProvider {
  send(to: string, subject: string, body: string): Promise<ProviderResult>;
}

export interface PushProvider {
  send(userId: string, title: string, body: string): Promise<ProviderResult>;
}

export type FakeScenario = 'success' | 'failure' | 'timeout';
