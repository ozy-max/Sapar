# Sapar Trips Service

Микросервис управления жизненным циклом поездок (создание, поиск, бронирование, отмена).

## Архитектурные решения

### JWT-аутентификация: HS256 с общим секретом (MVP)
Выбран **HS256** через переменную `JWT_ACCESS_SECRET`, идентичную identity-service. Это MVP-решение: один и тот же секрет используется для подписи (identity) и верификации (trips). Для продакшена рекомендуется миграция на RS256 с парой ключей, чтобы trips-service имел только публичный ключ.

**Критически важно:** значение `JWT_ACCESS_SECRET` в trips-service **должно совпадать** с identity-service.

### Конкурентность бронирования: SELECT ... FOR UPDATE
Выбран подход **A — Pessimistic locking через `SELECT ... FOR UPDATE`** внутри Prisma interactive transaction с уровнем изоляции `ReadCommitted`.

Логика:
1. Блокируется строка `trips` по `id` (`SELECT id FROM trips WHERE id = $1 FOR UPDATE`)
2. Все конкурентные бронирования на **одну и ту же** поездку сериализуются на уровне строки
3. Проверяется `status = ACTIVE`, `seatsAvailable >= seats`, отсутствие дубля (tripId, passengerId)
4. Создаётся бронирование, декрементируется `seatsAvailable`
5. Таймаут транзакции 10 секунд — предотвращение зависших блокировок

Это **гарантирует**: при двух одновременных бронированиях последнего места ровно одна из них получит 201, вторая — 409 `NOT_ENOUGH_SEATS`. Подход масштабируется, т.к. блокировка per-trip, а не table-wide.

### Идемпотентность (POST /:tripId/book)
Поддержан заголовок `Idempotency-Key`. При наличии:
1. Предварительная проверка таблицы `idempotency_records` (key + userId)
2. Если запись найдена — возвращается сохранённый ответ без повторного выполнения
3. Если нет — бронирование выполняется в транзакции, записывается idempotency record

TTL/очистка: метод `IdempotencyRepository.deleteOlderThan(cutoff)` для cron-job (например, удалять записи старше 24 часов).

## Файловое дерево

```
services/trips-service/
├── .env.example
├── .eslintrc.js
├── .gitignore
├── .prettierrc
├── Dockerfile
├── README.md
├── docker-compose.yml          # Postgres dev + test
├── jest-e2e.config.ts
├── nest-cli.json
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│       ├── 20240901100000_init/
│       │   └── migration.sql
│       └── migration_lock.toml
├── src/
│   ├── main.ts                 # Bootstrap + Swagger + Pino
│   ├── app.module.ts           # Root module
│   ├── config/
│   │   └── env.ts              # Zod env validation
│   ├── domain/
│   │   ├── trip.entity.ts
│   │   └── booking.entity.ts
│   ├── shared/
│   │   ├── shared.module.ts    # @Global JwtTokenService
│   │   ├── errors.ts           # AppError + domain errors
│   │   └── jwt.service.ts      # HS256 verify-only
│   ├── adapters/
│   │   ├── db/
│   │   │   ├── database.module.ts
│   │   │   ├── prisma.service.ts
│   │   │   ├── trip.repository.ts
│   │   │   ├── booking.repository.ts
│   │   │   └── idempotency.repository.ts
│   │   └── http/
│   │       ├── trips.module.ts
│   │       ├── controllers/
│   │       │   ├── health.controller.ts
│   │       │   ├── trips.controller.ts
│   │       │   └── bookings.controller.ts
│   │       ├── dto/
│   │       │   ├── error.dto.ts
│   │       │   ├── create-trip.dto.ts
│   │       │   ├── search-trips.dto.ts
│   │       │   └── book-seat.dto.ts
│   │       ├── filters/
│   │       │   └── all-exceptions.filter.ts
│   │       ├── guards/
│   │       │   └── jwt-auth.guard.ts
│   │       ├── decorators/
│   │       │   └── current-user.decorator.ts
│   │       ├── middleware/
│   │       │   └── request-id.middleware.ts
│   │       └── pipes/
│   │           └── zod-validation.pipe.ts
│   └── application/
│       ├── create-trip.usecase.ts
│       ├── search-trips.usecase.ts
│       ├── book-seat.usecase.ts
│       ├── cancel-booking.usecase.ts
│       └── cancel-trip.usecase.ts
└── test/
    └── e2e/
        ├── trips.e2e-spec.ts
        └── helpers/
            ├── db-cleanup.ts
            ├── env-setup.ts
            └── test-app.ts
```

## Запуск

### 1. Поднять базу (dev)

```bash
cd services/trips-service
docker compose up -d trips-postgres
```

### 2. Установить зависимости + миграции

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
```

### 3. Запустить сервис

```bash
cp .env.example .env
# Отредактировать .env — убедиться что JWT_ACCESS_SECRET совпадает с identity-service
npm run start:dev
```

Swagger доступен по `http://localhost:3002/swagger`.

### 4. Запуск E2E тестов

```bash
docker compose up -d trips-postgres-test
DATABASE_URL=postgresql://sapar:sapar_secret@localhost:5436/sapar_trips_test npx prisma migrate deploy
npm run test:e2e
```

### 5. Через корневой docker-compose (все сервисы)

```bash
# Из корня проекта
docker compose up --build
```

## Интеграция с API Gateway

API Gateway уже настроен на проксирование:
```
/trips/* → TRIPS_BASE_URL (http://trips-service:3002)
```

Переменная `TRIPS_BASE_URL` в api-gateway `.env`:
```
TRIPS_BASE_URL=http://localhost:3002   # локальная разработка
TRIPS_BASE_URL=http://trips-service:3002  # docker-compose
```

Gateway strip'ит `/trips` и форвардит downstream path + заголовки (`Authorization`, `x-request-id`, `content-type`).

## curl-примеры

Предполагается gateway на `localhost:3000` и валидный JWT-токен.

### Получить JWT (через identity-service)

```bash
# Регистрация
curl -s -X POST http://localhost:3000/identity/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"driver@test.com","password":"StrongPass123!"}'

# Логин → получить accessToken
TOKEN=$(curl -s -X POST http://localhost:3000/identity/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"driver@test.com","password":"StrongPass123!"}' | jq -r '.accessToken')
```

### Создать поездку (водитель)

```bash
curl -s -X POST http://localhost:3000/trips/ \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "fromCity": "Алматы",
    "toCity": "Астана",
    "departAt": "2025-06-15T08:00:00.000Z",
    "seatsTotal": 4,
    "priceKgs": 5000
  }' | jq .
```

### Поиск поездок (пассажир)

```bash
curl -s 'http://localhost:3000/trips/search?fromCity=%D0%90%D0%BB%D0%BC%D0%B0%D1%82%D1%8B&toCity=%D0%90%D1%81%D1%82%D0%B0%D0%BD%D0%B0' | jq .
```

### Забронировать место

```bash
TRIP_ID="<trip-id-from-search>"

curl -s -X POST "http://localhost:3000/trips/$TRIP_ID/book" \
  -H "Authorization: Bearer $PASSENGER_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: unique-key-123' \
  -d '{"seats": 1}' | jq .
```

### Отменить бронирование

```bash
BOOKING_ID="<booking-id-from-book>"

curl -s -X POST "http://localhost:3000/trips/bookings/$BOOKING_ID/cancel" \
  -H "Authorization: Bearer $PASSENGER_TOKEN" | jq .
```

### Отменить поездку (водитель)

```bash
curl -s -X POST "http://localhost:3000/trips/$TRIP_ID/cancel" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

## Коды ошибок

| Код | HTTP | Описание |
|---|---|---|
| VALIDATION_ERROR | 400 | Невалидные входные данные |
| UNAUTHORIZED | 401 | Отсутствует/невалидный JWT |
| FORBIDDEN | 403 | Нет прав на операцию |
| TRIP_NOT_FOUND | 404 | Поездка не найдена |
| BOOKING_NOT_FOUND | 404 | Бронирование не найдено |
| TRIP_NOT_ACTIVE | 409 | Поездка не в статусе ACTIVE |
| NOT_ENOUGH_SEATS | 409 | Недостаточно свободных мест |
| BOOKING_EXISTS | 409 | Активное бронирование уже есть |
| BOOKING_NOT_ACTIVE | 409 | Бронирование уже отменено |
| SERVICE_UNAVAILABLE | 503 | БД недоступна (readiness) |

## Подготовка к интеграции с payments

Текущий дизайн готов к интеграции:
- `BookingStatus` может быть расширен: `PENDING_PAYMENT`, `PAID`, `REFUNDED`
- `TripStatus` может быть расширен: `COMPLETED`
- Добавление EventEmitter/Kafka producer для событий `booking.created`, `booking.cancelled`, `trip.cancelled` — минимальные изменения в use-cases
- Поле `priceKgs` уже хранится в поездке для расчёта стоимости бронирования
