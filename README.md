# Sapar — Backend Service

Бэкенд-сервис для платформы совместных поездок (аналог BlaBlaCar) для Кыргызстана.  
Гибридная модель: **CARPOOL** (офлайн-оплата) + **COMMERCIAL** (in-app оплата).  
Валюта: **KGS** · Локали: `ru-KG`, `ky-KG`

---

## Содержание

- [Обзор](#обзор)
- [Стек](#стек)
- [Архитектура](#архитектура)
- [Bounded Contexts (модули)](#bounded-contexts-модули)
- [Структура монорепо](#структура-монорепо)
- [API](#api)
- [База данных](#база-данных)
- [События и Outbox](#события-и-outbox)
- [Фоновые процессы](#фоновые-процессы)
- [Конфиги и политики](#конфиги-и-политики)
- [Запуск](#запуск)
- [Документация](#документация)

---

## Обзор

Sapar — монорепо, содержащее бэкенд (TypeScript/NestJS) и мобильное приложение (Flutter/Dart).

Стартовая модель — **Modular Monolith** с чёткими доменными границами.  
При росте нагрузки — вынос горячих модулей (matching, chat, search) в отдельные **Go**-сервисы без переписывания доменной логики.

| Тип водителя | Оплата | Booking Mode |
|---|---|---|
| `CARPOOL` | Наличные / офлайн | `INSTANT` или `REQUEST` |
| `COMMERCIAL` | In-app (PSP) | `INSTANT` |

---

## Стек

### Язык, рантайм, фреймворк

| Инструмент | Версия | Назначение |
|---|---|---|
| **TypeScript** | 5.4+ | Основной язык (strict mode) |
| **Node.js** | 20 LTS | Рантайм |
| **NestJS** | v10+ | Фреймворк: REST controllers, DI, modules, guards, interceptors |
| **Go** | 1.22+ | Hot-path по росту: matching, realtime-chat, high-QPS search |

### Хранилища

| Инструмент | Версия | Назначение |
|---|---|---|
| **PostgreSQL** | 16 + PostGIS | Основная БД: поездки, брони, платежи, гео-поиск по маршруту |
| **Redis** | 7+ | Rate-limit, session/device, кэш, distributed locks, cooldown, idempotency keys |
| **S3-compatible** (MinIO в dev) | — | Документы/KYC, фискальные чеки, вложения саппорта |

### Сообщения и события

| Инструмент | Этап | Назначение |
|---|---|---|
| **Transactional Outbox** + cron publisher | MVP | Гарантированная доставка событий без брокера |
| **Kafka** или **NATS JetStream** | После MVP | Event streaming, fan-out событий между сервисами |

> Паттерны: **Transactional Outbox + Inbox**, idempotency для платежей/чеков/броней.

### ORM и миграции

| Инструмент | Назначение |
|---|---|
| **Prisma** | Type-safe ORM, автогенерация клиента, миграции |
| *(альтернатива)* **TypeORM** | Если нужен сложный DDD-mapping (агрегаты, value objects) |
| **Prisma Migrate** | Миграции + seed для dev/staging |

### Валидация и контракты

| Инструмент | Назначение |
|---|---|
| **Zod** | Runtime validation + генерация TypeScript-типов |
| **NestJS DTOs** + **class-validator** | Валидация на уровне контроллеров |
| **@nestjs/swagger** | OpenAPI 3.0 авто-генерация из декораторов |
| **openapi-generator** | Генерация клиентов для Flutter (Dart) и admin-панели |

### Платежи и финансы

| Инструмент | Назначение |
|---|---|
| **PSP-адаптеры** (Mbank / O!Pay / Optima Pay) | In-app платежи для COMMERCIAL |
| **Double-entry Ledger** (Postgres) | Финансовый учёт: зачисление, списание, refund |
| **ЭККМ** | Фискальные чеки (Кыргызстан), retry: 3 попытки, backoff 5s/30s/5m |
| **Penalty Ledger** | Офлайн штрафы для CARPOOL (OPEN → PAID/WAIVED) |

### WebSocket

| Инструмент | Назначение |
|---|---|
| **NestJS Gateway** (socket.io) | Чат, live-статусы брони/поездки на MVP |
| *(далее)* Go-сервис | Вынос realtime при росте нагрузки |

### Тесты

| Инструмент | Назначение |
|---|---|
| **Jest** | Unit-тесты (domain logic, use-cases, policies) |
| **testcontainers** | Integration-тесты с реальным PostgreSQL/Redis |
| **Pact** | Contract tests: BFF ↔ сервисы ↔ PSP |
| **k6** | Load testing |

### Качество кода

| Инструмент | Назначение |
|---|---|
| **ESLint** + **Prettier** | Линтинг и форматирование |
| **Husky** + **lint-staged** | Pre-commit: lint + typecheck + тесты |

### CI/CD

| Инструмент | Назначение |
|---|---|
| **GitHub Actions** | Pipeline: lint → typecheck → test → build → docker push → deploy |
| **Docker** (multi-stage build) | Образы для каждого сервиса |
| **Kubernetes** + **Helm** | Prod-оркестрация |
| **Terraform** | Инфраструктура как код |
| **Vault / KMS** | Secrets management |

### Observability

| Инструмент | Назначение |
|---|---|
| **OpenTelemetry** | Distributed tracing (correlation_id сквозь все слои) |
| **Prometheus** + **Grafana** | Метрики сервиса |
| **Loki** (или ELK) | Централизованные логи |
| **Sentry** | Error tracking |

---

## Архитектура

### Стиль: DDD + Hexagonal (Ports & Adapters)

```
┌─────────────────────────────────────────────────────────┐
│                Mobile App (Flutter/Dart)                 │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTPS / REST + WebSocket
┌──────────────────────────▼──────────────────────────────┐
│               API Gateway / Nginx / Kong                 │
│       (TLS termination, rate limiting, auth proxy)       │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│            Sapar API (TypeScript · NestJS)               │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              API Layer                          │    │
│  │  Controllers · DTOs · Guards · Interceptors     │    │
│  └───────────────────────┬─────────────────────────┘    │
│  ┌───────────────────────▼─────────────────────────┐    │
│  │           Application Layer                     │    │
│  │  Use-Cases · Orchestration · Transactions       │    │
│  └───────────────────────┬─────────────────────────┘    │
│  ┌───────────────────────▼─────────────────────────┐    │
│  │             Domain Layer                        │    │
│  │  Entities · Value Objects · Policies            │    │
│  │  CancellationPolicy · CooldownPolicy            │    │
│  │  FeeCalculator · RiskEngine · LiquidityPolicy   │    │
│  └───────────────────────┬─────────────────────────┘    │
│  ┌───────────────────────▼─────────────────────────┐    │
│  │          Infrastructure Layer                   │    │
│  │  Prisma (DB) · Redis · S3 · PSP · SMS · Push    │    │
│  │  Outbox Publisher · KYC Provider · ЭККМ         │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │           Background Workers (cron)             │    │
│  │  receipt-retry · noshow-sla · outbox-publisher  │    │
│  └─────────────────────────────────────────────────┘    │
└────┬──────────┬───────────┬──────────┬──────────┬───────┘
     │          │           │          │          │
┌────▼───┐ ┌───▼──┐ ┌──────▼───┐ ┌────▼───┐ ┌───▼──────┐
│Postgres│ │Redis │ │   S3 /   │ │ Kafka  │ │ External │
│16+Post │ │  7   │ │  MinIO   │ │  NATS  │ │PSP · KYC │
│  GIS   │ │      │ │          │ │(после  │ │2GIS·ЭККМ │
│        │ │      │ │          │ │  MVP)  │ │          │
└────────┘ └──────┘ └──────────┘ └────────┘ └──────────┘

          ← Go-сервисы (при росте) →
          matching-service · chat-service · search-service
```

### Ключевые технические решения

| Решение | Реализация |
|---------|-----------|
| **Distributed lock на места** | Redis SETNX + TTL + Postgres `UPDATE ... WHERE seats_available >= $seats` |
| **Idempotency** | Redis-хранение по `Idempotency-Key` (TTL 24h) для: createBooking, pay, cancel, refund |
| **Transactional Outbox** | События пишутся в `outbox` таблицу внутри той же транзакции; cron-publisher читает и отправляет |
| **Policy Engine** | Domain-слой: `CancellationPolicy`, `FeeCalculator` (`max(min_fee, percent × fare)`), `CooldownPolicy` |
| **Config-driven** | Все константы — remote config в БД + аудит изменений; без хардкода |
| **Correlation ID** | NestJS middleware → AsyncLocalStorage → Prisma logs → Outbox → Sentry |
| **PostGIS** | Гео-поиск поездок по маршруту (from/to coordinates), proximity search |

---

## Bounded Contexts (модули)

| # | Модуль | Ответственность |
|---|--------|----------------|
| 1 | **Identity / Auth** | OTP send/verify, JWT (access + refresh), сессии, RBAC |
| 2 | **Profiles** | Профиль пользователя/водителя, рейтинг |
| 3 | **Vehicles** | Автомобили водителя, тип, характеристики |
| 4 | **Trips** | Создание и управление предложениями поездок |
| 5 | **Search / Matching** | Гео-поиск (PostGIS), фильтры, cursor-пагинация |
| 6 | **Booking / Orders** | Резервирование мест, статусы, distributed lock |
| 7 | **Payments / Wallet / Payouts** | Ledger (двойная запись), PSP-адаптеры, refunds, receipts, payouts |
| 8 | **Cancellation & Policies** | CARPOOL/COMMERCIAL tiers, free-period, cooldown, penalty ledger |
| 9 | **Support / Disputes / No-show** | Тикеты, офлайн-диспуты, SLA 12h, авто-резолюция |
| 10 | **Notifications** | Push / SMS / Email (триггеры от событий) |
| 11 | **Config / Feature Flags** | Remote configs: `KGS_PAX_CARPOOL_CANCEL_FEE`, `COMM_PAX_FREE_MINUTES` и др. |
| 12 | **Analytics Events** | Event log → ClickHouse (после MVP) |

---

## Структура монорепо

```
sapar/
├── apps/
│   ├── api/                          ← NestJS backend
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/             # OTP, JWT, sessions
│   │   │   │   ├── profiles/
│   │   │   │   ├── vehicles/
│   │   │   │   ├── trips/
│   │   │   │   ├── search/           # PostGIS queries
│   │   │   │   ├── bookings/
│   │   │   │   ├── payments/         # PSP adapters, ledger, receipts
│   │   │   │   ├── cancellation/     # Policies, fee calculator, tiers
│   │   │   │   ├── support/          # Tickets, disputes, no-show SLA
│   │   │   │   ├── notifications/
│   │   │   │   ├── config/           # Remote config + feature flags
│   │   │   │   ├── analytics/        # Event log
│   │   │   │   └── risk/             # Rule engine, scorer
│   │   │   ├── domain/
│   │   │   │   ├── policies/
│   │   │   │   │   ├── cancellation.policy.ts
│   │   │   │   │   ├── fee-calculator.ts
│   │   │   │   │   ├── cooldown.policy.ts
│   │   │   │   │   └── liquidity.policy.ts
│   │   │   │   └── entities/
│   │   │   ├── workers/
│   │   │   │   ├── receipt-retry.worker.ts
│   │   │   │   ├── noshow-sla.worker.ts
│   │   │   │   └── outbox-publisher.worker.ts
│   │   │   ├── infrastructure/
│   │   │   │   ├── prisma/           # PrismaService, schema.prisma
│   │   │   │   ├── redis/
│   │   │   │   ├── s3/
│   │   │   │   └── outbox/
│   │   │   └── main.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── mobile/                       ← Flutter / Dart
│       ├── lib/
│       └── pubspec.yaml
│
├── packages/
│   └── shared/                       ← Общие Zod-схемы и TypeScript-типы
│       ├── src/
│       │   ├── schemas/              # Zod (используется в API + генерация Dart-клиента)
│       │   └── types/
│       └── package.json
│
├── docs/
│   ├── api-openapi-schema.md
│   ├── srs-prd.md
│   ├── json-configs.md
│   └── api-conventions.md
│
├── docker-compose.yml
├── package.json                      ← workspaces root
└── README.md
```

---

## API

REST API, OpenAPI 3.0.3. Схемы генерируются из NestJS-декораторов через `@nestjs/swagger`.  
Dart-клиент для Flutter генерируется через `openapi-generator`.

Подробная документация: [`docs/api-openapi-schema.md`](docs/api-openapi-schema.md).

| Группа | Endpoints |
|--------|-----------|
| Auth | `POST /v1/auth/otp/send` · `POST /v1/auth/otp/verify` |
| Rides | `GET /v1/rides/search` · `GET /v1/rides/:id` · `POST /v1/rides` |
| Bookings | `POST /v1/bookings` · `GET /v1/bookings/:id` · `/accept` · `/reject` · `/cancel` |
| Payments | `POST /v1/payments/intents` · `POST /v1/payments/intents/:id/confirm` |
| Receipts | `GET /v1/payments/:id/receipt` |
| Offline | `POST /v1/bookings/:id/offline/confirm` · `/dispute` |
| Driver | `POST /v1/driver/type` · `/docs/upload` · `GET /v1/driver/docs/status` |
| KYC | `POST /v1/kyc/start` · `GET /v1/kyc/status` |
| Payouts | `POST /v1/payouts/request` |
| Support | `POST /v1/tickets` |
| WebSocket | `gateway` — чат, live-статусы брони/поездки |

Соглашения (headers, error format, idempotency): [`docs/api-conventions.md`](docs/api-conventions.md).

---

## База данных

PostgreSQL 16 + PostGIS. ORM: Prisma. Миграции: `prisma migrate`.

| Таблица | Назначение |
|---------|-----------|
| `users` | Пользователи (phone, status, risk_score) |
| `profiles` | Имя, фото, bio |
| `driver_profiles` | Тип, priority_score, cooldown |
| `vehicles` | Автомобили водителя |
| `documents` | ВУ, ТС, КЛ + doc_hash (антифрод) |
| `rides` | Поездки (from/to geometry, seats, price, status) |
| `bookings` | Брони (статус, тариф, политика отмены) |
| `payments` | Платежи + idempotency_key |
| `ledger_entries` | Двойная запись (debit/credit) |
| `refunds` | Возвраты |
| `fiscal_receipts` | ЭККМ чеки + retry_count, next_retry_at |
| `legal_entities` | Реквизиты эмитента (ОсОО, ИНН) |
| `penalty_ledger` | Офлайн штрафы |
| `offline_proofs` | No-show SLA |
| `outbox` | Transactional Outbox (события) |
| `risk_events` | Лог скоринга |
| `audit_log` | Полный аудит изменений |
| `configs` | Remote config + feature flags |

Полный DDL: [`docs/json-configs.md`](docs/json-configs.md#5-postgresql-ddl).

---

## События и Outbox

Все доменные события пишутся в таблицу `outbox` **внутри той же транзакции**, что и бизнес-данные. Cron-publisher читает непрочитанные события и публикует их.

| Событие | Триггер |
|---------|---------|
| `BookingCreated` | Успешное создание брони |
| `PaymentCaptured` | PSP подтвердил платёж |
| `CancelFeeCharged` | Начислен штраф за отмену |
| `NoShowResolved` | Авто-резолюция no-show |
| `ReceiptIssued` / `ReceiptFailed` | Результат фискализации |

После MVP — подключение **Kafka / NATS JetStream** как транспорт для fan-out.

---

## Фоновые процессы

### Receipt Retry Worker

```
Триггер: PaymentCaptured → поставить задачу
Попытки: max 3 · Backoff: 5 с → 30 с → 300 с
При 3-й неудаче → статус FAILED_FINAL + FinanceOpsCase + событие в Outbox
```

### No-Show SLA Worker

```
Cron: каждые 5 минут
Условие: depart_at + 12h истекло AND dispute_created = false
→ AUTO_RESOLVED → NO_SHOW_CONFIRMED → событие NoShowResolved

Если dispute_created = true → эскалация (тикет в Support)
```

### Outbox Publisher

```
Cron: каждые ~1 с
Читает outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 100
Публикует → помечает published_at = now()
```

---

## Конфиги и политики

Хранятся в таблице `configs`, редактируются через admin с аудитом изменений. Без хардкода в коде.

| Конфиг | Ключевые параметры |
|--------|--------------------|
| `cancel_kg_v1` | free_minutes, cancel_fee, tiers (tier0/1/2), cooldown_hours |
| `risk_kg_v1` | Score thresholds, rules R-001…R-011, действия и параметры |
| `receipts_kg_v1` | max_attempts=3, backoff=[5,30,300], реквизиты эмитента (ОсОО) |
| `offline_sla_kg_v1` | resolution_deadline=12h, auto_resolve=true |
| `liquidity_kg_v1` | LIQUIDITY_X_A=10 rides/day, LIQUIDITY_X_B=3 drivers/peak, 7 дней подряд |

Подробнее: [`docs/json-configs.md`](docs/json-configs.md).  
ТЗ / SRS: [`docs/srs-prd.md`](docs/srs-prd.md).

---

## Запуск

### Требования

- Node.js 20 LTS
- Docker & Docker Compose

### Локально

```bash
# Установить зависимости
npm install

# Поднять инфраструктуру (PostgreSQL + PostGIS, Redis, MinIO)
docker-compose up -d

# Применить миграции и seed
npx prisma migrate dev
npx prisma db seed

# Запустить сервис
npm run start:dev
```

### Docker

```bash
docker build -t sapar-api ./apps/api
docker run -p 3000:3000 --env-file .env sapar-api
```

### Переменные окружения

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/sapar
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
JWT_SECRET=...
PSP_API_KEY=...
KYC_PROVIDER_KEY=...
EKKM_API_URL=...
TWOGIS_API_KEY=...
SMS_PROVIDER_URL=...
SENTRY_DSN=...
```

---

## Документация

| Файл | Описание |
|------|----------|
| [`docs/microservices-guide.md`](docs/microservices-guide.md) | Инструкция по разработке сервисов — принципы, паттерны, стратегия |
| [`docs/api-openapi-schema.md`](docs/api-openapi-schema.md) | OpenAPI 3.0 схема — endpoints, schemas, enums |
| [`docs/srs-prd.md`](docs/srs-prd.md) | ТЗ / SRS v1.3 — функциональные требования, конфиги, backlog |
| [`docs/json-configs.md`](docs/json-configs.md) | JSON-конфиги политик + PostgreSQL DDL + алгоритмы |
| [`docs/api-conventions.md`](docs/api-conventions.md) | Общие соглашения API — headers, ошибки, примеры |
