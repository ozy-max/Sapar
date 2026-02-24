# Инструкция по разработке сервисов — Sapar

> Цель: запустить многосервисный бэкенд **по доменам (bounded contexts)**, а не "каждая фича = сервис", чтобы не утонуть в распределённых транзакциях и DevOps-хаосе.

---

## Содержание

1. [Принцип разбиения](#1-принцип-разбиения)
2. [Минимальный набор сервисов (MVP)](#2-минимальный-набор-сервисов-mvp)
3. [Общий стек](#3-общий-стек)
4. [Контракты и коммуникации](#4-контракты-и-коммуникации)
5. [Данные и владение](#5-данные-и-владение)
6. [Обязательные технические паттерны](#6-обязательные-технические-паттерны)
7. [Структура монорепо](#7-структура-монорепо)
8. [Config-service](#8-config-service)
9. [CI/CD](#9-cicd)
10. [Observability](#10-observability)
11. [Релизная стратегия](#11-релизная-стратегия)
12. [Чеклист готовности](#12-чеклист-готовности)

---

## 1. Принцип разбиения

### Правило

**Сервис = доменная область (bounded context)** у которой:
- свои данные (отдельная PostgreSQL schema/db),
- свой жизненный цикл,
- минимальная зависимость от других сервисов.

### Антипаттерн

**Сервис = экран или фича** (`TripsListService`, `TripCardService`, ...)

Это приводит к:
- цепочкам синхронных вызовов,
- сагам и компенсирующим транзакциям везде,
- хрупким контрактам и невозможности деплоить независимо.

---

## 2. Минимальный набор сервисов (MVP)

```
┌─────────────────────────────────────────────────────────────┐
│                     Mobile App / Admin                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                  ┌────────▼────────┐
                  │   api-gateway   │  ← единственная точка входа
                  └────────┬────────┘
       ┌──────────┬─────────┼──────────┬──────────┐
       ▼          ▼         ▼          ▼          ▼
  identity   profiles    trips     booking    payments
  -service   -service   -service  -service   -service
       
                    ┌──────────┬──────────┬──────────┐
                    ▼          ▼          ▼          ▼
              notifications support   config    (search)
               -service    -service  -service  -service
```

### 1. `api-gateway` (BFF)

- Маршрутизация запросов к сервисам
- Auth middleware (валидация JWT)
- Rate limiting (Redis)
- Агрегация ответов для мобилки/админки
- REST `/v1/...` для клиентов
- Генерация `correlation-id` для каждого запроса

### 2. `identity-service`

- OTP send/verify (SMS)
- JWT issue / refresh / revoke
- Device sessions
- RBAC (roles: passenger, driver, support, admin)

### 3. `profiles-service`

- User/driver profile (имя, фото, рейтинг)
- Vehicles (автомобили водителя)
- Documents metadata (без файлов — файлы в S3)
- KYC статус (интеграция с внешним провайдером)

### 4. `trips-service`

- Создание и управление предложениями поездок (offers)
- Расписание, маршрут (PostGIS), остановки
- Inventory мест (`seats_total`, `seats_available`)
- Правила поездки (payment_mode, booking_mode, ride_type)
- Search/Matching — либо здесь, либо отдельным сервисом

> Search/Matching выносится отдельно, если нужны сложные фильтры, ранжирование или геоиндексы под нагрузку.

### 5. `booking-service`

- Резервирование мест (distributed lock → Postgres transaction)
- State machine брони: `REQUESTED → ACCEPTED → PAID → COMPLETED → CANCELLED`
- Idempotency для create/cancel
- Интеграция с cancellation & penalty policies (из `config-service`)
- Offline confirm/dispute/no-show flow

### 6. `payments-service`

- Payment intents (create / confirm / refund)
- PSP-адаптеры (Mbank, O!Pay, Optima Pay)
- Double-entry ledger (дебит/кредит в Postgres)
- Fiscal receipts (ЭККМ) + retry worker (backoff 5s → 30s → 5m, max 3)
- Penalty ledger (офлайн штрафы CARPOOL)
- Payouts (с проверкой KYC VERIFIED)

### 7. `notifications-service`

- Push / SMS / Email
- Шаблоны по событиям (booking created, payment captured, no-show, ...)
- Retry при ошибках провайдеров
- Потребляет события из брокера

### 8. `support-service`

- Тикеты поддержки
- Offline disputes
- No-show SLA (дедлайн: `depart_at + 12h`, авто-резолюция)
- Модерация кейсов операторами

### 9. `config-service`

- Remote config + feature flags
- Safe-values из ТЗ (см. [раздел 8](#8-config-service))
- Аудит изменений конфигов
- Кеширование через ETag/версию

---

## 3. Общий стек

> Все сервисы используют **единый унифицированный стек** — это критично для переиспользования библиотек, найма и onboarding.

### Язык и фреймворк

| Инструмент | Назначение |
|---|---|
| **TypeScript 5.4+** (strict mode) | Основной язык всех сервисов |
| **Node.js 20 LTS** | Рантайм |
| **NestJS v10+** | Фреймворк: DI, modules, guards, interceptors, decorators |
| **Go 1.22+** | Hot-path сервисы при росте: matching, realtime-chat, high-QPS search |

### Хранилища

| Инструмент | Где используется |
|---|---|
| **PostgreSQL 16 + PostGIS** | Каждый сервис — своя БД/схема |
| **Redis 7** | Rate-limit, distributed locks, idempotency cache, cooldown, сессии |
| **S3-compatible** (MinIO dev) | Файлы: KYC-документы, фискальные чеки, вложения саппорта |

### События (брокер)

| Инструмент | Этап |
|---|---|
| **Transactional Outbox** + cron publisher | MVP — без брокера, события атомарны с транзакцией |
| **NATS JetStream** | Следующий шаг — легче старт, чем Kafka |
| **Kafka** | При необходимости стриминга и высокого throughput |

### ORM и миграции

| Инструмент | Назначение |
|---|---|
| **Prisma** | Type-safe ORM + `prisma migrate` + seed |
| **drizzle-orm** | Альтернатива, если нужна большая гибкость SQL |

### Контракты

| Инструмент | Назначение |
|---|---|
| **Zod** | Runtime validation + TypeScript-типы |
| **@nestjs/swagger** | OpenAPI 3.0 авто-генерация из декораторов |
| **openapi-generator** | Генерация Dart-клиента для Flutter |

### Observability

| Инструмент | Назначение |
|---|---|
| **OpenTelemetry** | Distributed tracing |
| **Prometheus + Grafana** | Метрики |
| **Loki** / ELK | Централизованные логи |
| **Sentry** | Error tracking |

---

## 4. Контракты и коммуникации

### Синхронно (HTTP/REST)

```
Мобилка/Админка → api-gateway → сервис
```

- Внутренние вызовы сервис↔сервис — **минимум**, только если результат нужен немедленно.
- Предпочтительный способ — **асинхронные события**.

### Асинхронно (events)

```
booking-service → [BookingCreated] → payments-service
                                   → notifications-service

payments-service → [PaymentCaptured] → booking-service (обновить статус)
                                     → notifications-service
                                     → receipts (внутри payments)
```

### Версионирование контрактов

| Тип | Формат | Пример |
|-----|--------|--------|
| REST | `/v1/...` | `POST /v1/bookings` |
| Events | `v1.event_type` | `v1.booking_created` |
| Breaking change | `v2`, совместимость держим на gateway | `/v2/rides/search` |

---

## 5. Данные и владение

### Правило владения

```
✅ booking-service → читает/пишет только bookings DB
✅ payments-service → читает/пишет только payments DB

❌ payments-service → SELECT * FROM bookings.bookings  ← ЗАПРЕЩЕНО
```

Каждый сервис **владеет** своей БД. Прямой доступ к чужой БД — запрещён.

### Как работать без JOIN между сервисами

| Способ | Когда использовать |
|--------|-------------------|
| **Read-модели/проекции** (CQRS-lite) | Сервис хранит локальную копию нужных данных, обновляет по событиям |
| **Gateway aggregation** | Агрегировать ответы на уровне api-gateway для клиента |
| **Синхронный запрос** | Только если данные нужны прямо сейчас и нет события |

**Пример:** `booking-service` хранит `ride_departure_at` как проекцию из `trips-service`, полученную по событию `TripPublished`. Не делает HTTP-запрос к trips при каждой брони.

---

## 6. Обязательные технические паттерны

> Без этих паттернов микросервисы превратятся в распределённый монолит с потерей данных.

### 6.1 Idempotency

**Обязательно для команд:**
- `createBooking`
- `pay` / `capture` / `refund`
- `cancelBooking`
- `noShowResolution`
- `issueReceipt`

**Механика:**

```
HTTP заголовок: Idempotency-Key: <uuid>

Таблица idempotency_keys:
  key          TEXT PRIMARY KEY
  scope        TEXT           -- 'booking', 'payment', etc.
  request_hash TEXT           -- hash тела запроса
  response     JSONB          -- закешированный ответ
  expires_at   TIMESTAMPTZ    -- TTL: 24h

Логика:
  1. Проверить key в таблице
  2. Если есть И request_hash совпадает → вернуть cached response
  3. Если есть И hash не совпадает → 409 IDEMPOTENCY_CONFLICT
  4. Если нет → выполнить операцию, сохранить response
```

### 6.2 Distributed Locks (бронирование мест)

```
При создании брони:

1. Redis SETNX lock:booking:{trip_id} {booking_id} EX 10
   → если не удалось → 409 (retry клиент)

2. BEGIN TRANSACTION
   UPDATE trips SET seats_available = seats_available - $seats
   WHERE id = $trip_id AND seats_available >= $seats
   → affected rows = 0 → ROLLBACK → 409 SEATS_CONFLICT

3. INSERT INTO bookings (...)
4. INSERT INTO outbox_events (BookingCreated, ...)
5. COMMIT

6. Redis DEL lock:booking:{trip_id}
```

### 6.3 Transactional Outbox

**Проблема:** событие отправлено в брокер, но транзакция откатилась → несогласованность.

**Решение:**

```sql
-- В той же транзакции что и бизнес-изменение:
INSERT INTO outbox_events (id, event_type, payload, created_at)
VALUES (gen_random_uuid(), 'v1.booking_created', $payload, now());
```

```
Outbox Publisher (cron, каждые ~1с):
  SELECT * FROM outbox_events WHERE published_at IS NULL ORDER BY created_at LIMIT 100
  → publish to NATS/Kafka
  → UPDATE outbox_events SET published_at = now() WHERE id = $id
```

**Inbox (dedupe на стороне consumer):**

```sql
INSERT INTO inbox_events (event_id, event_type, processed_at)
VALUES ($id, $type, now())
ON CONFLICT (event_id) DO NOTHING
-- affected rows = 0 → уже обработано, пропускаем
```

### 6.4 Saga / Компенсация

Для сценариев с несколькими сервисами использовать **Choreography-based Saga** (через события):

```
BookingCreated →
  payments-service: создать payment intent →
    PaymentCaptured →
      booking-service: статус PAID
      notifications-service: уведомить пассажира
      
    PaymentFailed →
      booking-service: статус CANCELLED (компенсация)
      notifications-service: уведомить об ошибке
```

---

## 7. Структура монорепо

```
sapar-backend/
│
├── services/
│   ├── api-gateway/
│   │   ├── src/
│   │   │   ├── routes/          # proxy + aggregation
│   │   │   ├── middleware/      # auth, rate-limit, correlation-id
│   │   │   └── main.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── identity-service/
│   │   ├── src/
│   │   │   ├── otp/
│   │   │   ├── sessions/
│   │   │   ├── jwt/
│   │   │   └── rbac/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   └── package.json
│   │
│   ├── profiles-service/
│   ├── trips-service/
│   ├── booking-service/
│   │   ├── src/
│   │   │   ├── bookings/
│   │   │   ├── state-machine/   # booking status transitions
│   │   │   ├── locks/           # redis distributed locks
│   │   │   └── offline/         # confirm/dispute/no-show
│   │   └── ...
│   │
│   ├── payments-service/
│   │   ├── src/
│   │   │   ├── intents/
│   │   │   ├── ledger/          # double-entry
│   │   │   ├── receipts/        # ЭККМ + retry worker
│   │   │   ├── refunds/
│   │   │   ├── payouts/
│   │   │   └── psp/             # адаптеры: mbank, o!pay, optima
│   │   └── ...
│   │
│   ├── notifications-service/
│   ├── support-service/
│   └── config-service/
│
├── libs/
│   ├── contracts/               # DTO + event-схемы (versioned)
│   │   ├── events/
│   │   │   ├── v1.booking-created.ts
│   │   │   ├── v1.payment-captured.ts
│   │   │   ├── v1.no-show-resolved.ts
│   │   │   └── ...
│   │   └── dto/
│   │       ├── booking.dto.ts
│   │       ├── payment.dto.ts
│   │       └── ...
│   │
│   ├── common/                  # logger, errors, tracing, auth utils
│   │   ├── logger.ts            # structured JSON logs
│   │   ├── errors.ts            # ApiError + error codes
│   │   ├── tracing.ts           # OpenTelemetry setup
│   │   └── correlation-id.ts
│   │
│   ├── outbox/                  # Transactional Outbox publisher
│   │   ├── outbox.service.ts
│   │   └── outbox-publisher.cron.ts
│   │
│   ├── inbox/                   # Inbox dedupe
│   │   └── inbox.service.ts
│   │
│   └── policy/                  # Доменные политики (переиспользуются)
│       ├── cancellation.policy.ts
│       ├── fee-calculator.ts    # max(min_fee, percent * fare)
│       ├── cooldown.policy.ts
│       ├── liquidity.policy.ts
│       └── risk-engine.ts       # R-001..R-011
│
├── infra/
│   ├── docker-compose.yml       # postgres, redis, minio, nats, grafana
│   ├── docker-compose.dev.yml
│   └── k8s/
│       ├── charts/              # Helm charts на каждый сервис
│       └── manifests/
│
├── tools/
│   └── scripts/
│       ├── migrate-all.sh       # запустить миграции всех сервисов
│       └── seed-all.sh
│
├── package.json                 # workspaces root
└── turbo.json                   # Turborepo (build cache, pipeline)
```

---

## 8. Config-service

Все конфиги — **данные**, не код. Изменяются через admin без деплоя. Каждое изменение логируется.

### Что хранит

```
key         TEXT    -- 'KGS_PAX_CARPOOL_CANCEL_FEE'
scope       TEXT    -- 'global' | 'country:KG' | 'city:bishkek'
value       JSONB   -- значение
version     INT     -- инкрементируется при каждом изменении
changed_by  UUID    -- аудит
changed_at  TIMESTAMPTZ
```

### Что отдаёт

```
GET /v1/config
Response: { version: 42, configs: { ... }, etag: "sha256..." }

Клиенты кешируют по ETag, не дёргают при каждом запросе
```

### Seed-значения из ТЗ (defaults при первом деплое)

| Ключ | Значение | Описание |
|------|----------|----------|
| `KGS_PAX_CARPOOL_CANCEL_FEE` | `100` | Штраф пассажира CARPOOL (KGS) |
| `COMM_PAX_FREE_MINUTES` | `5` | Бесплатное окно отмены COMMERCIAL (мин) |
| `COMM_PAX_CANCEL_MIN_FEE_KGS` | `100` | Минимальный штраф COMMERCIAL (KGS) |
| `COMM_PAX_CANCEL_PERCENT` | `0.15` | Процент штрафа от стоимости поездки |
| `COMM_DRV_FREE_HOURS` | `12` | Бесплатное окно отмены водителя (ч) |
| `CARPOOL_PAX_FREE_MINUTES` | `30` | Бесплатное окно отмены CARPOOL (мин) |
| `COOLDOWN_HOURS` | `4` | Cooldown при tier2 / driver late cancel |
| `DRIVER_LATE_CANCEL_THRESHOLD` | `2` | Порог поздних отмен водителя за 30д |
| `DRIVER_PRIORITY_SCORE_DELTA` | `-10` | Снижение score при поздней отмене |
| `LIQUIDITY_X_A` | `10` | Поездок/день для отключения free-period |
| `LIQUIDITY_X_B` | `3` | Активных водителей в час-пик |
| `LIQUIDITY_DAYS_THRESHOLD` | `7` | Дней подряд для триггера ликвидности |
| `PEAK_HOURS_START_AM` | `"07:00"` | Начало утреннего час-пика |
| `PEAK_HOURS_END_AM` | `"10:00"` | Конец утреннего час-пика |
| `PEAK_HOURS_START_PM` | `"17:00"` | Начало вечернего час-пика |
| `PEAK_HOURS_END_PM` | `"20:00"` | Конец вечернего час-пика |
| `RECEIPT_RETRY_N` | `3` | Максимум попыток выдачи чека |
| `RECEIPT_BACKOFF_SECONDS` | `[5, 30, 300]` | Backoff между попытками (с) |
| `NO_SHOW_SLA_HOURS` | `12` | Дедлайн авто-резолюции no-show (ч) |

---

## 9. CI/CD

### Pipeline на каждый сервис

```
push / PR
  │
  ├─ lint (ESLint + Prettier check)
  ├─ typecheck (tsc --noEmit)
  ├─ unit tests (Jest)
  ├─ integration tests (testcontainers)
  │
  ├─ build (tsc / esbuild)
  ├─ docker build (multi-stage)
  ├─ docker push → registry
  │
  └─ deploy
       ├─ run DB migrations (job)
       └─ rollout (Kubernetes)
```

### Обязательные требования к каждому сервису

```typescript
// health endpoint (обязательно)
GET /health
→ { status: 'ok', version: '1.2.3', uptime: 3600 }

// Kubernetes probes в Helm chart
livenessProbe:
  httpGet: { path: /health, port: 3000 }
  initialDelaySeconds: 10

readinessProbe:
  httpGet: { path: /health/ready, port: 3000 }
  initialDelaySeconds: 5
```

### Миграции на деплое

```yaml
# Kubernetes Job перед rollout
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-migrate
spec:
  template:
    spec:
      containers:
        - name: migrate
          image: {{ .Values.image }}
          command: ["npx", "prisma", "migrate", "deploy"]
      restartPolicy: OnFailure
```

---

## 10. Observability

### Стандарт (единый для всех сервисов)

Каждый сервис при старте подключает `libs/common/tracing.ts` — инициализация OpenTelemetry SDK.

| Требование | Реализация |
|-----------|-----------|
| `correlation-id` в каждом запросе | `api-gateway` генерит UUID, все сервисы пробрасывают через `AsyncLocalStorage` |
| Trace propagation между сервисами | W3C `traceparent` header в HTTP + NATS metadata |
| Structured logs | JSON: `{ level, message, correlationId, traceId, service, timestamp }` |
| Метрики | `prom-client`: latency (p50/p95/p99), error_rate, http_requests_total |
| Дополнительные метрики | broker_lag, retry_count, lock_contention, outbox_pending |

### Grafana дашборды (минимальный набор)

- **Service Overview** — RPS, latency, error rate по сервисам
- **Booking Funnel** — created → accepted → paid → completed
- **Payments** — capture rate, refund rate, receipt retry queue
- **Risk Engine** — blocked requests, rule hits по R-xxx
- **No-Show SLA** — pending disputes, auto-resolved, escalated

---

## 11. Релизная стратегия

Запускать сервисы **итеративно**, не все сразу:

```
Фаза 1 — Core (недели 1–4)
  ├─ api-gateway
  ├─ identity-service
  ├─ trips-service
  └─ booking-service (с mock payments)

Фаза 2 — Монетизация (недели 5–8)
  ├─ payments-service (mock PSP → реальный PSP)
  └─ config-service ← лучше сразу, иначе hardcode ад

Фаза 3 — Коммуникации (недели 9–12)
  └─ notifications-service

Фаза 4 — Поддержка и споры (недели 13–16)
  └─ support-service (disputes, no-show SLA)

Фаза 5 — Рост (по необходимости)
  ├─ search/matching-service (вынос из trips)
  └─ Go-сервисы (realtime-chat, high-QPS)
```

> **Правило:** на каждой фазе — полный E2E-флоу работает до конца. Никаких "подключим позже".

---

## 12. Чеклист готовности

Перед стартом каждого сервиса убедись, что есть:

### Контракты и API
- [ ] OpenAPI-схема описана и задокументирована
- [ ] Все event-контракты версионированы в `libs/contracts/events/`
- [ ] Breaking changes идут через v2, совместимость обеспечена

### Надёжность
- [ ] Idempotency реализована для всех мутирующих команд
- [ ] Transactional Outbox подключён для доменных событий
- [ ] Inbox dedupe настроен на стороне consumers
- [ ] Distributed Redis lock для booking seats
- [ ] Retry + backoff для внешних вызовов (PSP, KYC, SMS, ЭККМ)

### Инфраструктура
- [ ] `GET /health` и `GET /health/ready` реализованы
- [ ] Liveness / Readiness probes в Helm chart
- [ ] DB-миграции в CI/CD pipeline (job перед rollout)
- [ ] Secrets через Vault / KMS (не в env-файлах в репо)
- [ ] Rate limiting на api-gateway

### Observability
- [ ] OpenTelemetry инициализирован (из `libs/common/tracing.ts`)
- [ ] `correlation-id` пробрасывается через AsyncLocalStorage
- [ ] Structured JSON-логи
- [ ] `prom-client` метрики подключены
- [ ] Sentry DSN настроен

### Конфиги
- [ ] Все константы из ТЗ — в `config-service`, не в коде
- [ ] Seed-значения загружены при деплое
- [ ] Изменение конфигов логируется с `changed_by`

### Тесты
- [ ] Unit-тесты на domain policies (FeeCalculator, CooldownPolicy, RiskEngine)
- [ ] Integration-тесты с testcontainers (Postgres + Redis)
- [ ] Contract-тесты (Pact) для PSP-адаптеров
- [ ] Load-тест (k6) для booking endpoint перед каждым релизом
