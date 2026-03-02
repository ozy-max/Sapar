# Sapar — BFF /v1 Contract (для мобильных клиентов)

> Base URL: `http://localhost:3000/v1`
> Rate limit: 100 RPM (per IP, sliding window)
> Timeout: 2500ms (BFF_TIMEOUT_MS)

BFF (Backend-for-Frontend) — стабильный агрегирующий слой в api-gateway. Мобильные клиенты используют только `/v1/*` эндпоинты, которые объединяют данные из нескольких сервисов в один ответ.

---

## Содержание

1. [GET /v1/trips/search](#get-v1tripssearch)
2. [GET /v1/trips/:tripId](#get-v1tripstripid)
3. [GET /v1/bookings/:bookingId](#get-v1bookingsbookingid)
4. [GET /v1/me/bookings](#get-v1mebookings)
5. [Общие DTO](#общие-dto)
6. [Обработка ошибок](#обработка-ошибок)

---

## GET `/v1/trips/search`

Поиск поездок. Агрегирует данные из trips-service.

- **Auth:** Public
- **Downstream:** `trips-service GET /search`

### Query Parameters

| Параметр | Тип | Обяз. | Default | Описание |
|----------|-----|:-----:|---------|----------|
| `fromCity` | string | * | — | Город отправления |
| `toCity` | string | — | — | Город назначения |
| `fromCityId` | UUID | * | — | ID города отправления |
| `toCityId` | UUID | — | — | ID города назначения |
| `fromLat` | number | * | — | Широта отправления (-90..90) |
| `fromLon` | number | — | — | Долгота отправления (-180..180) |
| `toLat` | number | — | — | Широта назначения |
| `toLon` | number | — | — | Долгота назначения |
| `radiusKm` | number | — | 25 | Радиус поиска (1–500 км) |
| `bboxMinLat` | number | * | — | Bounding box min lat |
| `bboxMinLon` | number | — | — | Bounding box min lon |
| `bboxMaxLat` | number | — | — | Bounding box max lat |
| `bboxMaxLon` | number | — | — | Bounding box max lon |
| `dateFrom` | string | — | — | `YYYY-MM-DD` |
| `dateTo` | string | — | — | `YYYY-MM-DD` |
| `minSeats` | integer | — | 1 | Минимум мест (1–50) |
| `priceMin` | integer | — | — | Мин. цена (KGS) |
| `priceMax` | integer | — | — | Макс. цена (KGS) |
| `limit` | integer | — | 50 | 1–100 |
| `offset` | integer | — | 0 | ≥0 |

> **\*** — Обязательно хотя бы одно из: `fromCity`, `fromCityId`, `fromLat`, `bboxMinLat`.

### Response `200 OK`

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
  "paging": {
    "limit": 50,
    "offset": 0,
    "total": 1
  },
  "meta": {
    "requestId": "c1d2e3f4-5678-90ab-cdef-1234567890ab",
    "timestamp": "2026-03-02T12:00:00.000Z"
  }
}
```

### TripCardDto

| Поле | Тип | Описание |
|------|-----|----------|
| `tripId` | UUID | ID поездки |
| `driverId` | UUID | ID водителя |
| `fromCity` | string | Город отправления |
| `toCity` | string | Город назначения |
| `departAt` | string (ISO 8601) | Дата/время отправления |
| `seatsAvailable` | integer | Свободных мест |
| `priceKgs` | integer | Цена в сомах |
| `status` | string | Статус: `ACTIVE` |

### Ошибки

| Код | HTTP | Описание |
|-----|------|----------|
| `VALIDATION_ERROR` | 400 | Не указан location-фильтр или невалидные параметры |
| `DOWNSTREAM_TIMEOUT` | 504 | Trips-service не ответил |
| `BAD_GATEWAY` | 502 | Ошибка ответа trips-service |

---

## GET `/v1/trips/:tripId`

Детали поездки с рейтингом водителя. Агрегирует trips-service + profiles-service.

- **Auth:** Public
- **Downstream:**
  - `trips-service GET /bff/trips/:tripId`
  - `profiles-service GET /profiles/:driverId` (best-effort: при ошибке рейтинг = `null`)

### Path Parameters

| Параметр | Тип | Описание |
|----------|-----|----------|
| `tripId` | UUID | ID поездки |

### Response `200 OK`

```json
{
  "tripId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "driverId": "550e8400-e29b-41d4-a716-446655440000",
  "fromCity": "Бишкек",
  "toCity": "Ош",
  "departAt": "2026-03-15T08:00:00.000Z",
  "seatsTotal": 3,
  "seatsAvailable": 2,
  "priceKgs": 1500,
  "status": "ACTIVE",
  "createdAt": "2026-03-10T10:00:00.000Z",
  "updatedAt": "2026-03-10T10:00:00.000Z",
  "driverRating": {
    "ratingAvg": 4.7,
    "ratingCount": 23
  }
}
```

### TripDetailsResponseDto

| Поле | Тип | Описание |
|------|-----|----------|
| `tripId` | UUID | ID поездки |
| `driverId` | UUID | ID водителя |
| `fromCity` | string | Город отправления |
| `toCity` | string | Город назначения |
| `departAt` | string | Дата/время отправления |
| `seatsTotal` | integer | Всего мест |
| `seatsAvailable` | integer | Свободных мест |
| `priceKgs` | integer | Цена |
| `status` | string | Статус поездки |
| `createdAt` | string | Дата создания |
| `updatedAt` | string | Дата обновления |
| `driverRating` | DriverRatingDto \| null | Рейтинг водителя (null при ошибке profiles) |

### DriverRatingDto

| Поле | Тип | Описание |
|------|-----|----------|
| `ratingAvg` | number | Средний рейтинг (1.0–5.0) |
| `ratingCount` | integer | Кол-во оценок |

### Ошибки

| Код | HTTP | Описание |
|-----|------|----------|
| `NOT_FOUND` | 404 | Поездка не найдена |
| `DOWNSTREAM_TIMEOUT` | 504 | Trips-service не ответил |

---

## GET `/v1/bookings/:bookingId`

Детали бронирования с информацией о платеже. Агрегирует trips-service + payments-service.

- **Auth:** Bearer JWT (проверка заголовка в BFF, полная верификация в downstream)
- **Downstream:**
  - `trips-service GET /bff/bookings/:bookingId`
  - `payments-service GET /bff/bookings/:bookingId/payment-summary` (best-effort)

### Path Parameters

| Параметр | Тип | Описание |
|----------|-----|----------|
| `bookingId` | UUID | ID бронирования |

### Headers

| Заголовок | Обяз. | Описание |
|-----------|:-----:|----------|
| `Authorization: Bearer <token>` | Да | JWT access token |

### Response `200 OK`

```json
{
  "bookingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "tripId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "passengerId": "550e8400-e29b-41d4-a716-446655440000",
  "seats": 1,
  "status": "CONFIRMED",
  "createdAt": "2026-03-15T08:01:00.000Z",
  "updatedAt": "2026-03-15T08:02:00.000Z",
  "trip": {
    "tripId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "fromCity": "Бишкек",
    "toCity": "Ош",
    "departAt": "2026-03-15T08:00:00.000Z",
    "priceKgs": 1500
  },
  "payment": {
    "intentId": "3b3a2c2e-3d0f-4c1a-9d2b-1a0c4b8d2e1f",
    "status": "HOLD_PLACED",
    "amountKgs": 1500,
    "currency": "KGS"
  }
}
```

### BookingDetailsResponseDto

| Поле | Тип | Описание |
|------|-----|----------|
| `bookingId` | UUID | ID бронирования |
| `tripId` | UUID | ID поездки |
| `passengerId` | UUID | ID пассажира |
| `seats` | integer | Кол-во мест |
| `status` | string | `PENDING_PAYMENT` / `CONFIRMED` / `CANCELLED` / `EXPIRED` |
| `createdAt` | string | Дата создания |
| `updatedAt` | string | Дата обновления |
| `trip` | BookingTripSummaryDto | Сводка по поездке |
| `payment` | BookingPaymentDto \| null | Сводка по платежу (null при ошибке payments) |

### BookingPaymentDto

| Поле | Тип | Описание |
|------|-----|----------|
| `intentId` | UUID | ID payment intent |
| `status` | string | Статус: `CREATED`/`HOLD_REQUESTED`/`HOLD_PLACED`/`CAPTURED`/`CANCELLED`/`REFUNDED`/`FAILED` |
| `amountKgs` | integer | Сумма |
| `currency` | string | Валюта (`KGS`) |

### Ошибки

| Код | HTTP | Описание |
|-----|------|----------|
| `UNAUTHORIZED` | 401 | Нет или невалидный Bearer token |
| `NOT_FOUND` | 404 | Бронирование не найдено |
| `DOWNSTREAM_TIMEOUT` | 504 | Downstream не ответил |

---

## GET `/v1/me/bookings`

Список бронирований текущего пользователя с информацией о платежах.

- **Auth:** Bearer JWT
- **Downstream:**
  - `trips-service GET /bff/me/bookings?status=&limit=&offset=`
  - `payments-service POST /bff/payments/summary` (batch, best-effort, до 50 bookingIds)

### Query Parameters

| Параметр | Тип | Default | Описание |
|----------|-----|---------|----------|
| `status` | string | — | Фильтр: `PENDING_PAYMENT`, `CONFIRMED`, `CANCELLED`, `EXPIRED` |
| `limit` | integer | 20 | 1–100 |
| `offset` | integer | 0 | ≥0 |

### Headers

| Заголовок | Обяз. | Описание |
|-----------|:-----:|----------|
| `Authorization: Bearer <token>` | Да | JWT access token |

### Response `200 OK`

```json
{
  "items": [
    {
      "bookingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "tripId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "seats": 1,
      "status": "CONFIRMED",
      "createdAt": "2026-03-15T08:01:00.000Z",
      "trip": {
        "fromCity": "Бишкек",
        "toCity": "Ош",
        "departAt": "2026-03-15T08:00:00.000Z",
        "priceKgs": 1500
      },
      "payment": {
        "intentId": "3b3a2c2e-3d0f-4c1a-9d2b-1a0c4b8d2e1f",
        "status": "CAPTURED",
        "amountKgs": 1500,
        "currency": "KGS"
      }
    }
  ],
  "paging": {
    "limit": 20,
    "offset": 0,
    "total": 5
  },
  "meta": {
    "requestId": "c1d2e3f4-5678-90ab-cdef-1234567890ab",
    "timestamp": "2026-03-02T12:00:00.000Z"
  }
}
```

### MyBookingItemDto

| Поле | Тип | Описание |
|------|-----|----------|
| `bookingId` | UUID | ID бронирования |
| `tripId` | UUID | ID поездки |
| `seats` | integer | Кол-во мест |
| `status` | string | Статус бронирования |
| `createdAt` | string | Дата создания |
| `trip` | object | Сводка: `fromCity`, `toCity`, `departAt`, `priceKgs` |
| `payment` | BookingPaymentDto \| null | Платёжная информация (null при ошибке payments) |

### Ошибки

| Код | HTTP | Описание |
|-----|------|----------|
| `UNAUTHORIZED` | 401 | Нет или невалидный Bearer token |
| `VALIDATION_ERROR` | 400 | Невалидный статус или параметры пагинации |

---

## Общие DTO

### PagingDto

```json
{
  "limit": 20,
  "offset": 0,
  "total": 42
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `limit` | integer | Запрошенный лимит |
| `offset` | integer | Запрошенное смещение |
| `total` | integer | Общее количество записей |

### MetaDto

```json
{
  "requestId": "uuid",
  "timestamp": "2026-03-02T12:00:00.000Z"
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `requestId` | string | X-Request-Id |
| `timestamp` | string (ISO 8601) | Время ответа |

### BffErrorDto

```json
{
  "code": "ERROR_CODE",
  "message": "Описание",
  "details": {},
  "traceId": "uuid"
}
```

---

## Обработка ошибок

### Стратегия best-effort

BFF агрегирует данные из нескольких сервисов. При ошибке **второстепенного** сервиса:
- Основные данные возвращаются как обычно
- Поле второстепенного сервиса = `null`
- Не возвращается ошибка клиенту

| Эндпоинт | Основной сервис | Второстепенный (best-effort) |
|----------|-----------------|------------------------------|
| `/v1/trips/:tripId` | trips-service | profiles-service (driverRating) |
| `/v1/bookings/:bookingId` | trips-service | payments-service (payment) |
| `/v1/me/bookings` | trips-service | payments-service (payment per booking) |

### Ошибки BFF

| Код | HTTP | Когда |
|-----|------|-------|
| `UNAUTHORIZED` | 401 | Нет Bearer заголовка на защищённом эндпоинте |
| `VALIDATION_ERROR` | 400 | Невалидные query-параметры |
| `NOT_FOUND` | 404 | Основной ресурс не найден |
| `DOWNSTREAM_TIMEOUT` | 504 | Основной downstream не ответил за BFF_TIMEOUT_MS |
| `BAD_GATEWAY` | 502 | Ошибка ответа основного downstream |
| `INTERNAL_ERROR` | 500 | Необработанная ошибка |

### CORS

BFF поддерживает CORS:
- Allowed methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
- Allowed headers: `Content-Type, Authorization, X-Request-Id, Idempotency-Key`
- Exposed headers: `X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset`
