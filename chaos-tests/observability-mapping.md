# Observability Mapping — Chaos Tests

Привязка каждого chaos-сценария к дашбордам Grafana и alert rules Prometheus.

## Как использовать

1. Перед запуском chaos-теста откройте соответствующие дашборды
2. Запустите сценарий
3. Убедитесь, что указанные алерты сработали (или метрики изменились)
4. После восстановления — алерты должны resolve

## Сценарий A: Downstream service down

### A1: payments-service down

| Что наблюдать | Где | Ожидание |
|---------------|-----|----------|
| Circuit breaker → OPEN | Gateway dashboard, панель "CB State" | `circuit_breaker_state{target="payments-service",state="open"} == 1` |
| 5xx rate растёт | Sapar Overview, панель "Error Rate" | `ServiceHigh5xxRate` для payments |
| Upstream errors | Gateway dashboard, панель "Upstream Errors" | Рост ошибок к payments |
| Outbox backlog (trips→payments) | Payments dashboard | `OutboxDeliveryErrorsHigh` на trips-service |

**Алерты Prometheus:**
- `CircuitBreakerOpenSpike` — CB открывается
- `CircuitBreakerOpenTooLong` — если payments не вернётся > 5 мин
- `ServiceHigh5xxRate` — 5xx на payments > 5%
- `OutboxDeliveryErrorsHigh` — trips не может доставить события в payments

### A2: notifications-service down

| Что наблюдать | Где | Ожидание |
|---------------|-----|----------|
| CB → OPEN для notifications | Gateway dashboard | CB state = open |
| Outbox backlog на payments | Payments dashboard | pending events растут |
| Booking flow работает | Sapar Overview | trips-service 2xx rate стабильна |

**Алерты Prometheus:**
- `CircuitBreakerOpenSpike`
- `OutboxDeliveryErrorsHigh` (payments → notifications)
- `OutboxBacklogGrowing` (новый алерт)

---

## Сценарий B: Database down (trips-postgres)

| Что наблюдать | Где | Ожидание |
|---------------|-----|----------|
| DB errors spike | Sapar Overview, "DB Errors" | `DatabaseErrorsIncreasing` для trips |
| DB connection errors | Sapar Overview | `DatabaseConnectionErrorsSpike` для trips |
| trips-service 5xx | Sapar Overview | `ServiceHigh5xxRate` для trips |
| CB → OPEN на gateway | Gateway dashboard | CB для trips-service открыт |
| Другие сервисы OK | Sapar Overview | identity, payments, notifications — 0 errors |

**Алерты Prometheus:**
- `DatabaseErrorsIncreasing` — ошибки БД trips растут
- `DatabaseConnectionErrorsSpike` — connection errors
- `ServiceHigh5xxRate` — 5xx на trips > 5%
- `CircuitBreakerOpenSpike` — gateway CB для trips

---

## Сценарий C: Redis down

| Что наблюдать | Где | Ожидание |
|---------------|-----|----------|
| Redis errors | Gateway dashboard, "Redis" | `RedisErrorsHigh` |
| Redis connection errors | Gateway dashboard | `RedisConnectionErrorsSpike` |
| Rate limiter behavior | Gateway dashboard, "Rate Limit" | Зависит от fail-open/fail-closed |
| Gateway RPS | Sapar Overview | Может упасть при fail-closed |

**Алерты Prometheus:**
- `RedisErrorsHigh` — Redis ошибки > 10 за 5 мин
- `RedisConnectionErrorsSpike` — connection errors

---

## Сценарий D: Slow network / timeouts

| Что наблюдать | Где | Ожидание |
|---------------|-----|----------|
| P95 latency spike | Sapar Overview, "Latency" | `GatewayP95LatencyHigh` |
| Per-service latency | Sapar Overview | `ServiceP95LatencyHigh` для payments |
| PSP errors (если задержка на PSP) | Payments dashboard | `PSPCallErrorsHigh` |
| CB open | Gateway dashboard | `CircuitBreakerOpenSpike` |
| Request rate stable | Sapar Overview, "RPS" | Нет storm (RPS не удваивается) |

**Алерты Prometheus:**
- `GatewayP95LatencyHigh` — p95 > 1000ms
- `ServiceP95LatencyHigh` — p95 > 2000ms
- `PSPCallErrorsHigh` — если задержка затрагивает PSP calls
- `CircuitBreakerOpenSpike` — CB открывается из-за таймаутов

---

## Сценарий E: Duplicate event delivery

| Что наблюдать | Где | Ожидание |
|---------------|-----|----------|
| Event processing | Per-service logs | Duplicate detected, skipped |
| No error spike | Sapar Overview | 5xx rate не растёт |
| Outbox metrics stable | Payments / Notifications dashboards | Нет аномалий |

**Алерты Prometheus:**
- Никакие алерты НЕ должны сработать (идемпотентность обрабатывает тихо)

---

## Сводная таблица алертов

| Alert Rule | A1 | A2 | B | C | D | E |
|-----------|----|----|---|---|---|---|
| `GatewayHigh5xxRate` | | | | | ● | |
| `ServiceHigh5xxRate` | ● | | ● | | | |
| `GatewayP95LatencyHigh` | | | | | ● | |
| `ServiceP95LatencyHigh` | | | | | ● | |
| `CircuitBreakerOpenTooLong` | ● | ● | ● | | ● | |
| `CircuitBreakerOpenSpike` | ● | ● | ● | | ● | |
| `OutboxFailedFinalIncreasing` | | ● | | | | |
| `OutboxDeliveryErrorsHigh` | ● | ● | | | | |
| `OutboxBacklogGrowing` | | ● | | | | |
| `DatabaseErrorsIncreasing` | | | ● | | | |
| `DatabaseConnectionErrorsSpike` | | | ● | | | |
| `DatabaseQueryLatencyHigh` | | | | | | |
| `RedisErrorsHigh` | | | | ● | | |
| `RedisConnectionErrorsSpike` | | | | ● | | |
| `ReceiptFailedFinalSpike` | ● | | | | | |
| `PSPCallErrorsHigh` | | | | | ● | |
| `NotificationFailedFinalSpike` | | ● | | | | |
