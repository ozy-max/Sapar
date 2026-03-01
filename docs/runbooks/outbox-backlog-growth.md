# Runbook: Outbox Backlog Growth

## Алерты
- `OutboxFailedFinalIncreasing` — FAILED_FINAL события растут
- `OutboxDeliveryErrorsHigh` — delivery errors > 0.5/s

## Симптомы
- События не доставляются между сервисами
- Booking saga застревает (бронирование не подтверждается)
- Рост `outbox_event_total{status="failed_final"}` или `outbox_event_total{status="failed_retry"}`
- CB для outbox delivery в OPEN

## Дашборды
1. **Sapar Overview** — booking confirmed rate
2. **Payments** — outbox delivery errors, outbox event statuses

## Немедленные действия

### 1. Определить масштаб проблемы
```bash
# Проверить PENDING и FAILED события в каждой БД
for db in trips payments notifications admin; do
  echo "=== $db ==="
  docker exec sapar-postgres-${db}-1 psql -U postgres -d ${db}_db -c \
    "SELECT status, count(*) FROM outbox_events GROUP BY status ORDER BY status;"
done
```

### 2. Проверить целевые сервисы
```bash
# Здоровье сервисов
for svc in trips-service:3002 payments-service:3003 notifications-service:3004; do
  echo "$svc: $(curl -s -o /dev/null -w '%{http_code}' http://$svc/health)"
done

# Проверить CB на outbox workers
for svc in trips-service:3002 payments-service:3003 notifications-service:3004 admin-service:3005; do
  echo "=== $svc ==="
  curl -s http://$svc/metrics | grep circuit_breaker_state | grep 'state="open"'
done
```

### 3. Если целевой сервис недоступен
- Решить проблему целевого сервиса (см. runbook downstream-outage.md)
- После восстановления outbox автоматически доставит FAILED_RETRY события
- CB перейдёт в HALF_OPEN → CLOSED

### 4. Ручной retry для FAILED_FINAL событий
```bash
# Сбросить FAILED_FINAL в PENDING для повторной доставки
docker exec sapar-postgres-<service>-1 psql -U postgres -d <service>_db -c \
  "UPDATE outbox_events SET status = 'PENDING', try_count = 0, next_retry_at = NOW() WHERE status = 'FAILED_FINAL' AND created_at > NOW() - INTERVAL '1 hour';"
```

### 5. Проверить OUTBOX_TARGETS конфигурацию
```bash
# Убедиться что URL-ы правильные
grep OUTBOX_TARGETS .env.docker
```

## Откат
- Если backlog вызван некорректным event payload → исправить код и передеплоить producer
- Если consumer сломан → откатить consumer к предыдущей версии

## Эскалация
- FAILED_FINAL > 50 событий → эскалация, проверка консистентности данных
- Booking saga сломана → уведомить пользователей, приостановить бронирования
