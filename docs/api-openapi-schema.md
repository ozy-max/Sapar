# OpenAPI 3.0 Schema — Carpooling Platform API (BlaBlaCar-like, KG v1)

> MVP Кыргызстан (KGS, RU/KG). Гибридная модель: `CARPOOL = OFFLINE`, `COMMERCIAL = IN_APP` only.

---

## Общая информация

| Поле | Значение |
|------|----------|
| Title | Carpooling Platform API (BlaBlaCar-like) — KG v1 |
| Version | 1.0.0 |
| Base URL | `https://api.example.com` |
| Auth | Bearer JWT |

---

## Теги

| Тег | Описание |
|-----|----------|
| `Auth` | Аутентификация через OTP |
| `Rides` | Поиск и управление поездками |
| `Bookings` | Бронирование мест |
| `Payments` | Платёжные интенты |
| `Receipts` | Фискальные чеки |
| `Offline` | Офлайн-результат поездки (CARPOOL) |
| `Driver` | Профиль и документы водителя |
| `KYC` | Верификация личности |
| `Payouts` | Выплаты водителю |
| `Support` | Тикеты поддержки |

---

## Idempotency

Обязательный заголовок `Idempotency-Key` для:
- `POST /v1/payments/intents/{intentId}/confirm`
- `POST /v1/refunds`
- `POST /v1/bookings/{bookingId}/cancel` (при денежных последствиях)

---

## Endpoints

### Auth

#### `POST /v1/auth/otp/send`
Отправить OTP (без авторизации).

**Request:**
```json
{ "channel": "SMS", "contact": "+996555000111" }
```

**Responses:**
- `200` — OTP отправлен (`cooldown_seconds`)
- `429` — Rate Limited

---

#### `POST /v1/auth/otp/verify`
Верифицировать OTP и получить токены.

**Request:**
```json
{ "contact": "+996555000111", "code": "123456" }
```

**Responses:**
- `200` — `AuthTokens` (access_token, refresh_token, expires_in)
- `400` — Validation Error
- `429` — Rate Limited

---

### Rides

#### `GET /v1/rides/search`
Поиск поездок.

**Query параметры:**

| Параметр | Тип | Обязательный | Описание |
|----------|-----|:---:|----------|
| `from` | string | ✅ | Place ID / encoded point |
| `to` | string | ✅ | Place ID / encoded point |
| `date` | date | ✅ | Дата поездки |
| `seats` | integer (1–8) | ✅ | Количество мест |
| `ride_type` | `CARPOOL\|COMMERCIAL` | — | Тип поездки |
| `booking_mode` | `INSTANT\|REQUEST` | — | Режим бронирования |
| `cursor` | string | — | Cursor для пагинации |

**Responses:**
- `200` — `RideSearchResponse` (items[], next_cursor)
- `400` — Validation Error

---

#### `GET /v1/rides/{rideId}`
Получить детали поездки.

**Responses:**
- `200` — `RideDetailsResponse`
- `404` — Not Found

---

#### `POST /v1/rides`
Создать (и опционально опубликовать) поездку.

**Примеры запросов:**

*CARPOOL (офлайн-оплата):*
```json
{
  "ride_type": "CARPOOL",
  "from_point": { "place_id": "2gis:from", "title": "Bishkek" },
  "to_point": { "place_id": "2gis:to", "title": "Kara-Balta" },
  "depart_at": "2026-02-23T12:00:00+06:00",
  "seats_total": 3,
  "price_kgs": 500,
  "booking_mode": "REQUEST",
  "payment_mode": "OFFLINE",
  "publish": true
}
```

*COMMERCIAL (in-app оплата):*
```json
{
  "ride_type": "COMMERCIAL",
  "from_point": { "place_id": "2gis:from", "title": "Bishkek" },
  "to_point": { "place_id": "2gis:to", "title": "Tokmok" },
  "depart_at": "2026-02-23T18:00:00+06:00",
  "seats_total": 4,
  "price_kgs": 300,
  "booking_mode": "INSTANT",
  "payment_mode": "IN_APP",
  "publish": true
}
```

**Responses:**
- `201` — Поездка создана
- `400` — Validation Error
- `403` — `DRIVER_DOCS_REQUIRED` или `PUBLISH_COOLDOWN`

---

### Bookings

#### `POST /v1/bookings`
Создать бронирование.

**Request:**
```json
{ "ride_id": "uuid", "seats": 1 }
```

**Responses:**
- `201` — `BookingCreateResponse`
- `400` — Validation Error
- `403` — `RISK_BLOCKED` или `BOOKING_COOLDOWN`
- `409` — `SEATS_CONFLICT`

---

#### `GET /v1/bookings/{bookingId}`
Получить детали бронирования.

**Responses:**
- `200` — `BookingDetailsResponse` (booking + offline_proof + payment)
- `404` — Not Found

---

#### `POST /v1/bookings/{bookingId}/accept`
Водитель принимает бронирование (для режима `REQUEST`).

**Responses:**
- `200` — `BookingStatusResponse`
- `403` — Forbidden
- `404` — Not Found

---

#### `POST /v1/bookings/{bookingId}/reject`
Водитель отклоняет бронирование (для режима `REQUEST`).

**Request (опционально):**
```json
{ "reason_code": "string" }
```

**Responses:**
- `200` — `BookingStatusResponse`
- `403` — Forbidden
- `404` — Not Found

---

#### `POST /v1/bookings/{bookingId}/cancel`
Отменить бронирование (идемпотентно при денежных последствиях).

> Требует заголовок `Idempotency-Key`.

**Request:**
```json
{ "actor": "PASSENGER", "reason_code": "CHANGE_OF_PLANS" }
```

**Responses:**
- `200` — `BookingCancelResponse` (booking + penalty + refund)
- `403` — Forbidden
- `404` — Not Found
- `409` — Idempotency Conflict

---

### Payments

#### `POST /v1/payments/intents`
Создать платёжный интент (только для `IN_APP` бронирований).

**Request:**
```json
{ "booking_id": "uuid" }
```

**Responses:**
- `201` — `PaymentIntentCreateResponse`
- `400` — Validation Error
- `403` — `PAYMENT_MODE_NOT_ALLOWED`

---

#### `POST /v1/payments/intents/{intentId}/confirm`
Подтвердить платёжный интент (идемпотентно).

> Требует заголовок `Idempotency-Key`.

**Request:**
```json
{
  "provider_result": {
    "status": "CAPTURED",
    "psp_payment_id": "psp_123",
    "three_ds_result": "CHALLENGE_PASSED"
  }
}
```

**Responses:**
- `200` — `PaymentConfirmResponse` (payment + booking + receipt)
- `402` — `PAYMENT_FAILED`
- `403` — Forbidden
- `409` — Idempotency Conflict

---

### Receipts

#### `GET /v1/payments/{paymentId}/receipt`
Получить фискальный чек.

**Responses:**
- `200` — Чек выдан (`ReceiptGetResponse`)
- `202` — Чек не готов (retrying)
- `404` — Not Found
- `409` — Чек окончательно недоступен (`FAILED_FINAL`)

---

### Offline

#### `POST /v1/bookings/{bookingId}/offline/confirm`
Подтвердить офлайн-результат (только CARPOOL).

**Request:**
```json
{ "actor": "PASSENGER", "result": "COMPLETED", "comment": null }
```

`result`: `COMPLETED | NO_SHOW | DISPUTE`

**Responses:**
- `200` — `OfflineConfirmResponse`
- `403` — Forbidden
- `404` — Not Found

---

#### `POST /v1/bookings/{bookingId}/offline/dispute`
Создать офлайн-диспут (только CARPOOL).

**Request:**
```json
{
  "reason_code": "DRIVER_NO_SHOW",
  "comment": "Водитель не приехал.",
  "attachments": []
}
```

**Responses:**
- `201` — `OfflineDisputeResponse` (ticket + offline_proof)
- `403` — Forbidden
- `404` — Not Found

---

### Driver

#### `POST /v1/driver/type`
Установить тип водителя (`CARPOOL` или `COMMERCIAL`).

#### `POST /v1/driver/docs/upload`
Загрузить метаданные документа водителя (pre-signed flow).

`doc_type`: `DRIVER_LICENSE | VEHICLE_REGISTRATION | COMMERCIAL_LICENSE | ID`

#### `GET /v1/driver/docs/status`
Получить статус документов водителя.

---

### KYC

#### `POST /v1/kyc/start`
Запустить KYC-процесс. Возвращает `redirect_url` к провайдеру.

#### `GET /v1/kyc/status`
Получить статус KYC (`PENDING | VERIFIED | FAILED`).

---

### Payouts

#### `POST /v1/payouts/request`
Запросить выплату (требует KYC `VERIFIED`).

**Request:**
```json
{ "amount_kgs": 5000, "destination_token": "token" }
```

**Responses:**
- `200` — `PayoutResponse` (status: `READY | SENT | FAILED | HELD`)
- `403` — `KYC_REQUIRED`

---

### Support

#### `POST /v1/tickets`
Создать тикет поддержки.

**Request:**
```json
{
  "category": "OFFLINE_DISPUTE",
  "booking_id": "uuid",
  "body": "Описание проблемы",
  "attachments": []
}
```

---

## Компоненты (Schemas)

### Перечисления (Enums)

| Схема | Значения |
|-------|----------|
| `RideType` | `CARPOOL`, `COMMERCIAL` |
| `BookingMode` | `INSTANT`, `REQUEST` |
| `PaymentMode` | `OFFLINE`, `IN_APP` |
| `BookingStatus` | `REQUESTED`, `ACCEPTED`, `PAID`, `RESERVED_OFFLINE`, `CANCELLED`, `COMPLETED`, `REFUNDED` |
| `PaymentStatus` | `INITIATED`, `AUTHORIZED`, `CAPTURED`, `FAILED`, `REFUNDED` |
| `ReceiptStatus` | `ISSUED`, `RETRYING`, `FAILED_FINAL` |

---

### Стандартный формат ошибки (`ApiError`)

```json
{
  "error_code": "STRING_CODE",
  "message": "Human readable",
  "correlation_id": "uuid",
  "details": {}
}
```

---

### Параметры (Parameters)

| Параметр | In | Тип | Описание |
|----------|----|-----|----------|
| `rideId` | path | uuid | ID поездки |
| `bookingId` | path | uuid | ID бронирования |
| `paymentId` | path | uuid | ID платежа |
| `intentId` | path | uuid | ID платёжного интента |
| `Idempotency-Key` | header | string (8–128) | Уникальный ключ операции |

---

### Стандартные ответы (Responses)

| Ответ | HTTP | error_code |
|-------|------|------------|
| Validation Error | 400 | `VALIDATION_ERROR` |
| Unauthorized | 401 | `UNAUTHORIZED` |
| Forbidden | 403 | `FORBIDDEN` |
| Not Found | 404 | `NOT_FOUND` |
| Rate Limited | 429 | `RATE_LIMITED` |
| Idempotency Conflict | 409 | `IDEMPOTENCY_CONFLICT` |

---

### Основные схемы

#### `Point`
```json
{
  "place_id": "2gis:xxx",
  "title": "Bishkek",
  "lat": 42.87,
  "lon": 74.59
}
```

#### `RideSummary`
Поля: `id`, `ride_type`, `depart_at`, `seats_available`, `price_kgs`, `from_point`, `to_point`, `booking_mode`, `payment_mode`

#### `RideDetailsResponse`
`RideSummary` + `seats_total`, `status` (`DRAFT|PUBLISHED|CANCELLED|COMPLETED`), `stops[]`, `driver` (id, rating, verified_docs)

#### `Booking`
Поля: `id`, `ride_id`, `passenger_id`, `seats`, `payment_mode`, `status`, `fare_kgs`, `service_fee_kgs`, `cancellation_policy`, `created_at`

#### `OfflineProof`
Поля: `booking_id`, `passenger_result`, `driver_result`, `status` (`PENDING|MATCHED|MISMATCHED|AUTO_RESOLVED`), `no_show_resolution_deadline`, `dispute_created`

#### `ReceiptIssuer`
Поля: `legal_form`, `full_name`, `inn`, `legal_address`, `agent_flag`, `service_type`

---

## Полная YAML-схема (OpenAPI 3.0.3)

```yaml
openapi: 3.0.3
info:
  title: Carpooling Platform API (BlaBlaCar-like) — KG v1
  version: "1.0.0"
  description: >
    MVP Kyrgyzstan (KGS, RU/KG). Hybrid: CARPOOL=OFFLINE, COMMERCIAL=IN_APP only.
servers:
  - url: https://api.example.com
security:
  - bearerAuth: []

x-idempotency:
  requiredFor:
    - "POST /v1/payments/intents/{intentId}/confirm"
    - "POST /v1/refunds"
    - "POST /v1/bookings/{bookingId}/cancel"

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    ApiError:
      type: object
      required: [error_code, message, correlation_id, details]
      properties:
        error_code: { type: string }
        message: { type: string }
        correlation_id: { type: string }
        details: { type: object, additionalProperties: true }

    RideType:
      type: string
      enum: [CARPOOL, COMMERCIAL]

    BookingMode:
      type: string
      enum: [INSTANT, REQUEST]

    PaymentMode:
      type: string
      enum: [OFFLINE, IN_APP]

    BookingStatus:
      type: string
      enum: [REQUESTED, ACCEPTED, PAID, RESERVED_OFFLINE, CANCELLED, COMPLETED, REFUNDED]

    PaymentStatus:
      type: string
      enum: [INITIATED, AUTHORIZED, CAPTURED, FAILED, REFUNDED]

    ReceiptStatus:
      type: string
      enum: [ISSUED, RETRYING, FAILED_FINAL]

    Point:
      type: object
      required: [place_id, title]
      properties:
        place_id: { type: string }
        title: { type: string }
        lat: { type: number, format: double }
        lon: { type: number, format: double }
```
