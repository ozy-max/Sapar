# Sapar — Локальная разработка и QA

---

## Содержание

1. [Требования](#требования)
2. [Быстрый старт (весь стек)](#быстрый-старт-весь-стек)
3. [Запуск одного сервиса](#запуск-одного-сервиса)
4. [Observability](#observability)
5. [Скрипты](#скрипты)
6. [Функциональная верификация](#функциональная-верификация)
7. [Тестирование](#тестирование)
8. [Работа с Prisma](#работа-с-prisma)
9. [Порты и URL](#порты-и-url)
10. [Troubleshooting](#troubleshooting)

---

## Требования

| Инструмент | Версия | Назначение |
|-----------|--------|------------|
| Node.js | 20 LTS | Рантайм |
| npm | ≥9 | Менеджер пакетов |
| Docker | ≥24 | Контейнеризация |
| Docker Compose | v2 | Оркестрация |
| curl | — | Smoke-тесты |
| jq | — | Функциональная верификация |
| openssl | — | HMAC-подпись в скриптах |

---

## Быстрый старт (весь стек)

### 1. Настройка переменных окружения

```bash
cp .env.docker.example .env.docker
```

Отредактируйте `.env.docker`, задав реальные значения:

| Переменная | Описание | Пример |
|------------|----------|--------|
| `POSTGRES_PASSWORD` | Пароль PostgreSQL | `my-strong-password-2026` |
| `JWT_ACCESS_SECRET` | Секрет JWT (≥32 символа) | `my-jwt-secret-at-least-32-characters` |
| `JWT_ACCESS_TTL_SEC` | TTL access token | `900` |
| `REFRESH_TOKEN_TTL_SEC` | TTL refresh token | `604800` |
| `EVENTS_HMAC_SECRET` | Секрет HMAC (≥32 символа) | `my-hmac-secret-at-least-32-chars!!` |
| `PAYMENTS_WEBHOOK_SECRET` | Секрет webhook PSP (≥32 символа) | `my-webhook-secret-32-chars-long!!` |
| `GF_ADMIN_USER` | Логин Grafana | `admin` |
| `GF_ADMIN_PASSWORD` | Пароль Grafana | `grafana-admin-2026` |

### 2. Запуск стека

```bash
docker-compose --env-file .env.docker up -d
```

Это поднимает:
- 7 PostgreSQL инстансов (по одному на сервис)
- 2 Redis инстанса (gateway + trips)
- 7 сервисов (build from Dockerfile)

### 3. Проверка здоровья

```bash
# Быстрая проверка всех сервисов
./scripts/smoke.sh

# Или с ожиданием готовности (до 60 сек)
./scripts/smoke.sh --wait 60
```

Вручную:

```bash
curl http://localhost:3000/health   # api-gateway
curl http://localhost:3001/health   # identity-service
curl http://localhost:3002/health   # trips-service
curl http://localhost:3003/health   # payments-service
curl http://localhost:3004/health   # notifications-service
curl http://localhost:3005/health   # admin-service
curl http://localhost:3006/health   # profiles-service
```

### 4. Остановка

```bash
docker-compose --env-file .env.docker down

# С удалением volumes (осторожно: данные будут потеряны)
docker-compose --env-file .env.docker down -v
```

---

## Запуск одного сервиса

Для локальной разработки с hot-reload:

```bash
cd services/identity-service

# Скопировать и настроить переменные окружения
cp .env.example .env
# Отредактировать .env (DATABASE_URL, JWT_ACCESS_SECRET, и т.д.)

# Установить зависимости
npm install

# Сгенерировать Prisma client
npx prisma generate

# Применить миграции (PostgreSQL должен быть запущен)
npx prisma migrate deploy

# Запустить в dev-режиме (hot-reload)
npm run start:dev
```

> **Важно:** Для работы сервиса нужна PostgreSQL. Можно использовать docker-compose для инфраструктуры:
> ```bash
> # Поднять только PostgreSQL и Redis
> docker-compose --env-file .env.docker up -d postgres redis identity-postgres
> ```

### npm-скрипты (доступны в каждом сервисе)

| Команда | Описание |
|---------|----------|
| `npm run build` | Компиляция TypeScript |
| `npm run start` | Запуск скомпилированного кода |
| `npm run start:dev` | Dev-режим с hot-reload |
| `npm run start:prod` | Продакшн-запуск |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run test` | Unit-тесты (Jest) |
| `npm run test:e2e` | E2E-тесты |
| `npm run prisma:generate` | Генерация Prisma client |
| `npm run prisma:migrate:dev` | Создание миграции (dev) |
| `npm run prisma:migrate:deploy` | Применение миграций |

### Специфичные скрипты

| Сервис | Команда | Описание |
|--------|---------|----------|
| identity-service | `npm run seed:admin` | Создание seed-админа |
| trips-service | `npm run seed:cities` | Загрузка городов |

---

## Observability

### Запуск Prometheus + Grafana

```bash
docker-compose -f docker-compose.observability.yml --env-file .env.docker up -d
```

> Оба compose-файла должны запускаться из корня репозитория. Observability-контейнеры автоматически подключаются к Docker-сети основного стека.

### Доступ

| Сервис | URL | Логин |
|--------|-----|-------|
| Grafana | http://localhost:3100 | `GF_ADMIN_USER` / `GF_ADMIN_PASSWORD` |
| Prometheus | http://localhost:9090 | — |

### Дашборды Grafana (auto-provisioned)

- **Sapar Overview** — общий обзор платформы (latency, errors, throughput)
- **Gateway** — api-gateway (rate limiting, circuit breakers, proxy latency)
- **Payments** — платёжный сервис (PSP calls, receipts, intents)
- **Notifications** — уведомления (outcomes, retries, channels)

### Метрики

Каждый сервис экспортирует Prometheus-метрики на `GET /metrics`.

### Swagger UI

В non-production режиме доступен по адресу:
```
http://localhost:{port}/swagger
```

---

## Скрипты

### `scripts/smoke.sh`

Smoke-тест: проверяет `/health` и `/ready` для всех 7 сервисов.

```bash
# Базовая проверка
./scripts/smoke.sh

# С ожиданием до 60 секунд
./scripts/smoke.sh --wait 60
```

Exit code: `0` — все healthy, `1` — есть проблемы.

### `scripts/run-service.sh`

Запуск quality-gates для одного сервиса (lint, typecheck, unit, e2e).

```bash
# Все шаги
./scripts/run-service.sh identity-service all

# Только lint
./scripts/run-service.sh trips-service lint

# Только unit-тесты
./scripts/run-service.sh payments-service unit

# Только e2e
./scripts/run-service.sh admin-service e2e
```

### `scripts/mega-functional-verification.sh`

Полная функциональная верификация всей платформы. Идемпотентен (можно запускать повторно).

```bash
./scripts/mega-functional-verification.sh
```

**Что проверяется:**
- Health/ready всех сервисов
- Регистрация и авторизация пользователей
- JWT: получение, refresh, logout
- Назначение ролей (admin)
- Создание поездок
- Поиск поездок (по городу, geo, bbox)
- Бронирование мест
- Booking saga (hold → confirm)
- Отмена бронирований и поездок
- Платежные интенты, webhooks
- Уведомления
- Конфигурации (admin)
- Споры (создание, разрешение)
- Модерация (бан, разбан, отмена поездки)
- Профили и рейтинги
- HMAC-подпись и верификация
- Rate limiting

**Требования:**
- Весь стек запущен (`docker-compose up`)
- Утилиты: `curl`, `jq`, `openssl`, `docker`
- Переменные: `HMAC_SECRET`, `WEBHOOK_SECRET` (по умолчанию dev-значения)

**Вывод:**
- Цветной отчёт в терминале (PASS/FAIL/SKIP)
- CSV-отчёт: `/tmp/sapar-verify-{timestamp}/results.csv`
- Markdown-отчёт: `/tmp/sapar-verify-{timestamp}/report.md`

### `scripts/functional-verification.sh`

Упрощённая версия функциональной верификации.

### `scripts/changed-services.sh`

Определяет затронутые сервисы по git diff (используется в CI).

### `scripts/check-migrations.sh`

Проверяет безопасность миграций Prisma для сервиса.

```bash
./scripts/check-migrations.sh identity-service
```

### `scripts/check-coverage.sh`

Проверяет порог покрытия тестами.

```bash
./scripts/check-coverage.sh coverage/coverage-summary.json 60
```

### `scripts/backup-postgres.sh` / `scripts/restore-postgres.sh`

Бекап и восстановление PostgreSQL баз.

### `scripts/chaos-run.sh`

Запуск chaos-тестов.

---

## Функциональная верификация

### Минимальный ручной сценарий

```bash
# 0. Поднять стек
docker-compose --env-file .env.docker up -d
./scripts/smoke.sh --wait 60

# 1. Зарегистрировать пользователя
curl -s -X POST http://localhost:3000/identity/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"password123"}' | jq .

# 2. Войти
TOKEN=$(curl -s -X POST http://localhost:3000/identity/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"password123"}' | jq -r '.accessToken')

echo "Access Token: $TOKEN"

# 3. Создать поездку
TRIP=$(curl -s -X POST http://localhost:3000/trips/ \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "fromCity":"Бишкек",
    "toCity":"Ош",
    "departAt":"2026-04-01T08:00:00Z",
    "seatsTotal":3,
    "priceKgs":1500
  }' | jq .)

TRIP_ID=$(echo "$TRIP" | jq -r '.tripId')
echo "Trip ID: $TRIP_ID"

# 4. Поиск поездок
curl -s "http://localhost:3000/v1/trips/search?fromCity=Бишкек&toCity=Ош" | jq .

# 5. Детали поездки (BFF: trip + рейтинг водителя)
curl -s "http://localhost:3000/v1/trips/$TRIP_ID" | jq .

# 6. Забронировать (от имени другого пользователя)
# -- сначала зарегистрируйте второго пользователя и получите его токен
BOOKING=$(curl -s -X POST "http://localhost:3000/trips/$TRIP_ID/book" \
  -H "Authorization: Bearer $PASSENGER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"seats":1}' | jq .)

BOOKING_ID=$(echo "$BOOKING" | jq -r '.bookingId')
echo "Booking ID: $BOOKING_ID"

# 7. Детали бронирования (BFF)
curl -s "http://localhost:3000/v1/bookings/$BOOKING_ID" \
  -H "Authorization: Bearer $PASSENGER_TOKEN" | jq .

# 8. Мои бронирования (BFF)
curl -s "http://localhost:3000/v1/me/bookings" \
  -H "Authorization: Bearer $PASSENGER_TOKEN" | jq .
```

### Полная автоматизированная проверка

```bash
./scripts/mega-functional-verification.sh
```

---

## Тестирование

### Unit-тесты

```bash
cd services/identity-service
npm run test
```

Настройки Jest: `--runInBand`, покрытие в `coverage/`.

### E2E-тесты

Требуют запущенную PostgreSQL (и Redis для gateway/trips).

```bash
cd services/identity-service
npm run test:e2e
```

E2E-тесты каждого сервиса:
- Используют реальную PostgreSQL (тестовую)
- Применяют миграции перед запуском
- Изолируют данные между тестами

### Coverage threshold

Минимальный порог покрытия: **60%** (настраивается через `COVERAGE_THRESHOLD`).

---

## Работа с Prisma

### Генерация client

```bash
npx prisma generate
```

### Создание миграции (dev)

```bash
npx prisma migrate dev --name add_some_field
```

### Применение миграций

```bash
npx prisma migrate deploy
```

### Валидация схемы

```bash
npx prisma validate
```

### Просмотр данных (Prisma Studio)

```bash
npx prisma studio
```

Открывает web-интерфейс на http://localhost:5555 для просмотра и редактирования данных.

### Схемы

Каждый сервис имеет свою Prisma-схему:

```
services/api-gateway/prisma/schema.prisma
services/identity-service/prisma/schema.prisma
services/trips-service/prisma/schema.prisma
services/payments-service/prisma/schema.prisma
services/notifications-service/prisma/schema.prisma
services/admin-service/prisma/schema.prisma
services/profiles-service/prisma/schema.prisma
```

---

## Порты и URL

### Сервисы

| Сервис | Порт | Health | Ready | Metrics | Swagger |
|--------|------|--------|-------|---------|---------|
| api-gateway | 3000 | `/health` | `/ready` | `/metrics` | `/swagger` |
| identity-service | 3001 | `/health` | `/ready` | `/metrics` | `/swagger` |
| trips-service | 3002 | `/health` | `/ready` | `/metrics` | `/swagger` |
| payments-service | 3003 | `/health` | `/ready` | `/metrics` | `/swagger` |
| notifications-service | 3004 | `/health` | `/ready` | `/metrics` | `/swagger` |
| admin-service | 3005 | `/health` | `/ready` | `/metrics` | `/swagger` |
| profiles-service | 3006 | `/health` | `/ready` | `/metrics` | `/swagger` |

### Gateway proxy

| Prefix | Downstream | Пример |
|--------|-----------|--------|
| `/identity/*` | localhost:3001 | `GET /identity/auth/login` |
| `/trips/*` | localhost:3002 | `POST /trips/` |
| `/payments/*` | localhost:3003 | `POST /payments/intents` |
| `/admin/*` | localhost:3005 | `GET /admin/configs` |
| `/profiles/*` | localhost:3006 | `GET /profiles/:userId` |
| `/v1/*` | BFF (агрегация) | `GET /v1/trips/search` |

### Инфраструктура

| Сервис | Порт |
|--------|------|
| PostgreSQL (gateway) | 5432 |
| PostgreSQL (identity) | 5433 |
| PostgreSQL (trips) | 5435 |
| PostgreSQL (payments) | 5437 |
| PostgreSQL (notifications) | 5439 |
| PostgreSQL (admin) | 5441 |
| PostgreSQL (profiles) | 5443 |
| Redis (gateway) | 6379 |
| Redis (trips) | 6380 |
| Prometheus | 9090 |
| Grafana | 3100 |

---

## Troubleshooting

### Сервис не стартует

```bash
# Проверить логи
docker-compose logs -f identity-service

# Проверить health
curl -v http://localhost:3001/health

# Проверить ready (БД)
curl -v http://localhost:3001/ready
```

### Ошибка миграции

```bash
# Проверить статус миграций
cd services/identity-service
npx prisma migrate status

# Сбросить БД (ОСТОРОЖНО: потеря данных)
npx prisma migrate reset
```

### Redis недоступен

- Rate limiting переходит на fail strategy (open/closed)
- Search cache — запросы идут напрямую в БД
- Проверить: `docker-compose logs redis`

### Порт уже занят

```bash
# Найти процесс на порте
lsof -i :3000

# Или остановить все контейнеры
docker-compose --env-file .env.docker down
```

### Полный сброс

```bash
# Остановить всё и удалить volumes
docker-compose --env-file .env.docker down -v

# Пересобрать образы
docker-compose --env-file .env.docker build --no-cache

# Запустить заново
docker-compose --env-file .env.docker up -d
```
