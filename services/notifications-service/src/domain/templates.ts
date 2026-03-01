export interface TemplateDefinition {
  subject?: string;
  body: string;
}

type TemplateRegistry = Record<
  string,
  Partial<Record<'SMS' | 'EMAIL' | 'PUSH', TemplateDefinition>>
>;

const templates: TemplateRegistry = {
  BOOKING_CONFIRMED: {
    PUSH: {
      body: 'Бронирование {{bookingId}} подтверждено! Поездка {{route}} {{date}}.',
    },
    EMAIL: {
      subject: 'Бронирование подтверждено — Sapar',
      body: 'Здравствуйте, {{userName}}! Ваше бронирование {{bookingId}} по маршруту {{route}} на {{date}} подтверждено.',
    },
  },
  PAYMENT_CAPTURED: {
    EMAIL: {
      subject: 'Оплата прошла успешно — Sapar',
      body: 'Здравствуйте, {{userName}}! Оплата {{amountKgs}} KGS по бронированию {{bookingId}} успешно списана.',
    },
  },
  BOOKING_CANCELLED: {
    SMS: {
      body: 'Sapar: бронирование {{bookingId}} отменено. Причина: {{reason}}.',
    },
  },
  PAYMENT_HOLD_PLACED: {
    PUSH: {
      body: 'Средства {{amountKgs}} KGS заморожены по бронированию {{bookingId}}. Ожидайте подтверждения.',
    },
    EMAIL: {
      subject: 'Средства заморожены — Sapar',
      body: 'Здравствуйте! По бронированию {{bookingId}} заморожено {{amountKgs}} KGS. Платёж будет списан после подтверждения поездки.',
    },
  },
};

export function getTemplate(
  templateKey: string,
  channel: 'SMS' | 'EMAIL' | 'PUSH',
): TemplateDefinition | null {
  const group = templates[templateKey];
  if (!group) return null;
  return group[channel] ?? null;
}

export function renderTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)}}/g, (_match, key: string) => {
    const value = Object.prototype.hasOwnProperty.call(payload, key) ? payload[key] : undefined;
    return value !== undefined && value !== null ? String(value) : '';
  });
}
