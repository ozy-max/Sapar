# Sapar — API Reference

> Base URL: `http://localhost:3000` (через api-gateway)
> Все эндпоинты доступны через gateway proxy (`/{service-prefix}/...`) или напрямую (`http://localhost:{port}/...`).

---

## Содержание

1. [Общие соглашения](#общие-соглашения)
2. [Identity Service](#identity-service-порт-3001-prefix-identity)
3. [Trips Service](#trips-service-порт-3002-prefix-trips)
4. [Payments Service](#payments-service-порт-3003-prefix-payments)
5. [Notifications Service](#notifications-service-порт-3004)
6. [Admin Service](#admin-service-порт-3005-prefix-admin)
7. [Profiles Service](#profiles-service-порт-3006-prefix-profiles)
8. [Каталог ошибок](#каталог-ошибок)

---

## Общие соглашения

### Формат ошибок

Все сервисы возвращают ошибки в едином формате:

```json
{
  "code": "ERROR_CODE",
  "message": "Описание ошибки",
  "details": {},
  "traceId": "x-request-id"
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `code` | string | Машиночитаемый код ошибки |
| `message` | string | Описание для разработчика |
| `details` | object? | Доп. данные (например, `fields` при валидации) |
| `traceId` | string | Значение заголовка `x-request-id` |

### Обязательные заголовки

| Заголовок | Когда | Описание |
|-----------|-------|----------|
| `Authorization: Bearer <token>` | Защищённые эндпоинты | JWT access token |
| `Content-Type: application/json` | POST/PUT/PATCH | Тип тела запроса |
| `X-Request-Id: <uuid>` | Опционально | Если не передан — генерируется сервером |
| `Idempotency-Key: <uuid>` | Бронирование, платежи | Предотвращение дублирования |

### Пагинация

BFF-эндпоинты возвращают:

```json
{
  "items": [...],
  "paging": { "limit": 20, "offset": 0, "total": 42 },
  "meta": { "requestId": "uuid", "timestamp": "ISO 8601" }
}
```

Query-параметры: `limit` (1–100, default зависит от эндпоинта), `offset` (≥0).

### Rate Limiting

При превышении лимита:
- HTTP `429 Too Many Requests`
- Код: `RATE_LIMITED`
- Заголовки: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`

---

## Identity Service (порт 3001, prefix: `/identity`)

### POST `/auth/register`

Регистрация нового пользователя.

- **Auth:** Public
- **Rate limit:** 60 RPM

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

| Поле | Тип | Обяз. | Ограничения |
|------|-----|:-----:|-------------|
| `email` | string | Да | Валидный email |
| `password` | string | Да | 8–128 символов |

**Response `201 Created`:**

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `VALIDATION_ERROR` | 400 | Невалидный email или пароль |
| `EMAIL_TAKEN` | 409 | Email уже зарегистрирован |

---

### POST `/auth/login`

Аутентификация. Возвращает пару access + refresh token.

- **Auth:** Public
- **Rate limit:** 60 RPM

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

| Поле | Тип | Обяз. | Ограничения |
|------|-----|:-----:|-------------|
| `email` | string | Да | Валидный email |
| `password` | string | Да | 1–128 символов |

**Response `200 OK`:**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "a1b2c3d4e5f6...",
  "expiresInSec": 900
}
```

| Поле | Описание |
|------|----------|
| `accessToken` | JWT (HS256). Payload: `{ sub, email, roles, iat, exp }` |
| `refreshToken` | Непрозрачный токен (32 байта, base64url) |
| `expiresInSec` | Время жизни access token в секундах |

**JWT Access Token Claims:**

```json
{
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "roles": ["PASSENGER"],
  "iat": 1709337600,
  "exp": 1709338500
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `VALIDATION_ERROR` | 400 | Невалидные данные |
| `INVALID_CREDENTIALS` | 401 | Неверный email или пароль |
| `ACCOUNT_BANNED` | 403 | Аккаунт заблокирован |

---

### POST `/auth/refresh`

Обновление access token по refresh token. Старый refresh token отзывается (rotation).

- **Auth:** Public

**Request Body:**

```json
{
  "refreshToken": "a1b2c3d4e5f6..."
}
```

**Response `200 OK`:**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "x7y8z9...",
  "expiresInSec": 900
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `INVALID_REFRESH_TOKEN` | 401 | Токен невалиден, истёк или отозван |
| `ACCOUNT_BANNED` | 403 | Аккаунт заблокирован |

**Важно:** При повторном использовании отозванного refresh token — все refresh tokens пользователя отзываются (обнаружение компрометации).

---

### POST `/auth/logout`

Отзыв refresh token.

- **Auth:** Public

**Request Body:**

```json
{
  "refreshToken": "a1b2c3d4e5f6..."
}
```

**Response `204 No Content`** (пустое тело)

---

### POST `/admin/users/:userId/roles`

Назначение ролей пользователю.

- **Auth:** Bearer JWT, роль `ADMIN`

**Path Parameters:**

| Параметр | Тип | Описание |
|----------|-----|----------|
| `userId` | UUID | ID пользователя |

**Request Body:**

```json
{
  "roles": ["DRIVER", "PASSENGER"]
}
```

| Поле | Тип | Ограничения |
|------|-----|-------------|
| `roles` | string[] | Допустимые: `ADMIN`, `OPS`, `SUPPORT`, `DRIVER`, `PASSENGER` |

**Response `200 OK`:**

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "roles": ["DRIVER", "PASSENGER"]
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `UNAUTHORIZED` | 401 | Нет Bearer token |
| `FORBIDDEN` | 403 | Роль не ADMIN |
| `USER_NOT_FOUND` | 404 | Пользователь не найден |

---

## Trips Service (порт 3002, prefix: `/trips`)

### POST `/`

Создание поездки (водитель).

- **Auth:** Bearer JWT
- **Rate limit:** 120 RPM

**Request Body:**

```json
{
  "fromCity": "Бишкек",
  "toCity": "Ош",
  "departAt": "2026-03-15T08:00:00Z",
  "seatsTotal": 3,
  "priceKgs": 1500
}
```

| Поле | Тип | Обяз. | Ограничения |
|------|-----|:-----:|-------------|
| `fromCity` | string | Да | 1–200 символов |
| `toCity` | string | Да | 1–200 символов |
| `departAt` | string | Да | ISO 8601 datetime |
| `seatsTotal` | integer | Да | 1–50 |
| `priceKgs` | integer | Да | ≥1 (в сомах) |

**Response `201 Created`:**

```json
{
  "tripId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "driverId": "550e8400-e29b-41d4-a716-446655440000",
  "fromCity": "Бишкек",
  "toCity": "Ош",
  "departAt": "2026-03-15T08:00:00.000Z",
  "seatsTotal": 3,
  "seatsAvailable": 3,
  "priceKgs": 1500,
  "status": "ACTIVE"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `VALIDATION_ERROR` | 400 | Невалидные данные |
| `UNAUTHORIZED` | 401 | Нет Bearer token |

---

### GET `/search`

Поиск активных поездок. Поддерживает геопоиск, фильтры по дате, цене, местам.

- **Auth:** Public
- **Rate limit:** 120 RPM
- **Кэширование:** Redis (TTL 15 сек), при наличии location-фильтра

**Query Parameters:**

| Параметр | Тип | Default | Описание |
|----------|-----|---------|----------|
| `fromCity` | string | — | Город отправления (текст) |
| `toCity` | string | — | Город назначения (текст) |
| `fromCityId` | UUID | — | ID города отправления |
| `toCityId` | UUID | — | ID города назначения |
| `fromLat` | number | — | Широта отправления (-90..90) |
| `fromLon` | number | — | Долгота отправления (-180..180) |
| `toLat` | number | — | Широта назначения |
| `toLon` | number | — | Долгота назначения |
| `radiusKm` | number | 25 | Радиус поиска (1–500 км) |
| `bboxMinLat` | number | — | Bounding box: min широта |
| `bboxMinLon` | number | — | Bounding box: min долгота |
| `bboxMaxLat` | number | — | Bounding box: max широта |
| `bboxMaxLon` | number | — | Bounding box: max долгота |
| `dateFrom` | string | — | Дата от (YYYY-MM-DD) |
| `dateTo` | string | — | Дата до (YYYY-MM-DD) |
| `minSeats` | integer | 1 | Минимум свободных мест (1–50) |
| `priceMin` | integer | — | Мин. цена (KGS) |
| `priceMax` | integer | — | Макс. цена (KGS) |
| `limit` | integer | 50 | Кол-во результатов (1–100) |
| `offset` | integer | 0 | Смещение (≥0) |

**Обязательно хотя бы одно:** `fromCity`, `fromCityId`, `fromLat` или `bboxMinLat`.

**Response `200 OK`:**

```json
{
  "items": [
    {
      "tripId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "driverId": "550e8400-e29b-41d4-a716-446655440000",
      "fromCity": "Бишкек",
      "toCity": "Ош",
      "departAt": "2026-03-15T08:00:00.000Z",
      "seatsAvailable": 2,
      "priceKgs": 1500,
      "status": "ACTIVE"
    }
  ],
  "count": 1
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `VALIDATION_ERROR` | 400 | Не указан ни один location-фильтр или невалидные параметры |

---

### POST `/:tripId/book`

Бронирование места в поездке (пассажир). Создаёт booking в статусе `PENDING_PAYMENT` и запускает booking saga.

- **Auth:** Bearer JWT
- **Rate limit:** 120 RPM
- **Idempotency:** Поддержка `Idempotency-Key` заголовка

**Path Parameters:**

| Параметр | Тип | Описание |
|----------|-----|----------|
| `tripId` | UUID | ID поездки |

**Headers (опционально):**

| Заголовок | Описание |
|-----------|----------|
| `Idempotency-Key` | UUID для идемпотентности |
| `X-Request-Id` | Trace ID |

**Request Body:**

```json
{
  "seats": 1
}
```

| Поле | Тип | Обяз. | Default | Ограничения |
|------|-----|:-----:|---------|-------------|
| `seats` | integer | Нет | 1 | 1–50 |

**Response `201 Created`:**

```json
{
  "bookingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "tripId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "PENDING_PAYMENT"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `VALIDATION_ERROR` | 400 | Невалидные данные |
| `UNAUTHORIZED` | 401 | Нет Bearer token |
| `TRIP_NOT_FOUND` | 404 | Поездка не найдена |
| `TRIP_NOT_ACTIVE` | 409 | Поездка не в статусе ACTIVE |
| `NOT_ENOUGH_SEATS` | 409 | Недостаточно свободных мест |
| `BOOKING_EXISTS` | 409 | Уже есть активное бронирование на эту поездку |

**Бизнес-логика:**
- Уменьшает `seatsAvailable` в поездке
- Публикует событие `booking.created` в outbox
- Payments создаёт PaymentIntent и ставит hold
- TTL бронирования: 15 мин (настраивается `BOOKING_TTL_SEC`)

---

### POST `/:tripId/cancel`

Отмена поездки (только водитель или admin).

- **Auth:** Bearer JWT (водитель — владелец поездки)

**Response `200 OK`:**

```json
{
  "tripId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "CANCELLED"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `UNAUTHORIZED` | 401 | Нет Bearer token |
| `FORBIDDEN` | 403 | Не владелец поездки |
| `TRIP_NOT_FOUND` | 404 | Поездка не найдена |
| `TRIP_NOT_ACTIVE` | 409 | Поездка уже не ACTIVE |

**Бизнес-логика:**
- Все `PENDING_PAYMENT` и `CONFIRMED` бронирования → `CANCELLED`
- Публикуется `trip.cancelled` + `booking.cancelled` для каждого бронирования
- Payments отменяет hold / делает refund

---

### POST `/:tripId/complete`

Завершение поездки (только водитель).

- **Auth:** Bearer JWT (водитель — владелец поездки)

**Response `200 OK`:**

```json
{
  "tripId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "COMPLETED",
  "completedAt": "2026-03-15T16:30:00.000Z"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `UNAUTHORIZED` | 401 | Нет Bearer token |
| `FORBIDDEN` | 403 | Не владелец поездки |
| `TRIP_NOT_FOUND` | 404 | Поездка не найдена |
| `TRIP_NOT_ACTIVE` | 409 | Поездка уже не ACTIVE |

**Бизнес-логика:**
- Публикуется `trip.completed` со списком `confirmedBookings`
- Profiles создаёт `RatingEligibility` для каждого пассажира

---

### POST `/bookings/:bookingId/cancel`

Отмена бронирования (пассажир или водитель).

- **Auth:** Bearer JWT

**Response `200 OK`:**

```json
{
  "bookingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "CANCELLED"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `UNAUTHORIZED` | 401 | Нет Bearer token |
| `FORBIDDEN` | 403 | Не участник бронирования |
| `BOOKING_NOT_FOUND` | 404 | Бронирование не найдено |
| `BOOKING_NOT_ACTIVE` | 409 | Бронирование нельзя отменить (уже CANCELLED/EXPIRED) |

**Бизнес-логика:**
- Возвращает места в поездку
- Публикуется `booking.cancelled` (reason: `USER_CANCELLED`)
- Payments отменяет hold / делает refund

---

## Payments Service (порт 3003, prefix: `/payments`)

### POST `/payments/intents`

Создание payment intent (hold средств).

- **Auth:** Bearer JWT
- **Rate limit:** 30 RPM

**Request Body:**

```json
{
  "bookingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "amountKgs": 1500
}
```

| Поле | Тип | Обяз. | Ограничения |
|------|-----|:-----:|-------------|
| `bookingId` | UUID | Да | Существующее бронирование |
| `amountKgs` | integer | Да | >0 |

**Response `201 Created`:**

```json
{
  "id": "3b3a2c2e-3d0f-4c1a-9d2b-1a0c4b8d2e1f",
  "bookingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "amountKgs": 1500,
  "currency": "KGS",
  "status": "CREATED",
  "createdAt": "2026-03-15T08:01:00.000Z"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `VALIDATION_ERROR` | 400 | Невалидные данные |
| `UNAUTHORIZED` | 401 | Нет Bearer token |
| `IDMP_CONFLICT` | 409 | Конфликт идемпотентности |

---

### POST `/payments/intents/:id/capture`

Захват средств после hold.

- **Auth:** Bearer JWT

**Path Parameters:**

| Параметр | Тип | Описание |
|----------|-----|----------|
| `id` | UUID | ID payment intent |

**Response `200 OK`:**

```json
{
  "id": "3b3a2c2e-3d0f-4c1a-9d2b-1a0c4b8d2e1f",
  "status": "CAPTURED"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `PAYMENT_INTENT_NOT_FOUND` | 404 | Intent не найден |
| `INVALID_PAYMENT_STATE` | 409 | Текущее состояние не позволяет capture |
| `PSP_UNAVAILABLE` | 502 | PSP недоступен |

---

### POST `/payments/intents/:id/cancel`

Отмена hold.

- **Auth:** Bearer JWT

**Response `200 OK`:**

```json
{
  "id": "3b3a2c2e-3d0f-4c1a-9d2b-1a0c4b8d2e1f",
  "status": "CANCELLED"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `PAYMENT_INTENT_NOT_FOUND` | 404 | Intent не найден |
| `INVALID_PAYMENT_STATE` | 409 | Не в состоянии для отмены |
| `PSP_UNAVAILABLE` | 502 | PSP недоступен |

---

### POST `/payments/intents/:id/refund`

Возврат средств после capture.

- **Auth:** Bearer JWT

**Response `200 OK`:**

```json
{
  "id": "3b3a2c2e-3d0f-4c1a-9d2b-1a0c4b8d2e1f",
  "status": "REFUNDED"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `PAYMENT_INTENT_NOT_FOUND` | 404 | Intent не найден |
| `INVALID_PAYMENT_STATE` | 409 | Не в состоянии CAPTURED |
| `PSP_UNAVAILABLE` | 502 | PSP недоступен |

---

### POST `/payments/webhooks/psp`

Webhook от PSP (провайдера платежей).

- **Auth:** HMAC-SHA256 (`x-webhook-signature`, `x-webhook-timestamp`, секрет: `PAYMENTS_WEBHOOK_SECRET`)

**Request Body:**

```json
{
  "eventId": "psp-event-001",
  "type": "hold.succeeded",
  "pspIntentId": "psp_intent_abc123",
  "data": {}
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `eventId` | string | Уникальный ID события от PSP |
| `type` | string | Тип: `hold.succeeded`, `capture.succeeded`, `hold.failed`, `capture.failed`, `refund.succeeded` |
| `pspIntentId` | string | ID интента в PSP |
| `data` | object? | Доп. данные |

**Response `200 OK`:**

```json
{ "status": "processed" }
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `VALIDATION_ERROR` | 400 | Невалидные данные |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | Неверная подпись |

---

## Notifications Service (порт 3004)

### POST `/notifications`

Создание уведомления (ставится в очередь).

- **Auth:** Bearer JWT

**Request Body:**

```json
{
  "channel": "PUSH",
  "templateKey": "BOOKING_CONFIRMED",
  "payload": {
    "bookingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "route": "Бишкек → Ош",
    "date": "15.03.2026"
  }
}
```

| Поле | Тип | Обяз. | Ограничения |
|------|-----|:-----:|-------------|
| `channel` | enum | Да | `SMS`, `EMAIL`, `PUSH` |
| `templateKey` | string | Да | Ключ шаблона |
| `payload` | object | Нет | Переменные шаблона |

**Доступные шаблоны:**

| Ключ | Каналы | Описание |
|------|--------|----------|
| `BOOKING_CONFIRMED` | PUSH, EMAIL | Бронирование подтверждено |
| `PAYMENT_CAPTURED` | EMAIL | Платёж захвачен |
| `BOOKING_CANCELLED` | SMS | Бронирование отменено |
| `PAYMENT_HOLD_PLACED` | PUSH, EMAIL | Hold размещён |

**Response `201 Created`:**

```json
{
  "id": "notif-uuid",
  "status": "PENDING"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `VALIDATION_ERROR` | 400 | Невалидные данные |
| `TEMPLATE_NOT_FOUND` | 400 | Шаблон не найден |
| `UNAUTHORIZED` | 401 | Нет Bearer token |
| `IDMP_CONFLICT` | 409 | Конфликт идемпотентности |

---

### GET `/notifications/:id`

Статус уведомления.

- **Auth:** Bearer JWT

**Response `200 OK`:**

```json
{
  "id": "notif-uuid",
  "channel": "PUSH",
  "templateKey": "BOOKING_CONFIRMED",
  "status": "SENT",
  "createdAt": "2026-03-15T08:02:00.000Z"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `NOTIFICATION_NOT_FOUND` | 404 | Уведомление не найдено |

---

### POST `/notifications/:id/cancel`

Отмена pending-уведомления.

- **Auth:** Bearer JWT

**Response `200 OK`:**

```json
{
  "id": "notif-uuid",
  "status": "CANCELLED"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `NOTIFICATION_NOT_FOUND` | 404 | Уведомление не найдено |
| `INVALID_STATE` | 409 | Нельзя отменить (не PENDING) |

---

## Admin Service (порт 3005, prefix: `/admin`)

### GET `/configs`

Список всех конфигов.

- **Auth:** Bearer JWT, роли: `ADMIN`, `OPS`, `SUPPORT`

**Response `200 OK`:**

```json
[
  {
    "key": "booking_ttl_sec",
    "type": "INT",
    "value": 900,
    "description": "TTL бронирования в секундах",
    "scope": "trips",
    "version": 3,
    "updatedAt": "2026-03-01T10:00:00.000Z"
  }
]
```

---

### GET `/configs/:key`

Конкретный конфиг по ключу.

- **Auth:** Bearer JWT, роли: `ADMIN`, `OPS`, `SUPPORT`

**Response `200 OK`:**

```json
{
  "key": "booking_ttl_sec",
  "type": "INT",
  "value": 900,
  "description": "TTL бронирования в секундах",
  "scope": "trips",
  "version": 3
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `CONFIG_NOT_FOUND` | 404 | Конфиг не найден |

---

### PUT `/configs/:key`

Создание или обновление конфига.

- **Auth:** Bearer JWT, роли: `ADMIN`, `OPS`

**Request Body:**

```json
{
  "type": "INT",
  "value": 900,
  "description": "TTL бронирования в секундах",
  "scope": "trips",
  "constraints": { "min": 60, "max": 3600 }
}
```

| Поле | Тип | Обяз. | Описание |
|------|-----|:-----:|----------|
| `type` | enum | Да | `INT`, `FLOAT`, `BOOL`, `STRING`, `JSON` |
| `value` | any | Да | Значение конфига |
| `description` | string | Нет | Описание |
| `scope` | string | Нет | Область применения |
| `constraints` | object | Нет | Ограничения: `min`, `max` |

**Response `200 OK`:**

```json
{
  "key": "booking_ttl_sec",
  "type": "INT",
  "value": 900,
  "version": 4
}
```

---

### DELETE `/configs/:key`

Удаление конфига.

- **Auth:** Bearer JWT, роль: `ADMIN`

**Response `204 No Content`**

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `CONFIG_NOT_FOUND` | 404 | Конфиг не найден |
| `FORBIDDEN` | 403 | Роль не ADMIN |

---

### POST `/disputes`

Создание спора.

- **Auth:** Bearer JWT, роли: `ADMIN`, `SUPPORT`

**Request Body:**

```json
{
  "type": "NO_SHOW",
  "bookingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "departAt": "2026-03-15T08:00:00Z",
  "evidenceUrls": ["https://example.com/evidence1.jpg"]
}
```

| Поле | Тип | Обяз. | Описание |
|------|-----|:-----:|----------|
| `type` | enum | Да | `NO_SHOW`, `OTHER` |
| `bookingId` | UUID | Да | ID бронирования |
| `departAt` | string | Да | Дата отправления (для SLA) |
| `evidenceUrls` | string[] | Нет | URL-ы доказательств |

**Response `201 Created`:**

```json
{
  "id": "dispute-uuid",
  "type": "NO_SHOW",
  "bookingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "OPEN",
  "createdAt": "2026-03-15T10:00:00.000Z"
}
```

---

### GET `/disputes/:id`

Детали спора.

- **Auth:** Bearer JWT, роли: `ADMIN`, `SUPPORT`

**Response `200 OK`:**

```json
{
  "id": "dispute-uuid",
  "type": "NO_SHOW",
  "bookingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "OPEN",
  "resolution": null,
  "createdAt": "2026-03-15T10:00:00.000Z"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `DISPUTE_NOT_FOUND` | 404 | Спор не найден |

---

### POST `/disputes/:id/resolve`

Разрешение спора.

- **Auth:** Bearer JWT, роли: `ADMIN`, `SUPPORT`

**Request Body:**

```json
{
  "resolution": "REFUND",
  "refundAmountKgs": 1500
}
```

| Поле | Тип | Обяз. | Описание |
|------|-----|:-----:|----------|
| `resolution` | enum | Да | `REFUND`, `NO_REFUND`, `PARTIAL`, `BAN_USER` |
| `refundAmountKgs` | integer | Для PARTIAL | Сумма частичного возврата |

**Response `200 OK`:**

```json
{
  "id": "dispute-uuid",
  "status": "RESOLVED",
  "resolution": "REFUND",
  "resolvedAt": "2026-03-15T12:00:00.000Z"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `DISPUTE_NOT_FOUND` | 404 | Спор не найден |
| `INVALID_STATE` | 409 | Спор не в статусе OPEN |
| `SLA_WINDOW_EXPIRED` | 409 | SLA-окно истекло |

**Бизнес-логика:**
- При `REFUND` / `PARTIAL` / `NO_REFUND` — публикуется `dispute.resolved` → Payments делает refund
- SLA: `SLA_RESOLVE_HOURS` (по умолчанию 12 часов от `departAt`)

---

### POST `/disputes/:id/close`

Закрытие спора.

- **Auth:** Bearer JWT, роли: `ADMIN`, `SUPPORT`

**Response `200 OK`:**

```json
{
  "id": "dispute-uuid",
  "status": "CLOSED"
}
```

---

### POST `/moderation/users/:userId/ban`

Бан пользователя.

- **Auth:** Bearer JWT, роли: `ADMIN`, `OPS`

**Request Body:**

```json
{
  "reason": "Нарушение правил платформы",
  "until": "2026-06-15T00:00:00Z"
}
```

| Поле | Тип | Обяз. | Описание |
|------|-----|:-----:|----------|
| `reason` | string | Да | Причина бана |
| `until` | string | Нет | Дата разблокировки (ISO 8601). Без неё — бессрочный |

**Response `201 Created`:**

```json
{
  "commandId": "cmd-uuid",
  "targetService": "identity",
  "type": "BAN_USER",
  "status": "PENDING"
}
```

---

### POST `/moderation/users/:userId/unban`

Разбан пользователя.

- **Auth:** Bearer JWT, роли: `ADMIN`, `OPS`

**Request Body:**

```json
{
  "reason": "Решение администрации"
}
```

**Response `201 Created`:**

```json
{
  "commandId": "cmd-uuid",
  "targetService": "identity",
  "type": "UNBAN_USER",
  "status": "PENDING"
}
```

---

### POST `/moderation/trips/:tripId/cancel`

Отмена поездки модератором.

- **Auth:** Bearer JWT, роли: `ADMIN`, `OPS`

**Request Body:**

```json
{
  "reason": "Поездка нарушает правила"
}
```

**Response `201 Created`:**

```json
{
  "commandId": "cmd-uuid",
  "targetService": "trips",
  "type": "CANCEL_TRIP",
  "status": "PENDING"
}
```

---

## Profiles Service (порт 3006, prefix: `/profiles`)

### GET `/profiles/:userId`

Публичный профиль пользователя с рейтингом.

- **Auth:** Public

**Response `200 OK`:**

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "displayName": "Алексей",
  "avatarUrl": "https://example.com/avatar.jpg",
  "bio": "Опытный водитель, 10 лет стажа",
  "city": "Бишкек",
  "ratingAvg": 4.7,
  "ratingCount": 23
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `PROFILE_NOT_FOUND` | 404 | Профиль не найден |

---

### GET `/profiles/:userId/ratings`

Список рейтингов пользователя.

- **Auth:** Public

**Query Parameters:**

| Параметр | Тип | Default | Описание |
|----------|-----|---------|----------|
| `limit` | integer | 20 | Кол-во (1–100) |
| `offset` | integer | 0 | Смещение |

**Response `200 OK`:**

```json
{
  "items": [
    {
      "id": "rating-uuid",
      "tripId": "trip-uuid",
      "raterUserId": "rater-uuid",
      "role": "PASSENGER_RATES_DRIVER",
      "score": 5,
      "comment": "Отличная поездка!",
      "createdAt": "2026-03-16T10:00:00.000Z"
    }
  ],
  "total": 23
}
```

---

### PUT `/me/profile`

Обновление своего профиля.

- **Auth:** Bearer JWT

**Request Body:**

```json
{
  "displayName": "Алексей",
  "avatarUrl": "https://example.com/avatar.jpg",
  "bio": "Водитель из Бишкека",
  "city": "Бишкек"
}
```

| Поле | Тип | Обяз. | Ограничения |
|------|-----|:-----:|-------------|
| `displayName` | string | Да | 1–100 символов |
| `avatarUrl` | string | Нет | URL |
| `bio` | string | Нет | Макс. 500 символов |
| `city` | string | Нет | Макс. 100 символов |

**Response `200 OK`:**

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "displayName": "Алексей",
  "avatarUrl": "https://example.com/avatar.jpg",
  "bio": "Водитель из Бишкека",
  "city": "Бишкек"
}
```

---

### POST `/ratings`

Создание рейтинга за поездку.

- **Auth:** Bearer JWT

**Request Body:**

```json
{
  "bookingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "score": 5,
  "comment": "Отличная поездка, рекомендую!"
}
```

| Поле | Тип | Обяз. | Ограничения |
|------|-----|:-----:|-------------|
| `bookingId` | UUID | Да | Существующее бронирование |
| `score` | integer | Да | 1–5 |
| `comment` | string | Нет | Макс. 500 символов |

**Response `201 Created`:**

```json
{
  "id": "rating-uuid",
  "tripId": "trip-uuid",
  "bookingId": "booking-uuid",
  "raterUserId": "rater-uuid",
  "ratedUserId": "rated-uuid",
  "role": "PASSENGER_RATES_DRIVER",
  "score": 5,
  "comment": "Отличная поездка, рекомендую!",
  "createdAt": "2026-03-16T10:00:00.000Z"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `VALIDATION_ERROR` | 400 | Невалидные данные |
| `UNAUTHORIZED` | 401 | Нет Bearer token |
| `NOT_ELIGIBLE` | 403 | Нет права ставить рейтинг (нет eligibility) |
| `RATING_WINDOW_EXPIRED` | 409 | Окно рейтинга истекло (>14 дней после поездки) |
| `DUPLICATE_RATING` | 409 | Рейтинг уже существует |

**Бизнес-логика:**
- Требует `RatingEligibility` (создаётся автоматически при `trip.completed`)
- Роли: `DRIVER_RATES_PASSENGER` или `PASSENGER_RATES_DRIVER` (определяется автоматически)
- Уникальность: один рейтинг per (trip, rater, role)
- Обновляет `RatingAggregate` (avg, count)

---

### DELETE `/admin/ratings/:id`

Мягкое удаление рейтинга (модерация).

- **Auth:** Bearer JWT, роль: `ADMIN`

**Response `200 OK`:**

```json
{
  "id": "rating-uuid",
  "status": "DELETED"
}
```

**Ошибки:**

| Код | HTTP | Описание |
|-----|------|----------|
| `RATING_NOT_FOUND` | 404 | Рейтинг не найден |
| `FORBIDDEN` | 403 | Роль не ADMIN |

---

## Health & Metrics (все сервисы)

### GET `/health`

Liveness probe. Всегда `200` если сервис запущен.

**Response `200 OK`:**

```json
{ "status": "ok" }
```

### GET `/ready`

Readiness probe. Проверяет соединение с БД (и Redis, если есть).

**Response `200 OK`:**

```json
{ "status": "ok" }
```

**Response `503 Service Unavailable`:**

```json
{
  "code": "SERVICE_UNAVAILABLE",
  "message": "Database is not reachable"
}
```

### GET `/metrics`

Prometheus-метрики в формате text/plain.

---

## Каталог ошибок

### Общие (все сервисы)

| Код | HTTP | Описание |
|-----|:----:|----------|
| `VALIDATION_ERROR` | 400 | Невалидные данные. `details.fields` содержит ошибки по полям |
| `UNAUTHORIZED` | 401 | Нет или невалидный Bearer token |
| `FORBIDDEN` | 403 | Недостаточно прав (нет нужной роли) |
| `NOT_FOUND` | 404 | Ресурс не найден |
| `INTERNAL_ERROR` | 500 | Необработанная серверная ошибка |
| `SERVICE_UNAVAILABLE` | 503 | Зависимость (БД/Redis) недоступна |

### Gateway

| Код | HTTP | Описание |
|-----|:----:|----------|
| `DOWNSTREAM_UNAVAILABLE` | 502 | Downstream-сервис недоступен |
| `DOWNSTREAM_TIMEOUT` | 504 | Таймаут ответа downstream |
| `DOWNSTREAM_CIRCUIT_OPEN` | 503 | Circuit breaker открыт |
| `BAD_GATEWAY` | 502 | Ошибка ответа downstream |
| `PAYLOAD_TOO_LARGE` | 413 | Body превышает `MAX_BODY_BYTES` |
| `RATE_LIMITED` | 429 | Превышен лимит запросов |
| `RATE_LIMITER_UNAVAILABLE` | 503 | Redis недоступен (closed strategy) |

### Identity

| Код | HTTP | Описание |
|-----|:----:|----------|
| `EMAIL_TAKEN` | 409 | Email уже зарегистрирован |
| `INVALID_CREDENTIALS` | 401 | Неверный email или пароль |
| `ACCOUNT_BANNED` | 403 | Аккаунт заблокирован |
| `INVALID_REFRESH_TOKEN` | 401 | Refresh token невалиден или отозван |
| `USER_NOT_FOUND` | 404 | Пользователь не найден |

### Trips

| Код | HTTP | Описание |
|-----|:----:|----------|
| `TRIP_NOT_FOUND` | 404 | Поездка не найдена |
| `BOOKING_NOT_FOUND` | 404 | Бронирование не найдено |
| `TRIP_NOT_ACTIVE` | 409 | Поездка не в статусе ACTIVE |
| `NOT_ENOUGH_SEATS` | 409 | Недостаточно свободных мест |
| `BOOKING_EXISTS` | 409 | Уже есть активное бронирование |
| `BOOKING_NOT_ACTIVE` | 409 | Бронирование нельзя отменить |
| `INVALID_BOOKING_TRANSITION` | 409 | Недопустимый переход статуса |

### Payments

| Код | HTTP | Описание |
|-----|:----:|----------|
| `PAYMENT_INTENT_NOT_FOUND` | 404 | Intent не найден |
| `INVALID_PAYMENT_STATE` | 409 | Недопустимое состояние intent |
| `IDMP_CONFLICT` | 409 | Конфликт идемпотентности |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | Неверная подпись webhook |
| `FORBIDDEN_PAYMENT` | 403 | Нет прав на этот intent |
| `PSP_UNAVAILABLE` | 502 | PSP недоступен |
| `DATA_CORRUPTION` | 500 | Ошибка целостности данных |

### Notifications

| Код | HTTP | Описание |
|-----|:----:|----------|
| `TEMPLATE_NOT_FOUND` | 400 | Шаблон не найден |
| `NOTIFICATION_NOT_FOUND` | 404 | Уведомление не найдено |
| `INVALID_STATE` | 409 | Недопустимое состояние |
| `PROVIDER_UNAVAILABLE` | 502 | Провайдер уведомлений недоступен |

### Admin

| Код | HTTP | Описание |
|-----|:----:|----------|
| `CONFIG_NOT_FOUND` | 404 | Конфиг не найден |
| `DISPUTE_NOT_FOUND` | 404 | Спор не найден |
| `INVALID_STATE` | 409 | Недопустимое состояние спора |
| `SLA_WINDOW_EXPIRED` | 409 | SLA-окно разрешения истекло |

### Profiles

| Код | HTTP | Описание |
|-----|:----:|----------|
| `PROFILE_NOT_FOUND` | 404 | Профиль не найден |
| `RATING_NOT_FOUND` | 404 | Рейтинг не найден |
| `NOT_ELIGIBLE` | 403 | Нет права ставить рейтинг |
| `RATING_WINDOW_EXPIRED` | 409 | Окно рейтинга истекло |
| `DUPLICATE_RATING` | 409 | Рейтинг уже существует |
