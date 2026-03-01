# Runbook: PSP Failures

## Алерты
- `PSPCallErrorsHigh` — rate ошибок вызовов PSP > 0.1/s
- `CircuitBreakerOpenTooLong` (target=PSP) — CB для PSP открыт > 5 мин

## Симптомы
- Бронирования застревают в статусе `PENDING_PAYMENT` — hold не размещается
- Рост `external_call_errors_total{provider="psp"}` в метриках
- CB `PSP` в состоянии OPEN → все вызовы PSP fast-fail
- Логи payments-service: ошибки `CircuitOpenError` или таймауты PSP

## Дашборды
1. **Payments** — PSP Latency, PSP Errors, CB State
2. **Sapar Overview** — booking confirmed rate

## Немедленные действия

### 1. Проверить состояние PSP
```bash
# Метрики PSP circuit breaker
curl -s http://payments-service:3003/metrics | grep circuit_breaker_state

# Последние ошибки в логах
docker logs --tail 50 sapar-payments-service-1 | grep -i "psp\|circuit"
```

### 2. Проверить конфигурацию
```bash
# PSP_TIMEOUT_MS — таймаут вызовов PSP (по умолчанию 5000ms)
grep PSP_TIMEOUT_MS .env.docker

# Если используется FakePspAdapter (dev) — проверить его режим
docker exec sapar-payments-service-1 env | grep PSP
```

### 3. При таймаутах PSP
```bash
# Увеличить таймаут временно (если проблема в медленном ответе)
# В .env.docker: PSP_TIMEOUT_MS=10000
docker-compose up -d payments-service
```

### 4. При полной недоступности PSP
- CB автоматически перейдёт в HALF_OPEN через 30с (PSP openDurationMs=30000)
- Новые бронирования будут создаваться, но оплата не пройдёт
- Outbox будет ретраить delivery для событий, связанных с платежами
- **Reconciliation worker** каждые 5 мин сверяет статусы — исправит расхождения после восстановления

### 5. Мониторинг восстановления
```bash
# Проверить что CB закрылся
curl -s http://payments-service:3003/metrics | grep 'circuit_breaker_state{.*target="PSP".*state="closed"}'
```

## Откат
- Если PSP endpoint изменился — обновить конфигурацию и перезапустить
- Если проблема в нашем коде после деплоя — откатить к предыдущей версии
- В крайнем случае: приостановить приём новых бронирований через admin конфиг

## Эскалация
- Если PSP недоступен > 30 мин — связаться с PSP-провайдером
- Уведомить продуктовую команду о невозможности приёма платежей
