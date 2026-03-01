# CI/CD — руководство

## Обзор pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`) запускается на каждый `push` в `main` и на каждый Pull Request.

Pipeline состоит из трёх jobs:

| Job | Описание |
|-----|----------|
| `detect_changes` | Определяет, какие сервисы затронуты изменениями |
| `service_ci` | Матрица: lint → typecheck → unit-тесты → e2e → Docker build для каждого затронутого сервиса |
| `push_images` | (только `main` + наличие секретов) — push Docker-образов в реестр |

### Path-aware логика

Скрипт `scripts/changed-services.sh` анализирует `git diff` и строит JSON-массив затронутых сервисов:

| Путь | Эффект |
|------|--------|
| `services/api-gateway/**` | Только `api-gateway` |
| `services/identity-service/**` | Только `identity-service` |
| `services/trips-service/**` | Только `trips-service` |
| `services/payments-service/**` | Только `payments-service` |
| `services/notifications-service/**` | Только `notifications-service` |
| `scripts/**`, `.github/**`, `docker-compose.yml` | **Все** сервисы |

---

## Запуск CI-шагов локально

### Все проверки для одного сервиса

```bash
./scripts/run-service.sh identity-service        # lint + typecheck + unit + e2e
./scripts/run-service.sh identity-service lint    # только lint
./scripts/run-service.sh identity-service unit    # только unit-тесты + coverage
```

### По отдельности (из директории сервиса)

```bash
cd services/identity-service
npm ci

# Lint (без --fix, как в CI)
npx eslint '{src,test}/**/*.ts'

# Typecheck
npx tsc --noEmit

# Unit-тесты с покрытием
npx jest --runInBand --coverage \
  --coverageReporters=text-summary \
  --coverageReporters=json-summary

# Проверка порога покрытия (60% по умолчанию)
../../scripts/check-coverage.sh coverage/coverage-summary.json 60

# Prisma
npx prisma validate
npx prisma migrate deploy

# E2E (требуется запущенный Postgres)
npm run test:e2e
```

### Проверка миграций

```bash
# Из корня репозитория
./scripts/check-migrations.sh identity-service
```

---

## Переменные окружения для E2E-тестов

Каждый сервис задаёт значения по умолчанию в `test/e2e/helpers/env-setup.ts`.
В CI переменные переопределяются на уровне job:

| Переменная | Значение в CI | Описание |
|-----------|--------------|----------|
| `DATABASE_URL` | `postgresql://sapar:sapar_secret@localhost:5432/sapar_test` | Postgres (GHA services) |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis (нужен только api-gateway) |
| `NODE_ENV` | `test` | |

### Локальная подготовка БД для E2E

```bash
# Вариант 1: per-service docker-compose (у каждого сервиса свой)
cd services/identity-service
docker compose up -d

# Вариант 2: корневой docker-compose
docker compose up -d postgres redis
```

Порты по умолчанию (локально):

| Сервис | Postgres порт | Тестовая БД |
|--------|--------------|-------------|
| identity-service | 5434 | `sapar_identity_test` |
| trips-service | 5436 | `sapar_trips_test` |
| payments-service | 5438 | `sapar_payments_test` |
| notifications-service | 5440 | `sapar_notifications_test` |
| api-gateway | — | Не использует реальную БД в E2E |

---

## Порог покрытия

По умолчанию: **60% lines** (MVP).

Как изменить:
- **CI**: отредактируйте `env.COVERAGE_THRESHOLD` в `.github/workflows/ci.yml`
- **Локально**: передайте вторым аргументом в `check-coverage.sh`:

```bash
./scripts/check-coverage.sh coverage/coverage-summary.json 80
```

---

## Docker-образы

CI собирает образ для каждого затронутого сервиса:
- Тег: `sapar/<service>:<commit-sha>`
- Используется Buildx с GHA layer cache
- По умолчанию образы **не пушатся**
- Push происходит в job `push_images` только при merge в `main` и наличии секретов

### Необходимые секреты для push (опционально)

| Секрет | Описание |
|--------|----------|
| `REGISTRY_URL` | Адрес реестра (e.g. `ghcr.io`) |
| `REGISTRY_USERNAME` | Логин |
| `REGISTRY_PASSWORD` | Пароль / токен |

### Smoke-тест

После сборки образа CI автоматически запускает контейнер и проверяет `GET /health`.
