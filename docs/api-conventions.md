# Общие соглашения API — BlaBlaCar аналог (KG)

> Версия: v1  
> Base URL: `https://api.example.com`

---

## Содержание

1. [Headers](#1-headers)
2. [Формат ошибок](#2-формат-ошибок)
3. [Коды ошибок](#3-коды-ошибок)
4. [Примеры запросов](#4-примеры-запросов)

---

## 1. Headers

| Заголовок | Обязательность | Описание |
|-----------|:--------------:|----------|
| `Authorization: Bearer <access_token>` | Всегда (кроме public endpoints) | JWT токен |
| `X-Correlation-Id: <uuid>` | Опционально | Если не передан — сервер генерирует и возвращает в ответе |
| `Idempotency-Key: <uuid>` | **Обязательно** для ряда операций | Уникальный ключ на логическую операцию |

### Idempotency-Key обязателен для:

- `POST /v1/payments/intents/{id}/confirm`
- `POST /v1/refunds`
- `POST /v1/bookings/{id}/cancel` *(при денежных последствиях)*

---

## 2. Формат ошибок

Все ошибки возвращаются в едином формате:

```json
{
  "error_code": "STRING_CODE",
  "message": "Human readable",
  "correlation_id": "uuid",
  "details": {}
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `error_code` | string | Машиночитаемый код ошибки |
| `message` | string | Описание для отображения пользователю |
| `correlation_id` | string (uuid) | ID для трассировки запроса |
| `details` | object | Дополнительные данные (зависит от ошибки) |

---

## 3. Коды ошибок

| Код | HTTP | Описание |
|-----|:----:|----------|
| `VALIDATION_ERROR` | 400 | Некорректные данные запроса |
| `UNAUTHORIZED` | 401 | Отсутствует или невалидный токен |
| `FORBIDDEN` | 403 | Недостаточно прав |
| `NOT_FOUND` | 404 | Ресурс не найден |
| `CONFLICT` | 409 | Конфликт состояния |
| `RATE_LIMITED` | 429 | Слишком много запросов |
| `RISK_BLOCKED` | 403 | Заблокировано risk-политикой |
| `PAYMENT_MODE_NOT_ALLOWED` | 403 | Режим оплаты недопустим для данной поездки |
| `SEATS_CONFLICT` | 409 | Недостаточно свободных мест |
| `PUBLISH_COOLDOWN` | 403 | Cooldown публикации из-за поздних отмен |
| `DRIVER_DOCS_REQUIRED` | 403 | Требуются документы водителя |
| `COMMERCIAL_DOCS_REQUIRED` | 403 | Требуются документы для коммерческого водителя |
| `KYC_REQUIRED` | 403 | Требуется прохождение KYC |
| `RECEIPT_NOT_READY` | 202 | Чек ещё формируется |
| `IDEMPOTENCY_CONFLICT` | 409 | Idempotency-Key уже использован с другим телом запроса |
| `BOOKING_COOLDOWN` | 403 | Cooldown бронирования (слишком много отмен) |
| `PAYMENT_FAILED` | 402 | Платёж отклонён провайдером |

---

## 4. Примеры запросов

### 4.1 Создание бронирования

**`POST /v1/bookings`**

```json
{
  "ride_id": "9f1b9b7e-3a8c-4f61-b3a8-3d7c2ce9d4a1",
  "seats": 1
}
```

**Response 201 — CARPOOL → OFFLINE**

```json
{
  "booking": {
    "id": "a5d0e1e9-8ce3-45df-9f1a-8fb3b547a2f6",
    "ride_id": "9f1b9b7e-3a8c-4f61-b3a8-3d7c2ce9d4a1",
    "passenger_id": "1f4f7c6d-9c0b-41d8-a3b5-8e3b2d5b7a10",
    "seats": 1,
    "payment_mode": "OFFLINE",
    "status": "REQUESTED",
    "fare_kgs": 500,
    "service_fee_kgs": 0,
    "cancellation_policy": {
      "policy_id": "cancel_kg_v1",
      "version": 1,
      "summary": {
        "free_window_minutes": 30,
        "cancel_fee_kgs_fixed_after_free": 100,
        "tier_multiplier": 1.0
      }
    },
    "created_at": "2026-02-23T06:05:00Z"
  }
}
```

**Response 201 — COMMERCIAL → IN_APP**

```json
{
  "booking": {
    "id": "7c7c3fd7-86b9-4b12-8c6c-0d7f4b8fb3e1",
    "ride_id": "2d51f1d0-3c38-4b71-b0de-0b7d0b7e2b7a",
    "passenger_id": "1f4f7c6d-9c0b-41d8-a3b5-8e3b2d5b7a10",
    "seats": 1,
    "payment_mode": "IN_APP",
    "status": "ACCEPTED",
    "fare_kgs": 2000,
    "service_fee_kgs": 0,
    "cancellation_policy": {
      "policy_id": "cancel_kg_v1",
      "version": 1,
      "summary": {
        "free_window_minutes": 5,
        "min_fee_kgs": 100,
        "percent": 0.15,
        "formula": "MAX(min_fee, percent * trip_fare)",
        "tier_multiplier": 1.0
      }
    },
    "next_action": {
      "type": "CREATE_PAYMENT_INTENT",
      "endpoint": "/v1/payments/intents",
      "payload": { "booking_id": "7c7c3fd7-86b9-4b12-8c6c-0d7f4b8fb3e1" }
    },
    "created_at": "2026-02-23T06:05:00Z"
  }
}
```

**Error 409 — SEATS_CONFLICT**

```json
{
  "error_code": "SEATS_CONFLICT",
  "message": "Not enough seats available.",
  "correlation_id": "b2f9d6b4-3b3d-4a9f-8a8f-0f2e7d6a1c22",
  "details": { "seats_available": 0 }
}
```

**Error 403 — RISK_BLOCKED**

```json
{
  "error_code": "RISK_BLOCKED",
  "message": "Booking blocked by risk policy.",
  "correlation_id": "c0de1d11-5b63-4c62-9f1b-6f3d2b9a8f01",
  "details": { "decision": "BLOCK_AND_REVIEW", "risk_case_id": "d1c..." }
}
```

---

### 4.2 Создание платёжного интента (COMMERCIAL)

**`POST /v1/payments/intents`**

```json
{ "booking_id": "7c7c3fd7-86b9-4b12-8c6c-0d7f4b8fb3e1" }
```

**Response 201**

```json
{
  "payment_intent": {
    "id": "3b3a2c2e-3d0f-4c1a-9d2b-1a0c4b8d2e1f",
    "booking_id": "7c7c3fd7-86b9-4b12-8c6c-0d7f4b8fb3e1",
    "amount_kgs": 2000,
    "status": "INITIATED",
    "provider": "PSP_X",
    "client_action": {
      "type": "PSP_SDK_CONFIRM",
      "provider_payload": {
        "client_secret": "psp_secret_...",
        "requires_3ds": true
      }
    }
  }
}
```

---

### 4.3 Подтверждение платежа (Idempotent)

**`POST /v1/payments/intents/{id}/confirm`**  
Headers: `Idempotency-Key: 2b0d9f85-64a4-4f21-84f5-39c5d6a3f1a1`

```json
{
  "provider_result": {
    "status": "CAPTURED",
    "psp_payment_id": "psp_123",
    "three_ds_result": "CHALLENGE_PASSED"
  }
}
```

**Response 200**

```json
{
  "payment": {
    "id": "5b1b2c3d-8a0f-4b1c-9f2a-1b0c2d3e4f5a",
    "booking_id": "7c7c3fd7-86b9-4b12-8c6c-0d7f4b8fb3e1",
    "status": "CAPTURED",
    "amount_kgs": 2000,
    "provider": "PSP_X",
    "created_at": "2026-02-23T06:06:20Z"
  },
  "booking": {
    "id": "7c7c3fd7-86b9-4b12-8c6c-0d7f4b8fb3e1",
    "status": "PAID"
  },
  "receipt": {
    "status": "RETRYING",
    "next_retry_at": "2026-02-23T06:06:25Z"
  }
}
```

> Повторный запрос с тем же `Idempotency-Key` вернёт тот же ответ `200`.

**Error 402 — PAYMENT_FAILED**

```json
{
  "error_code": "PAYMENT_FAILED",
  "message": "Payment failed by provider.",
  "correlation_id": "a8c2...",
  "details": { "psp_reason": "INSUFFICIENT_FUNDS" }
}
```

**Error 409 — IDEMPOTENCY_CONFLICT**

```json
{
  "error_code": "IDEMPOTENCY_CONFLICT",
  "message": "Idempotency-Key already used with different request body.",
  "correlation_id": "f1e1...",
  "details": {}
}
```

---

### 4.4 Получение фискального чека

**`GET /v1/payments/{payment_id}/receipt`**

**Response 200 — Чек выдан**

```json
{
  "receipt": {
    "id": "9a9b8c7d-6e5f-4a3b-9c2d-1e0f3a2b1c0d",
    "payment_id": "5b1b2c3d-8a0f-4b1c-9f2a-1b0c2d3e4f5a",
    "status": "ISSUED",
    "issued_at": "2026-02-23T06:07:00Z",
    "issuer": {
      "legal_form": "ОсОО",
      "full_name": "PLATFORM_LEGAL_NAME",
      "inn": "PLATFORM_INN",
      "legal_address": "PLATFORM_LEGAL_ADDRESS",
      "agent_flag": true,
      "service_type": "DIGITAL_PLATFORM_SERVICE"
    },
    "fiscal": {
      "receipt_number": "EKKM-00012345",
      "fiscal_sign": "FS-ABC...",
      "ofd": "PROVIDER_X"
    },
    "links": {
      "pdf_url": "https://cdn.example/receipts/9a9b8c7d.pdf"
    }
  }
}
```

**Response 202 — Чек не готов**

```json
{
  "receipt": {
    "status": "RETRYING",
    "retry_count": 1,
    "next_retry_at": "2026-02-23T06:06:50Z"
  }
}
```

**Response 409 — Чек окончательно недоступен**

```json
{
  "receipt": {
    "status": "FAILED_FINAL",
    "retry_count": 3,
    "finance_case_id": "6f7a8b9c-1d2e-3f40-9a0b-1c2d3e4f5a6b"
  }
}
```

---

### 4.5 Отмена бронирования

**`POST /v1/bookings/{id}/cancel`**  
Headers: `Idempotency-Key: 9caa6a76-b1e3-4dd0-a7b6-0b0d8a6a2c1f`

```json
{
  "actor": "PASSENGER",
  "reason_code": "CHANGE_OF_PLANS"
}
```

**Response 200 — CARPOOL (после 30 мин → penalty ledger)**

```json
{
  "booking": {
    "id": "a5d0e1e9-8ce3-45df-9f1a-8fb3b547a2f6",
    "status": "CANCELLED"
  },
  "penalty": {
    "type": "LEDGER",
    "amount_kgs": 100,
    "status": "OPEN",
    "penalty_ledger_id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    "tier": "tier0",
    "multiplier": 1.0
  }
}
```

**Response 200 — COMMERCIAL (платная отмена → refund)**

```json
{
  "booking": {
    "id": "7c7c3fd7-86b9-4b12-8c6c-0d7f4b8fb3e1",
    "status": "CANCELLED"
  },
  "penalty": {
    "amount_kgs": 300,
    "formula": "MAX(100, 0.15*trip_fare)",
    "tier": "tier1",
    "multiplier": 1.5
  },
  "refund": {
    "id": "2f3e4d5c-6b7a-4890-9c1d-2e3f4a5b6c7d",
    "amount_kgs": 1550,
    "status": "INITIATED"
  }
}
```

**Error 403 — BOOKING_COOLDOWN**

```json
{
  "error_code": "BOOKING_COOLDOWN",
  "message": "Too many cancellations. Cooldown active.",
  "correlation_id": "aa12...",
  "details": { "cooldown_until": "2026-02-23T10:00:00Z" }
}
```

---

### 4.6 Offline Confirm / Dispute (CARPOOL)

#### Подтверждение результата поездки

**`POST /v1/bookings/{id}/offline/confirm`**

```json
{
  "actor": "DRIVER",
  "result": "NO_SHOW",
  "comment": "Passenger did not arrive."
}
```

**Response 200**

```json
{
  "offline_proof": {
    "booking_id": "a5d0e1e9-8ce3-45df-9f1a-8fb3b547a2f6",
    "driver_result": "NO_SHOW",
    "passenger_result": null,
    "status": "PENDING",
    "no_show_resolution_deadline": "2026-02-23T20:00:00Z"
  }
}
```

---

#### Создание диспута

**`POST /v1/bookings/{id}/offline/dispute`**

```json
{
  "reason_code": "DRIVER_NO_SHOW",
  "comment": "Driver did not come to pickup.",
  "attachments": []
}
```

**Response 201**

```json
{
  "ticket": {
    "id": "0c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
    "status": "OPEN",
    "category": "OFFLINE_DISPUTE"
  },
  "offline_proof": {
    "status": "MISMATCHED",
    "dispute_created": true
  }
}
```

---

#### Авто-разрешение (серверное событие)

> Срабатывает, если `now >= depart_at + 12h` и `dispute_created = false`.

**GET `/v1/bookings/{id}` — после авто-разрешения:**

```json
{
  "booking": {
    "id": "a5d0e1e9-8ce3-45df-9f1a-8fb3b547a2f6",
    "status": "COMPLETED"
  },
  "offline_proof": {
    "status": "AUTO_RESOLVED",
    "auto_resolved_at": "2026-02-23T20:00:01Z"
  },
  "no_show": {
    "result": "NO_SHOW_CONFIRMED",
    "service_fee_non_refundable": true
  }
}
```

---

### 4.7 Публикация поездки — ошибки

**`POST /v1/rides`**

**Error 403 — DRIVER_DOCS_REQUIRED**

```json
{
  "error_code": "DRIVER_DOCS_REQUIRED",
  "message": "Driver documents must be verified to publish rides.",
  "correlation_id": "9b1c...",
  "details": {
    "required_docs": ["DRIVER_LICENSE", "VEHICLE_REGISTRATION"]
  }
}
```

**Error 403 — PUBLISH_COOLDOWN**

```json
{
  "error_code": "PUBLISH_COOLDOWN",
  "message": "Publish cooldown active due to late cancellations.",
  "correlation_id": "1c2d...",
  "details": { "cooldown_until": "2026-02-23T12:00:00Z" }
}
```
