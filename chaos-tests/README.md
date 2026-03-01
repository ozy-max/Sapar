# Chaos Tests — Sapar

Автоматизированный набор сценариев отказоустойчивости для локального запуска поверх `docker-compose.yml`.

## Быстрый старт

```bash
# 1. Поднять стек
docker compose up -d --build

# 2. Дождаться healthcheck'ов
./scripts/smoke.sh

# 3. Запустить все сценарии
./scripts/chaos-run.sh

# 4. Или один конкретный сценарий
bash chaos-tests/scenarios/a-downstream-down.sh
```

## Сценарии

| ID | Файл | Описание | Что доказывает |
|----|-------|----------|----------------|
| A | `a-downstream-down.sh` | Остановка payments / notifications | Graceful degradation, circuit breaker, outbox буферизация |
| B | `b-database-down.sh` | Остановка trips-postgres | Blast radius containment, /ready отражает состояние БД |
| C | `c-redis-down.sh` | Остановка redis / trips-redis | Rate limiter fail-open/closed, cache fallback |
| D | `d-slow-network.sh` | Задержка 4000ms на payments | Таймауты, backoff, нет request storm |
| E | `e-duplicate-events.sh` | Повторная отправка событий | Идемпотентность event consumers |

## Структура сценария

Каждый сценарий следует паттерну:

1. **Baseline** — проверить что система здорова
2. **Inject** — внести отказ (`docker compose stop`, `tc netem`, повторная отправка)
3. **Validate** — проверить ожидаемое поведение (curl + assert)
4. **Restore** — вернуть систему в нормальное состояние
5. **Verify recovery** — проверить что всё восстановилось

## Предварительные условия

- Docker / Docker Compose v2+
- Стек поднят через `docker compose up -d`
- `.env.docker` настроен (см. `.env.docker.example`)
- Для сценария D (tc netem): контейнеры должны иметь `cap_add: [NET_ADMIN]` (опционально, есть fallback)

### Включение tc netem для сценария D

Добавить в `docker-compose.override.yml`:

```yaml
services:
  payments-service:
    cap_add:
      - NET_ADMIN
```

## Ожидаемые алерты

| Сценарий | Алерты Prometheus |
|----------|-------------------|
| A | `CircuitBreakerOpenSpike`, `ServiceHigh5xxRate`, `OutboxDeliveryErrorsHigh` |
| B | `DatabaseErrorsIncreasing`, `ServiceHigh5xxRate`, `CircuitBreakerOpenSpike` |
| C | `RedisErrorsHigh` |
| D | `GatewayP95LatencyHigh`, `PSPCallErrorsHigh`, `CircuitBreakerOpenSpike` |
| E | Нет (идемпотентность обрабатывает тихо) |

## Дашборды Grafana

Во время chaos-тестов проверяйте:

- **Sapar Overview** (`grafana/d/sapar-overview`) — общий RPS, p95, error rate
- **Gateway** (`grafana/d/gateway`) — CB state, upstream errors, Redis latency
- **Payments** (`grafana/d/payments`) — PSP errors, receipt status, outbox
- **Notifications** (`grafana/d/notifications`) — delivery status, failed_final
