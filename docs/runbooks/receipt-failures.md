# Runbook: Receipt Failures

## Алерты
- `ReceiptFailedFinalSpike` — FAILED_FINAL чеков растёт

## Симптомы
- Чеки не выдаются после успешной оплаты
- Рост `receipt_status_total{status="FAILED_FINAL"}` в метриках
- Логи payments-service: ошибки в `ReceiptWorker` или `ProcessReceiptsUseCase`

## Дашборды
1. **Payments** — Receipt Statuses, Receipt Issuer Errors

## Немедленные действия

### 1. Проверить масштаб
```bash
# Количество чеков по статусам
docker exec sapar-postgres-payments-1 psql -U postgres -d payments_db -c \
  "SELECT status, count(*) FROM receipts GROUP BY status ORDER BY status;"

# Последние FAILED_FINAL чеки
docker exec sapar-postgres-payments-1 psql -U postgres -d payments_db -c \
  "SELECT id, payment_intent_id, status, try_count, last_error, updated_at FROM receipts WHERE status = 'FAILED_FINAL' ORDER BY updated_at DESC LIMIT 10;"
```

### 2. Проверить receipt issuer
```bash
# Логи receipt worker
docker logs --tail 50 sapar-payments-service-1 | grep -i "receipt"

# Метрики внешних вызовов
curl -s http://payments-service:3003/metrics | grep 'external_call_errors_total{.*receipt'
```

### 3. Проверить конфигурацию
```bash
# Receipt retry parameters
grep RECEIPT .env.docker
# RECEIPT_RETRY_N — макс. попыток (по умолчанию 3)
# RECEIPT_BACKOFF_SEC_LIST — интервалы backoff
# RECEIPT_BATCH_SIZE — размер батча
# RECEIPT_POLL_INTERVAL_MS — интервал обработки
```

### 4. Ручной retry
```bash
# Сбросить FAILED_FINAL чеки для повторной попытки
docker exec sapar-postgres-payments-1 psql -U postgres -d payments_db -c \
  "UPDATE receipts SET status = 'PENDING', try_count = 0, next_retry_at = NOW() WHERE status = 'FAILED_FINAL' AND updated_at > NOW() - INTERVAL '2 hours';"
```

### 5. Если receipt issuer полностью недоступен
- Чеки продолжат накапливаться в PENDING
- Worker ретраит с backoff (5s, 30s, 300s)
- После RECEIPT_RETRY_N попыток → FAILED_FINAL
- Восстановление: исправить причину + сбросить FAILED_FINAL в PENDING

## Откат
- Если проблема в коде receipt issuer → откатить к предыдущей версии
- Если проблема во внешнем сервисе → ждать восстановления + ручной retry

## Эскалация
- FAILED_FINAL > 20 чеков за час → уведомить бухгалтерию / compliance
- Если receipt issuer не работает > 1 часа → рассмотреть ручную выдачу чеков
