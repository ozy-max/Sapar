# Sapar — API Gateway

Public edge service for the Sapar ride-sharing platform.  
Routes, authenticates, rate-limits and aggregates requests for downstream services.

## Prerequisites

- Node.js 20 LTS
- Docker & Docker Compose

## Environment variables

| Variable       | Required | Default       | Description                        |
| -------------- | -------- | ------------- | ---------------------------------- |
| `PORT`         | no       | `3000`        | HTTP listen port                   |
| `DATABASE_URL` | **yes**  | —             | PostgreSQL connection string       |
| `NODE_ENV`     | no       | `development` | `development` / `production` / `test` |
| `LOG_LEVEL`    | no       | `info`        | Pino log level (`debug`, `info`, …) |

## Run with Docker Compose (recommended)

From the **repository root**:

```bash
docker compose up --build
```

This starts PostgreSQL and the API Gateway automatically.

- API: http://localhost:3000
- Swagger UI: http://localhost:3000/swagger

## Run locally (without Docker)

1. Start a PostgreSQL instance (e.g. via `docker compose up postgres`).

2. Copy the env template and adjust if needed:

```bash
cd services/api-gateway
cp .env.example .env
```

3. Install dependencies & generate the Prisma client:

```bash
npm install
npx prisma generate
```

4. Start in dev mode:

```bash
npm run start:dev
```

## Health checks

### Liveness — `GET /health`

Always returns `200` if the process is running.

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### Readiness — `GET /ready`

Returns `200` when the database is reachable, otherwise `503`.

```bash
curl -i http://localhost:3000/ready
# 200 {"status":"ready"}

# If DB is down:
# 503 {"code":"SERVICE_UNAVAILABLE","message":"Database is not reachable","traceId":"<uuid>"}
```

## Unified error format

Every error response follows this shape:

```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable description",
  "details": {},
  "traceId": "x-request-id uuid"
}
```

The `traceId` equals the `x-request-id` header (generated per request or forwarded from the client).
