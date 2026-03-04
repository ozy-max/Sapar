# Sapar — Технологический стек и архитектура

---

## Содержание

1. [Языки и рантайм](#языки-и-рантайм)
2. [Фреймворки и библиотеки](#фреймворки-и-библиотеки)
3. [Базы данных и кэширование](#базы-данных-и-кэширование)
4. [Межсервисное взаимодействие](#межсервисное-взаимодействие)
5. [Observability](#observability)
6. [CI/CD](#cicd)
7. [Контейнеризация](#контейнеризация)
8. [Сетевая архитектура](#сетевая-архитектура)
9. [Безопасность](#безопасность)
10. [Переменные окружения](#переменные-окружения)

---

## Языки и рантайм

| Компонент | Технология |
|-----------|------------|
| Язык | TypeScript 5, strict mode |
| Рантайм | Node.js 20 LTS |
| Менеджер пакетов | npm (lockfile: `package-lock.json`) |

---

## Фреймворки и библиотеки

### Основные (все сервисы)

| Библиотека | Версия | Назначение |
|-----------|--------|------------|
| `@nestjs/common`, `core`, `platform-express` | ^10.4.0 | HTTP-фреймворк |
| `@nestjs/swagger` | ^7.4.0 | OpenAPI / Swagger UI |
| `@prisma/client` | ^5.19.0 | ORM (PostgreSQL) |
| `zod` | ^3.23.0 | Валидация (request body, env) |
| `jsonwebtoken` | — | Создание / верификация JWT |
| `nestjs-pino` + `pino-http` | ^4.1.0 / ^10.2.0 | Structured JSON logging |
| `prom-client` | ^15.1.0 | Prometheus-метрики |
| `reflect-metadata` | ^0.2.2 | Декораторы NestJS |
| `rxjs` | ^7.8.1 | Реактивные паттерны |

### Специфичные

| Библиотека | Сервис | Назначение |
|-----------|--------|------------|
| `ioredis` | api-gateway, trips-service | Redis-клиент (rate limiting, search cache) |
| `undici` | api-gateway | HTTP-клиент для proxy |
| `argon2` | identity-service | Хеширование паролей |

### Dev-зависимости

| Библиотека | Назначение |
|-----------|------------|
| `@nestjs/cli`, `@nestjs/testing` | CLI и тестовые утилиты |
| `jest`, `ts-jest` | Unit-тесты |
| `supertest` | E2E-тесты |
| `nock` | Мокирование HTTP-вызовов |
| `eslint` | Линтинг |
| `typescript` | Компиляция |
| `prisma` | CLI для миграций |

---

## Базы данных и кэширование

### PostgreSQL 16 (Alpine)

Каждый сервис — отдельная БД (database-per-service):

| Сервис | БД | Порт (Docker) |
|--------|----|:-------------:|
| api-gateway | `sapar_gateway` | 5432 |
| identity-service | `sapar_identity` | 5433 |
| trips-service | `sapar_trips` | 5435 |
| payments-service | `sapar_payments` | 5437 |
| notifications-service | `sapar_notifications` | 5439 |
| admin-service | `sapar_admin` | 5441 |
| profiles-service | `sapar_profiles` | 5443 |

ORM — **Prisma**. Миграции: `prisma migrate deploy`. Схемы: `services/<name>/prisma/schema.prisma`.

### Redis 7 (Alpine)

| Инстанс | Порт (Docker) | Назначение |
|---------|:-------------:|------------|
| redis (gateway) | 6379 | Rate limiting (sliding window Lua), circuit breaker state |
| trips-redis | 6380 | Кэш результатов поиска (TTL 15 сек) |

Redis — **опционален** (fail-open). При недоступности:
- Rate limiting: зависит от fail strategy (`open` — пропуск, `closed` — 503)
- Search cache: запрос идёт напрямую в БД

---

## Межсервисное взаимодействие

### Transactional Outbox

События записываются в таблицу `outbox_events` в рамках бизнес-транзакции. Outbox Worker:
- Опрашивает `PENDING` события (`FOR UPDATE SKIP LOCKED`)
- Доставляет по HTTP POST на адреса из `OUTBOX_TARGETS`
- HMAC-подпись каждого запроса
- Retry с экспоненциальным backoff: `5, 30, 120, 300, 900` сек (настраивается)
- Максимум попыток: 5 (настраивается)
- Circuit breaker per-host

### Admin Commands (polling)

Команды модерации доставляются через polling:
- `GET /internal/commands?service=<name>&limit=10`
- `POST /internal/commands/:id/ack`
- Интервал опроса: 5 сек (настраивается)

### Event Envelope

```json
{
  "eventId": "uuid",
  "eventType": "booking.created",
  "payload": { ... },
  "occurredAt": "ISO 8601",
  "producer": "trips-service",
  "traceId": "uuid",
  "version": 1
}
```

### HMAC-подпись

- Алгоритм: HMAC-SHA256
- Формат подписи: `HMAC(timestamp.body, EVENTS_HMAC_SECRET)`
- Заголовки: `x-event-signature`, `x-event-timestamp`
- Replay window: 300 секунд
- Timing-safe comparison

---

## Observability

### Логирование

- **Pino** (structured JSON logs)
- Уровни: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`
- Каждый запрос — `x-request-id` (генерируется, если не передан)
- Пробрасывается в ответ и downstream

### Метрики (Prometheus)

Каждый сервис экспортирует `GET /metrics`:

| Метрика | Тип | Описание |
|---------|-----|----------|
| `http_requests_total` | counter | Общее кол-во запросов |
| `http_server_errors_total` | counter | 5xx ошибки |
| `http_request_duration_ms` | histogram | Латентность HTTP |
| `db_errors_total` | counter | Ошибки БД |
| `db_query_duration_ms` | histogram | Латентность запросов к БД |
| `db_connection_errors_total` | counter | Ошибки подключения к БД |
| `redis_errors_total` | counter | Ошибки Redis |
| `redis_connection_errors_total` | counter | Ошибки подключения к Redis |
| `outbox_event_total` | counter | Outbox события по статусу |
| `outbox_delivery_errors_total` | counter | Ошибки доставки outbox |
| `circuit_breaker_state` | gauge | Состояние circuit breaker |
| `circuit_breaker_open_total` | counter | Кол-во открытий CB |
| `receipt_status_total` | counter | Чеки по статусу (payments) |
| `external_call_errors_total` | counter | Ошибки внешних вызовов (PSP) |
| `notification_outcome_total` | counter | Результаты уведомлений |

### Prometheus

- Версия: `prom/prometheus:v2.51.0`
- Порт: `127.0.0.1:9090`
- Scrape interval: 15 сек
- Retention: 7 дней
- Targets: все 7 сервисов по `<service>:<port>/metrics`

### Grafana

- Версия: `grafana/grafana:10.4.0`
- Порт: `127.0.0.1:3100`
- Datasource: Prometheus (auto-provisioned)
- Дашборды (auto-provisioned):
  - `sapar-overview.json` — общий обзор платформы
  - `gateway.json` — API Gateway
  - `payments.json` — платёжный сервис
  - `notifications.json` — уведомления

### Алерты (Prometheus Alert Rules)

| Алерт | Порог | Severity |
|-------|-------|----------|
| GatewayHigh5xxRate | >1% 5xx за 5 мин | critical |
| ServiceHigh5xxRate | >5% 5xx за 5 мин | warning |
| GatewayP95LatencyHigh | >1000ms p95 | warning |
| ServiceP95LatencyHigh | >2000ms p95 | warning |
| CircuitBreakerOpenTooLong | >5 мин | critical |
| OutboxFailedFinalIncreasing | >5 за 15 мин | critical |
| OutboxDeliveryErrorsHigh | >0.5/сек за 5 мин | warning |
| OutboxBacklogGrowing | pending > delivered за 10 мин | warning |
| DatabaseErrorsIncreasing | >10 за 10 мин | critical |
| DatabaseQueryLatencyHigh | >500ms p95 | warning |
| DatabaseConnectionErrorsSpike | >5 за 5 мин | critical |
| RedisErrorsHigh | >10 за 5 мин | critical |
| RedisConnectionErrorsSpike | >5 за 5 мин | critical |
| ReceiptFailedFinalSpike | >3 за 15 мин | critical |
| PSPCallErrorsHigh | >0.1/сек за 5 мин | critical |
| NotificationFailedFinalSpike | >5 за 15 мин | warning |

---

## CI/CD

### GitHub Actions

| Workflow | Файл | Триггер |
|----------|-------|---------|
| Build and Push | `.github/workflows/build-and-push.yml` | push в `dev` / `main` |
| Deploy to PROD | `.github/workflows/deploy-prod.yml` | `workflow_dispatch` (ручной) |

#### Job: Build (матрица 7 сервисов)

Для каждого сервиса: checkout → Buildx → login GHCR → build + push.

Теги: `dev` + `sha-<short>` (ветка `dev`), `prod` + `sha-<short>` (ветка `main`). Тег `latest` не используется.

Образы: `ghcr.io/ozy-max/sapar-<service>:<tag>`. Кеширование: GHA layer cache с per-service scope.

#### Job: Deploy Stage (только `dev`)

После успешной сборки — авто-деплой на STAGE-сервер через SSH (`appleboy/ssh-action`).

#### Workflow: Deploy PROD (ручной)

`workflow_dispatch` с input `image_tag` (default: `prod`). Деплой на PROD-сервер через SSH.

---

## Контейнеризация

### docker-compose.yml

Один файл поднимает весь стек:
- 7 PostgreSQL инстансов
- 2 Redis инстанса
- 7 сервисов (build from Dockerfile)

Все сервисы имеют healthcheck (`/health` endpoint).

### docker-compose.observability.yml

Отдельный compose-файл для Prometheus + Grafana. Работает в той же Docker-сети.

### Dockerfile (единый шаблон для всех сервисов)

```
services/<name>/Dockerfile
```

---

## Сетевая архитектура

### Порты (хост → контейнер)

| Сервис | Порт |
|--------|------|
| api-gateway | 3000 |
| identity-service | 3001 |
| trips-service | 3002 |
| payments-service | 3003 |
| notifications-service | 3004 |
| admin-service | 3005 |
| profiles-service | 3006 |
| Prometheus | 9090 (127.0.0.1) |
| Grafana | 3100 (127.0.0.1) |

### Gateway Proxy Routing

| Prefix | Upstream | Timeout |
|--------|----------|---------|
| `/identity/*` | identity-service:3001 | 3000ms |
| `/trips/*` | trips-service:3002 | 3000ms |
| `/payments/*` | payments-service:3003 | 3000ms |
| `/admin/*` | admin-service:3005 | 3000ms |
| `/profiles/*` | profiles-service:3006 | 3000ms |
| `/v1/*` (BFF) | агрегация | 2500ms |

### Rate Limiting (per IP, sliding window)

| Prefix | RPM | Fail Strategy |
|--------|-----|--------------|
| identity | 60 | open |
| trips | 120 | open |
| payments | 30 | closed |
| admin | 60 | closed |
| profiles | 100 | open |
| v1 (BFF) | 100 | open |

Заголовки ответа: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` (при 429).

---

## Безопасность

| Механизм | Описание |
|----------|----------|
| JWT (HS256) | Access token: 15 мин, refresh token: 30 дней (rotation) |
| Argon2 | Хеширование паролей (memory: 65536, time: 3) |
| HMAC-SHA256 | Подпись межсервисных событий |
| CORS | Настраиваемые origins (`ALLOWED_ORIGINS`); `*` запрещён в production |
| Rate Limiting | Sliding window (Redis + Lua) |
| Replay Protection | Timestamp validation (300 сек) + `consumed_events` дедупликация |
| Webhook Signature | HMAC-SHA256 для PSP webhooks (`x-webhook-signature`, `x-webhook-timestamp`) |
| Trust Proxy | Отключён по умолчанию (`TRUST_PROXY=false`) |
| Body Limit | 1 MB (`MAX_BODY_BYTES`) |

---

## Переменные окружения

### Общие (все сервисы)

| Переменная | Тип | Default | Описание |
|------------|-----|---------|----------|
| `PORT` | number | (per service) | Порт HTTP-сервера |
| `DATABASE_URL` | string | — | PostgreSQL connection string |
| `NODE_ENV` | enum | development | `development` / `production` / `test` |
| `LOG_LEVEL` | enum | info | `fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent` |
| `JWT_ACCESS_SECRET` | string | — | Секрет JWT (≥32 символов) |
| `EVENTS_HMAC_SECRET` | string | — | Секрет HMAC (≥32 символов) |

### api-gateway

| Переменная | Default | Описание |
|------------|---------|----------|
| `IDENTITY_BASE_URL` | — | URL identity-service |
| `TRIPS_BASE_URL` | — | URL trips-service |
| `PAYMENTS_BASE_URL` | — | URL payments-service |
| `NOTIFICATIONS_BASE_URL` | — | URL notifications-service |
| `ADMIN_BASE_URL` | — | URL admin-service |
| `PROFILES_BASE_URL` | http://profiles-service:3006 | URL profiles-service |
| `HTTP_TIMEOUT_MS` | 3000 | Таймаут proxy |
| `BFF_TIMEOUT_MS` | 2500 | Таймаут BFF |
| `MAX_BODY_BYTES` | 1048576 | Лимит body (1MB) |
| `REDIS_URL` | — | Redis для rate limiting |
| `REDIS_TIMEOUT_MS` | 500 | Таймаут Redis |
| `TRUST_PROXY` | false | Trust X-Forwarded-For |
| `ALLOWED_ORIGINS` | * | CORS (через запятую) |
| `RATE_*_RPM` | (см. выше) | Лимиты per-upstream |
| `CB_*` | (см. ниже) | Настройки circuit breaker |

### identity-service

| Переменная | Default | Описание |
|------------|---------|----------|
| `JWT_ACCESS_TTL_SEC` | 900 | TTL access token |
| `REFRESH_TOKEN_TTL_SEC` | 2592000 | TTL refresh token (~30 дней) |
| `PASSWORD_HASH_MEMORY_COST` | 65536 | Argon2 memory |
| `PASSWORD_HASH_TIME_COST` | 3 | Argon2 iterations |
| `SEED_ADMIN_EMAIL` | — | Email seed-админа |
| `SEED_ADMIN_PASSWORD` | — | Пароль seed-админа |

### trips-service

| Переменная | Default | Описание |
|------------|---------|----------|
| `OUTBOX_TARGETS` | — | Маршруты событий (формат `type>url,...`) |
| `BOOKING_TTL_SEC` | 900 | TTL бронирования (15 мин) |
| `EXPIRATION_WORKER_INTERVAL_MS` | 1000 | Интервал expiration worker |
| `REDIS_URL` | — | Redis для search cache |
| `SEARCH_CACHE_TTL_SEC` | 15 | TTL кэша поиска |
| `SEARCH_DEFAULT_RADIUS_KM` | 25 | Радиус поиска по умолчанию |

### payments-service

| Переменная | Default | Описание |
|------------|---------|----------|
| `PSP_TIMEOUT_MS` | 5000 | Таймаут вызовов PSP |
| `PAYMENTS_WEBHOOK_SECRET` | — | Секрет для проверки webhook PSP |
| `RECEIPT_RETRY_N` | 3 | Макс. попыток выдачи чека |
| `RECEIPT_BACKOFF_SEC_LIST` | 5,30,300 | Backoff для retry чеков |
| `RECEIPT_POLL_INTERVAL_MS` | 5000 | Интервал receipt worker |

### notifications-service

| Переменная | Default | Описание |
|------------|---------|----------|
| `NOTIF_RETRY_N` | 5 | Макс. попыток отправки |
| `NOTIF_BACKOFF_SEC_LIST` | 5,30,120,300,900 | Backoff для retry |
| `WORKER_INTERVAL_MS` | 1000 | Интервал notification worker |
| `PROVIDER_TIMEOUT_MS` | 3000 | Таймаут вызова провайдера |

### admin-service

| Переменная | Default | Описание |
|------------|---------|----------|
| `SLA_RESOLVE_HOURS` | 12 | SLA разрешения споров (часы) |
| `COMMAND_MAX_RETRIES` | — | Макс. попыток доставки команды |

### profiles-service

| Переменная | Default | Описание |
|------------|---------|----------|
| `RATING_WINDOW_DAYS` | 14 | Окно для оценки после завершения поездки |
