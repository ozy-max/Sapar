# Sapar — Backend Microservices

Бэкенд для платформы совместных поездок (аналог BlaBlaCar) для Кыргызстана.
Валюта: **KGS** · Локали: `ru-KG`, `ky-KG`

---

## Стек

| Компонент | Технология |
|-----------|-----------|
| Язык | TypeScript 5, strict mode |
| Рантайм | Node.js 20 LTS |
| Фреймворк | NestJS v10 |
| ORM | Prisma |
| БД | PostgreSQL 16, по одной на сервис |
| Кэш / Rate Limit | Redis 7 |
| Валидация | Zod |
| Observability | Prometheus + Grafana, pino (structured logging) |
| CI | GitHub Actions (path-aware matrix) |

---

## Архитектура

Монорепо с 6 микросервисами, каждый с собственной БД (database-per-service).
Межсервисное взаимодействие: HTTP + Transactional Outbox + HMAC-подпись.

| Сервис | Порт | Назначение |
|--------|------|-----------|
| `api-gateway` | 3000 | Proxy, rate limiting (Redis + Lua), BFF /v1 endpoints |
| `identity-service` | 3001 | Регистрация, логин, JWT, refresh tokens, RBAC |
| `trips-service` | 3002 | Поездки, бронирования, booking saga |
| `payments-service` | 3003 | PSP-адаптер, payment intents, webhooks, receipts |
| `notifications-service` | 3004 | Уведомления (PUSH, EMAIL, SMS), worker |
| `admin-service` | 3005 | RBAC, configs, disputes, moderation, audit log |

```
Mobile / Web
     │
     ▼
┌─────────────┐
│ api-gateway │──proxy──▶ identity / trips / payments / notifications / admin
│  (BFF /v1)  │
└─────────────┘
     │
  ┌──┴──────────────────────────┐
  │ PostgreSQL (×6)  ·  Redis   │
  └─────────────────────────────┘
```

---

## Структура

```
Sapar/
├── services/
│   ├── api-gateway/          # proxy, rate-limit, BFF
│   ├── identity-service/     # auth, JWT, RBAC
│   ├── trips-service/        # trips, bookings, saga
│   ├── payments-service/     # PSP, intents, receipts
│   ├── notifications-service/# push, email, sms
│   ├── admin-service/        # configs, disputes, moderation
│   └── profiles-service/     # user profiles
├── observability/
│   ├── grafana/              # dashboards, provisioning
│   └── prometheus/           # prometheus.yml
├── scripts/                  # CI helpers
├── docs/                     # SRS, API conventions, configs
├── docker-compose.yml        # full stack
├── docker-compose.observability.yml
└── .github/workflows/
    ├── build-and-push.yml    # build + push images + stage deploy
    └── deploy-prod.yml       # manual prod deploy
```

Каждый сервис имеет единую структуру:
```
services/<name>/
├── src/
│   ├── adapters/db/          # Prisma repositories
│   ├── adapters/http/        # controllers, guards, DTOs
│   ├── application/          # use cases, handlers
│   ├── shared/               # HMAC, JWT, outbox, config-client
│   ├── workers/              # background workers
│   ├── observability/        # Prometheus metrics
│   ├── config/env.ts         # Zod env validation
│   └── main.ts
├── test/e2e/                 # e2e tests
├── prisma/schema.prisma
├── Dockerfile
├── package.json
└── .env.example
```

---

## Быстрый старт

### Требования

- Node.js 20 LTS
- Docker & Docker Compose

### Подготовка переменных окружения

Скопируйте файл-пример и заполните своими значениями:

```bash
cp .env.docker.example .env.docker
# Отредактируйте .env.docker, заменив placeholder'ы на реальные секреты
```

### Запуск всего стека

```bash
# Поднять инфраструктуру (Postgres ×6, Redis) + все сервисы
docker-compose --env-file .env.docker up -d

# Проверить здоровье
curl http://localhost:3000/health   # api-gateway
curl http://localhost:3001/health   # identity-service
curl http://localhost:3002/health   # trips-service
curl http://localhost:3003/health   # payments-service
curl http://localhost:3004/health   # notifications-service
curl http://localhost:3005/health   # admin-service
```

### Запуск одного сервиса локально (для разработки)

```bash
cd services/identity-service

# Скопировать и настроить переменные окружения
cp .env.example .env

# Установить зависимости
npm install

# Сгенерировать Prisma client
npx prisma generate

# Применить миграции
npx prisma migrate deploy

# Запустить в dev-режиме
npm run start:dev
```

### Observability

```bash
docker-compose -f docker-compose.observability.yml up -d

# Grafana:     http://localhost:3100
# Prometheus:  http://localhost:9090
```

> **Примечание:** `docker-compose.yml` и `docker-compose.observability.yml` должны запускаться из одной директории, чтобы использовать общую Docker-сеть (`default`). Если стек приложений уже запущен, observability-контейнеры автоматически подключатся к той же сети.

---

## CI/CD

GitHub Actions, path-aware: изменения запускают тесты только для затронутых сервисов.

Pipeline per service:
1. `prisma validate` → `prisma generate`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test` (unit)
5. `npm run test:e2e` (с Postgres + Redis в CI)
6. `docker build` + smoke-test `/health`

> **Push образов в реестр:** для этапа push в CI необходимо настроить GitHub Secrets:
> - `REGISTRY_URL` — адрес container registry (например, `ghcr.io/your-org`)
> - `REGISTRY_USERNAME` — логин для реестра
> - `REGISTRY_PASSWORD` — пароль / токен для реестра

---

## Ключевые паттерны

| Паттерн | Реализация |
|---------|-----------|
| Transactional Outbox | События пишутся в outbox-таблицу в той же TX; worker доставляет с HMAC |
| SKIP LOCKED | Workers безопасны для multi-instance: `FOR UPDATE SKIP LOCKED` |
| Booking Saga | book → hold → capture/fail → confirm/cancel с компенсациями |
| Idempotent Events | `consumed_events` с double-check (вне и внутри TX) |
| Money as Integers | `priceKgs: Int`, `amountKgs: Int` — нет floating-point |
| Rate Limiting | Sliding window counter на Lua, per-upstream policies |
| HMAC Inter-service | SHA-256 подпись с timestamp, 300s replay window |

---

## Документация

| Файл | Описание |
|------|----------|
| [`docs/microservices-guide.md`](docs/microservices-guide.md) | Принципы разработки сервисов |
| [`docs/api-openapi-schema.md`](docs/api-openapi-schema.md) | OpenAPI 3.0 схема |
| [`docs/api-conventions.md`](docs/api-conventions.md) | Соглашения API: headers, ошибки, idempotency |
| [`docs/json-configs.md`](docs/json-configs.md) | JSON-конфиги политик |
| [`docs/srs-prd.md`](docs/srs-prd.md) | ТЗ / SRS |
