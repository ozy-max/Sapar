# Identity Service

Микросервис аутентификации для платформы Sapar. Реализует регистрацию, логин, ротацию refresh-токенов и logout.

## Архитектура

Clean/Hexagonal architecture:

```
src/
├── adapters/
│   ├── db/          # Prisma, репозитории (PostgreSQL)
│   └── http/        # Контроллеры, DTO, фильтры, middleware, pipes
├── application/     # Use-cases (по одному на эндпоинт)
├── domain/          # Сущности / value objects
├── shared/          # Переиспользуемые модули (crypto, jwt, errors)
├── config/          # Zod-валидация env
├── app.module.ts
└── main.ts
```

## Быстрый старт

### 1. Поднять PostgreSQL

```bash
cd services/identity-service
docker compose up -d identity-postgres
```

### 2. Установить зависимости и сгенерировать Prisma client

```bash
npm ci
npx prisma generate
```

### 3. Применить миграции

```bash
DATABASE_URL=postgresql://sapar:sapar_secret@localhost:5433/sapar_identity \
  npx prisma migrate dev --name init
```

### 4. Запустить сервис

```bash
cp .env.example .env
# Отредактировать JWT_ACCESS_SECRET в .env!
npm run start:dev
```

Swagger доступен на http://localhost:3001/swagger

## Переменные окружения

| Переменная | Обязательная | По умолчанию | Описание |
|---|---|---|---|
| `PORT` | нет | 3001 | Порт сервиса |
| `DATABASE_URL` | да | — | PostgreSQL connection string |
| `NODE_ENV` | нет | development | Окружение |
| `LOG_LEVEL` | нет | info | Уровень логов (pino) |
| `JWT_ACCESS_SECRET` | да (>=32 символа в prod) | — | Секрет для подписи JWT |
| `JWT_ACCESS_TTL_SEC` | нет | 900 (15 мин) | Время жизни access token |
| `REFRESH_TOKEN_TTL_SEC` | нет | 2592000 (30 дней) | Время жизни refresh token |
| `PASSWORD_HASH_MEMORY_COST` | нет | 65536 (64 MiB) | Argon2 memory cost |
| `PASSWORD_HASH_TIME_COST` | нет | 3 | Argon2 time cost (итерации) |

## Интеграция с API Gateway

В `api-gateway` уже настроен проксирующий маршрут `/identity/*` → `IDENTITY_BASE_URL`.

Для локальной разработки:

```env
# api-gateway .env
IDENTITY_BASE_URL=http://localhost:3001
```

Для Docker Compose (корневой docker-compose.yml уже обновлён):

```env
IDENTITY_BASE_URL=http://identity-service:3001
```

Все запросы вида `POST /identity/auth/register` через gateway проксируются в `POST /auth/register` identity-service.

## Стратегия токенов (MVP)

- **Access token**: JWT, короткоживущий (15 мин). Claims: `sub` (userId), `email`, `iat`, `exp`.
- **Refresh token**: opaque (32 байта, base64url). Хранится в БД как SHA-256 хеш. TTL: 30 дней.
- **Ротация**: при refresh старый токен revoke + `replacedByTokenId`. Выдаётся новый.
- **MVP-ограничение**: один активный refresh token на пользователя. При каждом login все предыдущие revoke. Это упрощает реализацию; для multi-device нужно добавить `deviceId` в RefreshToken.

## Тестирование

### Подготовка тестовой БД

```bash
docker compose up -d identity-postgres-test
DATABASE_URL=postgresql://sapar:sapar_secret@localhost:5434/sapar_identity_test \
  npx prisma migrate dev --name init
```

### Запуск E2E тестов

```bash
DATABASE_URL=postgresql://sapar:sapar_secret@localhost:5434/sapar_identity_test \
  npm run test:e2e
```

Тесты покрывают:
1. Регистрация (успех + дубликат email → 409)
2. Логин (успех + неверный пароль → 401)
3. Refresh (ротация + невалидный старый → 401)
4. Logout (инвалидация + идемпотентность)
5. traceId == x-request-id в ошибках
6. Health / Ready

## Примеры curl

### Регистрация

```bash
curl -s -X POST http://localhost:3001/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"securepass123"}' | jq
```

### Логин

```bash
curl -s -X POST http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"securepass123"}' | jq
```

### Refresh

```bash
curl -s -X POST http://localhost:3001/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<REFRESH_TOKEN_FROM_LOGIN>"}' | jq
```

### Logout

```bash
curl -s -X POST http://localhost:3001/auth/logout \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<REFRESH_TOKEN>"}' -w "\nHTTP %{http_code}\n"
```

### Через API Gateway

```bash
curl -s -X POST http://localhost:3000/identity/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"securepass123"}' | jq
```
