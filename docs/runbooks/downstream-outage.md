# Runbook: Downstream Outage

## Алерты
- `GatewayHigh5xxRate` — 5xx rate на gateway > 1%
- `ServiceHigh5xxRate` — 5xx rate на конкретном сервисе > 5%
- `CircuitBreakerOpenTooLong` — CB открыт > 5 минут
- `DatabaseErrorsIncreasing` — ошибки БД растут

## Симптомы
- Рост 5xx в Grafana (dashboard: sapar-overview)
- Circuit breaker перешёл в OPEN для одного или нескольких downstream
- Логи gateway содержат `proxy_circuit_open` или `proxy_error`
- Пользователи получают 503 `DOWNSTREAM_CIRCUIT_OPEN` или 502 `DOWNSTREAM_UNAVAILABLE`

## Дашборды
1. **Sapar Overview** — общий RPS, p95, 5xx rate
2. **Gateway** — upstream errors, CB state, Redis latency
3. **Payments / Notifications** — provider errors, outbox status

## Немедленные действия

### 1. Определить затронутый сервис
```bash
# Проверить какие CB открыты
curl -s http://api-gateway:3000/metrics | grep circuit_breaker_state | grep 'state="open"'

# Проверить здоровье каждого сервиса
for svc in identity-service:3001 trips-service:3002 payments-service:3003 notifications-service:3004 admin-service:3005; do
  echo "$svc: $(curl -s -o /dev/null -w '%{http_code}' http://$svc/health)"
done
```

### 2. Проверить причину
```bash
# Логи проблемного сервиса
docker logs --tail 100 sapar-<service-name>-1

# Проверить БД
docker exec sapar-postgres-<service>-1 pg_isready

# Проверить диск и память
docker stats --no-stream
```

### 3. Попытка восстановления
```bash
# Рестарт проблемного сервиса
docker restart sapar-<service-name>-1

# Если БД недоступна — рестарт контейнера БД
docker restart sapar-postgres-<service>-1

# Проверить миграции после рестарта БД
docker exec sapar-<service>-1 npx prisma migrate deploy
```

### 4. Мониторинг восстановления
- CB автоматически перейдёт в HALF_OPEN через `CB_OPEN_DURATION_MS` (по умолчанию 10с)
- После `CB_HALF_OPEN_MAX_PROBES` успешных проб — CLOSED
- Следить за снижением 5xx rate в дашборде

## Откат
- Если проблема в новом деплое — откатить к предыдущей версии:
```bash
docker-compose up -d --force-recreate <service-name>
```
- Если проблема в миграции БД — восстановить из бэкапа:
```bash
./scripts/restore-postgres.sh <service> /path/to/backup.sql.gz
```

## Эскалация
- Если не удаётся восстановить за 15 минут — эскалация на инфраструктурного инженера
- Если затронуты платежи — уведомить продуктовую команду
