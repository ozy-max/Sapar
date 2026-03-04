# CI/CD — руководство

## Обзор pipeline

Проект использует подход **"deploy by Docker images only"** — на серверах нет исходного кода, только `docker-compose.yml` и `.env`. Все сервисы собираются в Docker-образы, пушатся в GHCR и деплоятся через `docker compose pull`.

### Workflows

| Файл | Триггер | Описание |
|-------|---------|----------|
| `build-and-push.yml` | `push` в `dev` / `main` | Сборка и push Docker-образов всех 7 сервисов + авто-деплой на STAGE (только `dev`) |
| `deploy-prod.yml` | `workflow_dispatch` (ручной) | Деплой на PROD сервер |

### Сервисы (matrix)

| Сервис | Build context | Образ в GHCR |
|--------|--------------|--------------|
| api-gateway | `services/api-gateway` | `ghcr.io/ozy-max/sapar-api-gateway` |
| identity-service | `services/identity-service` | `ghcr.io/ozy-max/sapar-identity-service` |
| trips-service | `services/trips-service` | `ghcr.io/ozy-max/sapar-trips-service` |
| payments-service | `services/payments-service` | `ghcr.io/ozy-max/sapar-payments-service` |
| notifications-service | `services/notifications-service` | `ghcr.io/ozy-max/sapar-notifications-service` |
| admin-service | `services/admin-service` | `ghcr.io/ozy-max/sapar-admin-service` |
| profiles-service | `services/profiles-service` | `ghcr.io/ozy-max/sapar-profiles-service` |

---

## Тегирование образов

Каждый push создаёт **два тега** на каждый образ:

| Ветка | Тег окружения | SHA-тег |
|-------|--------------|---------|
| `dev` | `dev` | `sha-<7 символов>` |
| `main` | `prod` | `sha-<7 символов>` |

Тег `latest` **не используется**.

**Примеры:**
```
ghcr.io/ozy-max/sapar-api-gateway:dev
ghcr.io/ozy-max/sapar-api-gateway:sha-a1b2c3d
ghcr.io/ozy-max/sapar-identity-service:prod
ghcr.io/ozy-max/sapar-identity-service:sha-e4f5g6h
```

---

## Авто-деплой на STAGE

На STAGE-сервере установлен self-hosted GitHub Actions runner (label: `stage`). Деплой выполняется **локально** на сервере — без SSH.

При push в ветку `dev`:
1. Job `build` собирает и пушит все 7 образов с тегом `dev` и `sha-*` (GitHub-hosted runner).
2. Job `deploy-stage` (зависит от `build`) запускается на self-hosted runner прямо на STAGE-сервере и выполняет:

```bash
cd /opt/sapar
echo "$GHCR_PAT" | docker login ghcr.io -u ozy-max --password-stdin
export IMAGE_TAG=dev
docker compose pull
docker compose up -d
docker image prune -f
```

`docker-compose.yml` на STAGE использует образы с тегом `dev`. SSH-секреты для stage не нужны.

---

## Ручной деплой на PROD

На PROD-сервере установлен self-hosted GitHub Actions runner (label: `prod`). Деплой выполняется **локально** на сервере — без SSH.

1. Перейдите в **Actions → Deploy to PROD → Run workflow**.
2. Опционально укажите `image_tag` (по умолчанию `prod`, можно указать `sha-...` для конкретной версии).
3. Job `deploy` запустится на self-hosted runner прямо на PROD-сервере и выполнит:

```bash
cd /opt/sapar
export IMAGE_TAG="<выбранный тег>"
echo "$GHCR_PAT" | docker login ghcr.io -u ozy-max --password-stdin
docker compose pull
docker compose up -d
docker image prune -f
```

> `docker-compose.yml` на PROD должен использовать `${IMAGE_TAG:-prod}` в тегах образов.

---

## Необходимые секреты

Добавьте в **Settings → Secrets and variables → Actions**:

| Секрет | Описание |
|--------|----------|
| `GHCR_PAT` | Personal Access Token с правами `read:packages` + `write:packages` |

> SSH-секреты не нужны — оба деплоя (stage и prod) выполняются локально на self-hosted runners.

> `GITHUB_TOKEN` используется автоматически для авторизации в GHCR при сборке.

---

## Структура на серверах

```
/opt/sapar/
├── docker-compose.yml   # Ссылается на GHCR-образы
└── .env                 # Переменные окружения
```

На серверах **нет клона репозитория**. Обновление = `docker compose pull && docker compose up -d`.

---

## Кеширование сборки

Используется Docker Buildx с GHA layer cache (`type=gha`). Каждый сервис имеет свой scope кеша, что обеспечивает изоляцию и быструю пересборку.

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

# Prisma
npx prisma validate
npx prisma migrate deploy

# E2E (требуется запущенный Postgres)
npm run test:e2e
```

---

## Переменные окружения для E2E-тестов

Каждый сервис задаёт значения по умолчанию в `test/e2e/helpers/env-setup.ts`.

| Переменная | Значение в CI | Описание |
|-----------|--------------|----------|
| `DATABASE_URL` | `postgresql://sapar:sapar_secret@localhost:5432/sapar_test` | Postgres (GHA services) |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis (нужен только api-gateway) |
| `NODE_ENV` | `test` | |
