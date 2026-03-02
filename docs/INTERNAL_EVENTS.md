# Sapar — Внутренние события (Outbox + HMAC + Commands)

---

## Содержание

1. [Обзор](#обзор)
2. [Transactional Outbox](#transactional-outbox)
3. [Event Envelope](#event-envelope)
4. [HMAC-подпись](#hmac-подпись)
5. [Replay Protection](#replay-protection)
6. [Каталог событий](#каталог-событий)
7. [Маршрутизация событий (OUTBOX_TARGETS)](#маршрутизация-событий-outbox_targets)
8. [Приём событий (POST /internal/events)](#приём-событий-post-internalevents)
9. [Admin Commands](#admin-commands)
10. [Outbox Workers](#outbox-workers)

---

## Обзор

Межсервисное взаимодействие в Sapar реализовано через два механизма:

1. **Transactional Outbox + HTTP POST** — для асинхронных доменных событий (booking.created, payment.captured и т.д.)
2. **Admin Commands + Polling** — для команд модерации (бан, отмена поездки)

Оба механизма обеспечивают at-least-once delivery с идемпотентной обработкой.

---

## Transactional Outbox

### Принцип

1. Бизнес-операция и запись события происходят **в одной транзакции** PostgreSQL
2. Background worker (`OutboxWorker`) опрашивает таблицу `outbox_events` и доставляет события по HTTP
3. При ошибке — retry с экспоненциальным backoff

### Таблица `outbox_events`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK, генерируется при publish |
| `eventType` | string | Тип события (например, `booking.created`) |
| `payloadJson` | JSON | Payload события |
| `occurredAt` | datetime | Время возникновения |
| `traceId` | string | X-Request-Id для сквозной трассировки |
| `status` | enum | `PENDING` → `SENT` / `FAILED_RETRY` → `FAILED_FINAL` |
| `tryCount` | integer | Текущая попытка |
| `nextRetryAt` | datetime | Время следующей попытки |
| `lastError` | string? | Последняя ошибка |
| `createdAt` | datetime | Время записи |
| `updatedAt` | datetime | Время обновления |

### Статусы

```
PENDING → SENT           (успешная доставка)
PENDING → FAILED_RETRY   (неудачная попытка, есть retry)
FAILED_RETRY → SENT      (успех при retry)
FAILED_RETRY → FAILED_FINAL  (все попытки исчерпаны)
```

### Publish API

```typescript
outboxService.publish(
  {
    eventType: 'booking.created',
    payload: { bookingId, tripId, passengerId, ... },
    traceId: requestId,
  },
  tx,  // Prisma TransactionClient — та же транзакция
);
```

---

## Event Envelope

Каждое событие, доставляемое по HTTP, имеет единый формат:

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "eventType": "booking.created",
  "payload": {
    "bookingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "tripId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "passengerId": "550e8400-e29b-41d4-a716-446655440000",
    "seats": 1,
    "amountKgs": 1500,
    "currency": "KGS",
    "departAt": "2026-03-15T08:00:00.000Z",
    "createdAt": "2026-03-15T08:01:00.000Z"
  },
  "occurredAt": "2026-03-15T08:01:00.000Z",
  "producer": "trips-service",
  "traceId": "c1d2e3f4-5678-90ab-cdef-1234567890ab",
  "version": 1
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `eventId` | UUID | Уникальный ID события (для дедупликации) |
| `eventType` | string | Тип события |
| `payload` | object | Данные события (зависит от типа) |
| `occurredAt` | string (ISO 8601) | Время возникновения |
| `producer` | string | Имя сервиса-отправителя |
| `traceId` | string | Сквозной trace ID |
| `version` | integer | Версия формата (всегда `1`) |

---

## HMAC-подпись

Каждый HTTP POST с событием подписывается HMAC-SHA256.

### Алгоритм подписи

```
signature = HMAC-SHA256(key=EVENTS_HMAC_SECRET, data="{timestamp}.{body}")
```

Где:
- `timestamp` — Unix epoch в секундах (целое число)
- `body` — raw JSON body запроса (строка)
- `EVENTS_HMAC_SECRET` — общий секрет (≥32 символа)

### HTTP заголовки

| Заголовок | Описание |
|-----------|----------|
| `x-event-signature` | Hex-encoded HMAC-SHA256 подпись |
| `x-event-timestamp` | Unix epoch seconds (string) |
| `content-type` | `application/json` |

### Реализация (shared/hmac.ts)

```typescript
function signEvent(body: string, timestamp: number, secret: string): string {
  const data = `${timestamp}.${body}`;
  return createHmac('sha256', secret).update(data).digest('hex');
}

function verifyEvent(
  body: string,
  timestamp: number,
  signature: string,
  secret: string,
  maxAgeSec = 300,
): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > maxAgeSec) return false;

  const expected = signEvent(body, timestamp, secret);
  // timing-safe comparison
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}
```

### Верификация на стороне получателя

1. Проверить `x-event-timestamp`: |now - timestamp| ≤ 300 сек (replay protection)
2. Вычислить ожидаемую подпись: `HMAC-SHA256(EVENTS_HMAC_SECRET, "{timestamp}.{body}")`
3. Сравнить с `x-event-signature` через `timingSafeEqual`
4. При несовпадении — HTTP 401

---

## Replay Protection

Двойная защита от повторной обработки:

### 1. Timestamp validation (HMAC)

- Максимальный возраст события: **300 секунд** (настраиваемо)
- Проверяется при верификации подписи
- Отклоняет старые replay-атаки

### 2. Таблица `consumed_events`

| Поле | Тип | Описание |
|------|-----|----------|
| `eventId` | string (PK) | ID события (UUID) |
| `eventType` | string | Тип события |
| `consumedAt` | datetime | Время обработки |
| `producer` | string | Сервис-отправитель |
| `traceId` | string | Trace ID |

**Алгоритм дедупликации:**

1. Проверка вне транзакции: `SELECT 1 FROM consumed_events WHERE eventId = ?`
2. Если найден → ответ `{ "status": "duplicate" }` (HTTP 200)
3. Начало транзакции
4. Повторная проверка внутри транзакции (double-check)
5. Вставка в `consumed_events`
6. Обработка события (handler)
7. Коммит транзакции

Двойная проверка предотвращает race condition при параллельной доставке одного и того же события.

---

## Каталог событий

### trips-service (отправляет)

| Событие | Payload | Получатели |
|---------|---------|------------|
| `booking.created` | `{ bookingId, tripId, passengerId, seats, amountKgs, currency, departAt, createdAt }` | payments-service |
| `booking.confirmed` | `{ bookingId, tripId, passengerId }` | payments-service |
| `booking.cancelled` | `{ bookingId, tripId, passengerId, seats, reason }` | payments-service, notifications-service |
| `booking.expired` | `{ bookingId, tripId, passengerId, seats, reason: "EXPIRED" }` | payments-service, notifications-service |
| `trip.cancelled` | `{ tripId, driverId }` или `{ tripId, adminCancelled: true, reason }` | payments-service |
| `trip.completed` | `{ tripId, driverId, departAt, completedAt, confirmedBookings: [...] }` | profiles-service |

**Причины отмены бронирования (`reason`):**
- `PAYMENT_FAILED` — платёж не прошёл
- `USER_CANCELLED` — отмена пассажиром/водителем
- `TRIP_CANCELLED` — поездка отменена
- `ADMIN_CANCELLED` — отмена администратором
- `EXPIRED` — истёк TTL

### payments-service (отправляет)

| Событие | Payload | Получатели |
|---------|---------|------------|
| `payment.intent.hold_placed` | `{ paymentIntentId, bookingId, amountKgs, currency }` | trips-service |
| `payment.intent.failed` | `{ paymentIntentId, bookingId, reason }` | trips-service |
| `payment.captured` | `{ paymentIntentId, bookingId, amountKgs }` | notifications-service |
| `payment.cancelled` | `{ paymentIntentId, bookingId }` | notifications-service |
| `payment.refunded` | `{ paymentIntentId, bookingId, amountKgs }` | notifications-service |

### admin-service (отправляет)

| Событие | Payload | Получатели |
|---------|---------|------------|
| `dispute.resolved` | `{ disputeId, bookingId, resolution, refundAmountKgs? }` | payments-service |

### notifications-service (отправляет)

| Событие | Payload | Получатели |
|---------|---------|------------|
| `notification.sent` | `{ notificationId, channel, templateKey }` | (нет получателей) |

---

## Маршрутизация событий (OUTBOX_TARGETS)

Маршруты настраиваются через переменную окружения `OUTBOX_TARGETS`. Формат:

```
eventType>url,eventType>url,...
```

Одно событие может иметь несколько получателей (указываются отдельными записями).

### trips-service

```
booking.created>http://payments-service:3003/internal/events
booking.confirmed>http://payments-service:3003/internal/events
booking.cancelled>http://payments-service:3003/internal/events
booking.cancelled>http://notifications-service:3004/internal/events
booking.expired>http://payments-service:3003/internal/events
booking.expired>http://notifications-service:3004/internal/events
trip.cancelled>http://payments-service:3003/internal/events
trip.completed>http://profiles-service:3006/internal/events
```

### payments-service

```
payment.intent.hold_placed>http://trips-service:3002/internal/events
payment.intent.failed>http://trips-service:3002/internal/events
payment.captured>http://notifications-service:3004/internal/events
payment.cancelled>http://notifications-service:3004/internal/events
payment.refunded>http://notifications-service:3004/internal/events
```

### admin-service

```
dispute.resolved>http://payments-service:3003/internal/events
```

### notifications-service

```
(пусто — нет внешних получателей)
```

---

## Приём событий (POST /internal/events)

Каждый сервис, принимающий события, имеет эндпоинт:

```
POST /internal/events
```

### Auth

HMAC-подпись (`x-event-signature`, `x-event-timestamp`).

### Request Body

Event Envelope (см. выше).

### Response

| Статус | Body | Описание |
|--------|------|----------|
| 200 | `{ "status": "processed" }` | Событие обработано |
| 200 | `{ "status": "ignored" }` | Нет handler для этого eventType |
| 200 | `{ "status": "duplicate" }` | Событие уже было обработано (idempotent) |
| 401 | Error | Невалидная HMAC-подпись |

### Handlers по сервисам

**trips-service:**

| eventType | Handler | Действие |
|-----------|---------|----------|
| `payment.intent.hold_placed` | OnPaymentHoldPlacedHandler | PENDING_PAYMENT → CONFIRMED |
| `payment.intent.failed` | OnPaymentIntentFailedHandler | PENDING_PAYMENT → CANCELLED, возврат мест |

**payments-service:**

| eventType | Handler | Действие |
|-----------|---------|----------|
| `booking.created` | — | Создание PaymentIntent, запрос hold |
| `booking.confirmed` | — | Capture |
| `booking.cancelled` | — | Cancel hold / refund |
| `booking.expired` | — | Cancel hold |
| `trip.cancelled` | — | Cancel/refund всех интентов |
| `dispute.resolved` | — | Refund (при REFUND/PARTIAL) |

**notifications-service:**

| eventType | Handler | Действие |
|-----------|---------|----------|
| `payment.captured` | — | BOOKING_CONFIRMED push |
| `booking.cancelled` | — | BOOKING_CANCELLED SMS |
| `booking.expired` | — | BOOKING_CANCELLED SMS |
| `payment.intent.hold_placed` | — | PAYMENT_HOLD_PLACED push |

**profiles-service:**

| eventType | Handler | Действие |
|-----------|---------|----------|
| `trip.completed` | — | Создание RatingEligibility для каждого пассажира |

---

## Admin Commands

Альтернативный механизм для команд модерации. В отличие от outbox-событий, доставка осуществляется через polling (pull).

### Таблица `admin_commands`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | UUID | PK |
| `targetService` | string | `identity`, `trips` |
| `type` | string | `BAN_USER`, `UNBAN_USER`, `CANCEL_TRIP` |
| `payload` | JSON | Данные команды |
| `status` | enum | `PENDING` → `ACKED` / `FAILED` |
| `tryCount` | integer | Попытки |
| `nextRetryAt` | datetime | Следующая попытка |
| `lastError` | string? | Последняя ошибка |
| `createdBy` | UUID | ID администратора |
| `createdAt` | datetime | Время создания |

### Polling API (admin-service, HMAC-защищённый)

#### GET `/internal/commands`

```
GET /internal/commands?service=identity&limit=10
```

| Параметр | Тип | Описание |
|----------|-----|----------|
| `service` | string | Целевой сервис |
| `limit` | integer | Макс. кол-во команд |

**Response:**

```json
{
  "commands": [
    {
      "id": "cmd-uuid",
      "type": "BAN_USER",
      "payload": {
        "userId": "user-uuid",
        "reason": "Нарушение правил",
        "until": "2026-06-15T00:00:00Z"
      },
      "createdAt": "2026-03-15T10:00:00.000Z"
    }
  ]
}
```

#### POST `/internal/commands/:id/ack`

```json
{
  "status": "success",
  "error": null
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `status` | string | `success` или `failed` |
| `error` | string? | Описание ошибки (при failed) |

### Типы команд

| Тип | Целевой сервис | Payload | Действие |
|-----|---------------|---------|----------|
| `BAN_USER` | identity | `{ userId, reason, until? }` | Бан пользователя (до even-даты или бессрочный) |
| `UNBAN_USER` | identity | `{ userId, reason }` | Разбан пользователя |
| `CANCEL_TRIP` | trips | `{ tripId, reason }` | Отмена поездки (без проверки владельца) + отмена всех бронирований |

### AdminCommandWorker (на стороне потребителя)

- Интервал опроса: `COMMAND_POLL_INTERVAL_MS` (по умолчанию 5000ms)
- Таймаут запроса: `COMMAND_POLL_TIMEOUT_MS` (по умолчанию 3000ms)
- При ошибке — exponential backoff
- Отключён в тестах (`NODE_ENV=test`)

---

## Outbox Workers

### Конфигурация

| Переменная | Default | Описание |
|------------|---------|----------|
| `OUTBOX_WORKER_INTERVAL_MS` | 1000 | Интервал опроса outbox |
| `OUTBOX_RETRY_N` | 5 | Макс. попыток доставки |
| `OUTBOX_BACKOFF_SEC_LIST` | 5,30,120,300,900 | Backoff расписание (через запятую) |
| `OUTBOX_DELIVERY_TIMEOUT_MS` | 3000 | Таймаут HTTP POST |

### Поведение

1. Worker опрашивает `outbox_events` WHERE `status IN (PENDING, FAILED_RETRY)` AND `nextRetryAt <= NOW()`
2. Использует `FOR UPDATE SKIP LOCKED` (безопасно для multi-instance)
3. Для каждого события:
   - Определяет URL из `OUTBOX_TARGETS` по `eventType`
   - Подписывает body HMAC-SHA256
   - Отправляет HTTP POST
   - При успехе: `status = SENT`
   - При ошибке: `tryCount++`, `status = FAILED_RETRY`, `nextRetryAt = now + backoff[tryCount]`
   - Если `tryCount >= OUTBOX_RETRY_N`: `status = FAILED_FINAL`
4. Circuit breaker per-host: при серии ошибок — пауза доставки на конкретный host
5. В тестах (`NODE_ENV=test`) worker отключён
