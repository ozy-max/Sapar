# Release Verification Checklist — Sapar

## Автоматическая верификация

```bash
# Запустить после каждого деплоя
./scripts/smoke.sh
```

## SLO дашборды и ключевые метрики

### 1. Sapar Overview (`grafana/d/sapar-overview`)

| Метрика | SLO | Алерт |
|---------|-----|-------|
| Gateway 5xx rate | < 1% | `GatewayHigh5xxRate` |
| Per-service 5xx rate | < 5% | `ServiceHigh5xxRate` |
| Gateway p95 latency | < 1000ms | `GatewayP95LatencyHigh` |
| Per-service p95 latency | < 2000ms | `ServiceP95LatencyHigh` |

### 2. Gateway (`grafana/d/gateway`)

| Метрика | Норма | Алерт |
|---------|-------|-------|
| Circuit breaker state | Все CLOSED | `CircuitBreakerOpenTooLong`, `CircuitBreakerOpenSpike` |
| Redis error rate | 0 | `RedisErrorsHigh` |
| Upstream error rate per service | < 1% | Виден на дашборде |

### 3. Payments (`grafana/d/payments`)

| Метрика | Норма | Алерт |
|---------|-------|-------|
| PSP call error rate | < 1% | `PSPCallErrorsHigh` |
| Receipt FAILED_FINAL | 0 за 15 мин | `ReceiptFailedFinalSpike` |
| Outbox FAILED_FINAL | 0 за 15 мин | `OutboxFailedFinalIncreasing` |

### 4. Notifications (`grafana/d/notifications`)

| Метрика | Норма | Алерт |
|---------|-------|-------|
| Notification FAILED_FINAL | < 5 за 15 мин | `NotificationFailedFinalSpike` |
| Outbox delivery errors | < 0.5/s | `OutboxDeliveryErrorsHigh` |

### 5. Database

| Метрика | Норма | Алерт |
|---------|-------|-------|
| DB error rate | 0 | `DatabaseErrorsIncreasing` |
| DB p95 query latency | < 500ms | `DatabaseQueryLatencyHigh` |

## Smoke-эндпоинты

| Сервис | Health | Ready | Metrics |
|--------|--------|-------|---------|
| api-gateway | `http://localhost:3000/health` | `http://localhost:3000/ready` | `http://localhost:3000/metrics` |
| identity-service | `http://localhost:3001/health` | `http://localhost:3001/ready` | `http://localhost:3001/metrics` |
| trips-service | `http://localhost:3002/health` | `http://localhost:3002/ready` | `http://localhost:3002/metrics` |
| payments-service | `http://localhost:3003/health` | `http://localhost:3003/ready` | `http://localhost:3003/metrics` |
| notifications-service | `http://localhost:3004/health` | `http://localhost:3004/ready` | `http://localhost:3004/metrics` |
| admin-service | `http://localhost:3005/health` | `http://localhost:3005/ready` | `http://localhost:3005/metrics` |
| profiles-service | `http://localhost:3006/health` | `http://localhost:3006/ready` | `http://localhost:3006/metrics` |

## Ручная верификация (release checklist)

### Обязательно

- [ ] `./scripts/smoke.sh` — все 200
- [ ] Grafana Sapar Overview — нет 5xx spike
- [ ] Prometheus Alerts — нет firing rules
- [ ] `docker compose logs --tail 20 <service>` — нет ERROR

### При изменении API

- [ ] OpenAPI schema обновлена
- [ ] Backward-compatible (старые клиенты работают)
- [ ] Postman / curl проверка затронутых эндпоинтов

### При миграции БД

- [ ] `npx prisma migrate deploy` прошла без ошибок
- [ ] Количество таблиц и миграций корректное (проверка через psql)
- [ ] Данные не потерялись (spot check через SQL)

### При изменении конфигов

- [ ] JSON-конфиги в admin-service валидны
- [ ] Сервисы подхватили новый конфиг (проверить логи или GET `/internal/config/<ns>`)

## Таймлайн верификации

| Время после деплоя | Действие |
|--------------------|----------|
| 0-1 мин | smoke.sh, проверить логи |
| 1-5 мин | Grafana dashboards, алерты |
| 5-15 мин | Наблюдать за трендами (latency, error rate) |
| 15-30 мин | Если всё стабильно — деплой завершён |
| 1 час | Финальная проверка, закрыть deployment issue |
