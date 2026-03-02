# Sapar — Обзор платформы

> Платформа совместных поездок (аналог BlaBlaCar) для Кыргызстана.
> Валюта: **KGS** · Локали: `ru-KG`, `ky-KG`

---

## Содержание

1. [Назначение](#назначение)
2. [Роли пользователей](#роли-пользователей)
3. [Микросервисы](#микросервисы)
4. [Основные бизнес-потоки](#основные-бизнес-потоки)
5. [Стейт-машины](#стейт-машины)
6. [Межсервисное взаимодействие](#межсервисное-взаимодействие)
7. [Ключевые архитектурные паттерны](#ключевые-архитектурные-паттерны)

---

## Назначение

Sapar — бэкенд для маркетплейса совместных поездок, где водители публикуют маршруты с датой и ценой, а пассажиры ищут и бронируют места. Платформа обеспечивает:

- Поиск поездок по городам и геокоординатам
- Бронирование мест с оплатой через payment intent (hold → capture)
- Автоматическую отмену и возврат средств (saga с компенсациями)
- Уведомления по всем каналам (push, email, SMS)
- Рейтинги и профили пользователей
- Административное управление: конфигурации, споры, модерация, бан

---

## Роли пользователей

| Роль | Описание | Назначение |
|------|----------|------------|
| `PASSENGER` | Пассажир | Поиск, бронирование, отмена, оценка водителя |
| `DRIVER` | Водитель | Создание / отмена / завершение поездок, оценка пассажиров |
| `ADMIN` | Администратор | Полный доступ: конфиги, споры, бан/разбан, модерация, назначение ролей |
| `OPS` | Оператор | Конфиги, модерация (бан/разбан, отмена поездок) |
| `SUPPORT` | Поддержка | Просмотр конфигов, создание и обработка споров |

Роли хранятся в `identity-service`, передаются в JWT access token (`roles[]`), проверяются Guards на каждом сервисе.

---

## Микросервисы

```
Mobile / Web
     │
     ▼
┌─────────────────┐
│   api-gateway   │──proxy──▶ identity / trips / payments / notifications / admin / profiles
│   (BFF /v1)     │
└────────┬────────┘
         │
  ┌──────┴───────────────────────────────────┐
  │  PostgreSQL (×7)  ·  Redis (×2)          │
  └──────────────────────────────────────────┘
```

| Сервис | Порт | База данных | Назначение |
|--------|------|-------------|------------|
| `api-gateway` | 3000 | `sapar_gateway` | Proxy, rate limiting (Redis + Lua), BFF `/v1` агрегирующие эндпоинты |
| `identity-service` | 3001 | `sapar_identity` | Регистрация, логин, JWT (access + refresh), RBAC, бан/разбан |
| `trips-service` | 3002 | `sapar_trips` | Поездки, бронирования, booking saga, геопоиск с кэшированием |
| `payments-service` | 3003 | `sapar_payments` | PSP-адаптер, payment intents (hold/capture/cancel/refund), webhooks, чеки |
| `notifications-service` | 3004 | `sapar_notifications` | Уведомления (push, email, SMS), шаблоны, worker с retry |
| `admin-service` | 3005 | `sapar_admin` | Конфиги (JSON), споры, модерация, команды сервисам, audit log |
| `profiles-service` | 3006 | `sapar_profiles` | Профили пользователей, рейтинги, агрегированные оценки |

Каждый сервис имеет:
- Собственную PostgreSQL базу (database-per-service)
- Единообразную структуру: `adapters/db`, `adapters/http`, `application`, `shared`, `workers`, `observability`
- Health (`GET /health`) и readiness (`GET /ready`) эндпоинты
- Prometheus метрики (`GET /metrics`)

---

## Основные бизнес-потоки

### Пассажир: поиск → бронирование → оплата → подтверждение

```
1. Поиск поездок        GET  /v1/trips/search?fromCity=Бишкек&toCity=Ош&minSeats=1
2. Детали поездки        GET  /v1/trips/:tripId                (агрегация: trip + рейтинг водителя)
3. Бронирование          POST /:tripId/book                    (через proxy /trips)
     └─ Создаётся Booking (PENDING_PAYMENT)
     └─ Публикуется booking.created
4. Payments получает событие → создаёт PaymentIntent → ставит hold через PSP
5. Trips получает payment.intent.hold_placed → Booking → CONFIRMED
     └─ Публикуется booking.confirmed
6. Payments захватывает средства (capture)
     └─ Публикуется payment.captured → Notifications отправляет push
```

### Пассажир: отмена бронирования

```
1. Отмена                POST /bookings/:bookingId/cancel      (через proxy /trips)
     └─ Booking → CANCELLED (reason: USER_CANCELLED)
     └─ Места возвращаются в поездку
     └─ Публикуется booking.cancelled
2. Payments получает событие → cancel hold или refund
     └─ Публикуется payment.cancelled / payment.refunded
3. Notifications получает событие → SMS пассажиру
```

### Водитель: создание → завершение → рейтинги

```
1. Создание поездки      POST /                                (через proxy /trips)
     └─ Trip (ACTIVE): fromCity, toCity, departAt, seatsTotal, priceKgs
2. Завершение            POST /:tripId/complete                (через proxy /trips)
     └─ Trip → COMPLETED
     └─ Публикуется trip.completed с confirmedBookings
3. Profiles получает trip.completed → создаёт RatingEligibility
4. Рейтинг               POST /ratings                         (через proxy /profiles)
     └─ Водитель оценивает пассажира (или наоборот)
```

### Водитель: отмена поездки

```
1. Отмена                POST /:tripId/cancel                  (через proxy /trips)
     └─ Trip → CANCELLED
     └─ Все PENDING_PAYMENT и CONFIRMED бронирования → CANCELLED
     └─ Публикуется trip.cancelled + booking.cancelled для каждого
2. Payments отменяет/возвращает средства по каждому бронированию
```

### Администратор: конфиги → споры → модерация

```
Конфигурации:
  GET    /configs              — список всех конфигов
  GET    /configs/:key         — конкретный конфиг
  PUT    /configs/:key         — создание / обновление
  DELETE /configs/:key         — удаление (только ADMIN)

Споры:
  POST   /disputes             — создать спор (bookingId, тип: NO_SHOW / OTHER)
  GET    /disputes/:id         — детали спора
  POST   /disputes/:id/resolve — разрешение (REFUND / NO_REFUND / PARTIAL / BAN_USER)
     └─ Публикуется dispute.resolved → Payments делает refund
  POST   /disputes/:id/close   — закрытие

Модерация:
  POST   /moderation/users/:userId/ban   — бан (→ AdminCommand → identity-service)
  POST   /moderation/users/:userId/unban — разбан
  POST   /moderation/trips/:tripId/cancel — отмена поездки (→ AdminCommand → trips-service)
```

---

## Стейт-машины

### Trip (поездка)

```
   ┌──────────┐
   │  ACTIVE  │──────── cancel (водитель/админ) ──▶ CANCELLED
   └────┬─────┘
        │
    complete (водитель)
        │
        ▼
   COMPLETED
```

| Состояние | Описание | Терминальное |
|-----------|----------|:------------:|
| `ACTIVE` | Опубликована, доступна для бронирования | Нет |
| `CANCELLED` | Отменена водителем или администратором | Да |
| `COMPLETED` | Завершена водителем | Да |

### Booking (бронирование)

```
                           hold_placed
   ┌─────────────────┐ ──────────────────▶ ┌───────────┐
   │ PENDING_PAYMENT │                      │ CONFIRMED │
   └────────┬────────┘                      └─────┬─────┘
        │       │                                  │
   payment_failed │  TTL expired      user/trip/admin cancel
        │       │                                  │
        ▼       ▼                                  ▼
   CANCELLED  EXPIRED                          CANCELLED
```

| Состояние | Описание | Терминальное |
|-----------|----------|:------------:|
| `PENDING_PAYMENT` | Ожидание холда (TTL: 15 мин по умолчанию) | Нет |
| `CONFIRMED` | Hold размещён, бронирование подтверждено | Нет |
| `CANCELLED` | Отменено (user/payment fail/trip cancel/admin) | Да |
| `EXPIRED` | TTL истёк без оплаты | Да |

### PaymentIntent (платёжный интент)

```
  CREATED → HOLD_REQUESTED → HOLD_PLACED → CAPTURED → REFUNDED
       │              │              │           │
       ▼              ▼              ▼           ▼
    FAILED         FAILED       CANCELLED    (terminal)
```

| Состояние | Описание | Терминальное |
|-----------|----------|:------------:|
| `CREATED` | Создан, ожидает обработки | Нет |
| `HOLD_REQUESTED` | Запрос холда отправлен в PSP | Нет |
| `HOLD_PLACED` | Средства заблокированы | Нет |
| `CAPTURED` | Средства списаны | Нет |
| `CANCELLED` | Интент отменён | Да |
| `REFUNDED` | Средства возвращены | Да |
| `FAILED` | Ошибка на любом этапе | Да |

### Dispute (спор)

```
  OPEN → RESOLVED → CLOSED
```

| Состояние | Описание | Терминальное |
|-----------|----------|:------------:|
| `OPEN` | Спор создан | Нет |
| `RESOLVED` | Решение принято (REFUND/NO_REFUND/PARTIAL/BAN_USER) | Нет |
| `CLOSED` | Спор закрыт | Да |

### Notification (уведомление)

```
  PENDING → SENT
     │
     └─ retry (до 5 раз) → FAILED_FINAL
```

| Состояние | Описание | Терминальное |
|-----------|----------|:------------:|
| `PENDING` | В очереди на отправку | Нет |
| `SENT` | Успешно отправлено | Да |
| `FAILED_FINAL` | Все попытки исчерпаны | Да |

### Receipt (чек)

```
  PENDING → ISSUED
     │
     └─ retry (до 3 раз) → FAILED_FINAL
```

---

## Межсервисное взаимодействие

### Диаграмма событий

```
trips-service ──booking.created──────────▶ payments-service
trips-service ──booking.confirmed────────▶ payments-service
trips-service ──booking.cancelled────────▶ payments-service + notifications-service
trips-service ──booking.expired──────────▶ payments-service + notifications-service
trips-service ──trip.cancelled───────────▶ payments-service
trips-service ──trip.completed───────────▶ profiles-service

payments-service ──payment.intent.hold_placed──▶ trips-service
payments-service ──payment.intent.failed───────▶ trips-service
payments-service ──payment.captured────────────▶ notifications-service
payments-service ──payment.cancelled───────────▶ notifications-service
payments-service ──payment.refunded────────────▶ notifications-service

admin-service ──dispute.resolved───────────────▶ payments-service

admin-service ──AdminCommand (BAN/UNBAN)───────▶ identity-service (polling)
admin-service ──AdminCommand (CANCEL_TRIP)─────▶ trips-service (polling)
```

### Протокол

- **Outbox + HTTP POST** — события пишутся в outbox-таблицу в рамках той же транзакции, worker доставляет по HTTP с HMAC-подписью
- **AdminCommand + Polling** — admin-service создаёт команды, целевые сервисы периодически опрашивают `GET /internal/commands?service=<name>` и подтверждают `POST /internal/commands/:id/ack`

---

## Ключевые архитектурные паттерны

| Паттерн | Реализация |
|---------|------------|
| **Database per service** | Каждый сервис — отдельная PostgreSQL БД |
| **Transactional Outbox** | События в `outbox_events` в той же TX; worker доставляет с HMAC, retry + backoff |
| **SKIP LOCKED** | Workers безопасны для multi-instance: `FOR UPDATE SKIP LOCKED` |
| **Booking Saga** | book → hold → capture/fail → confirm/cancel с компенсациями |
| **Idempotent Events** | `consumed_events` — дедупликация по `eventId` (проверка вне и внутри TX) |
| **Idempotency Keys** | `IdempotencyRecord` (bookings) — предотвращение дублирования |
| **Money as Integers** | `priceKgs: Int`, `amountKgs: Int` — нет floating-point |
| **Rate Limiting** | Sliding window на Redis + Lua, per-upstream политики |
| **HMAC Inter-service** | SHA-256 подпись `timestamp.body`, replay window 300 сек |
| **Circuit Breaker** | Per-upstream в gateway, per-host в outbox workers и PSP |
| **Config as Code** | JSON-конфиги в admin-service, ETag-кэширование в клиентах |
