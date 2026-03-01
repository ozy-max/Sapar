# Rolling Upgrade Checklist — Sapar

## Порядок деплоя сервисов

Зависимости между сервисами определяют безопасный порядок обновления.
Всегда обновляйте **снизу вверх** по графу зависимостей:

```
1. admin-service          (нет зависимостей от других сервисов)
2. profiles-service       (нет зависимостей от других сервисов)
3. identity-service       (зависит от admin-service для конфигов)
4. notifications-service  (принимает события от payments)
5. payments-service       (принимает события от trips, шлёт в notifications)
6. trips-service          (принимает события от payments, шлёт в payments)
7. api-gateway            (проксирует ко всем, обновлять последним)
```

## Pre-deploy checklist

- [ ] Все тесты CI проходят (unit, e2e, lint, typecheck)
- [ ] Docker образ собран и протегирован (`sapar/<service>:<sha>`)
- [ ] Миграции БД подготовлены по стратегии expand/contract (см. `migration-strategy.md`)
- [ ] Feature flags настроены для новой функциональности (см. `feature-flags.md`)
- [ ] Бэкап БД создан **перед** деплоем:
  ```bash
  ./scripts/backup-postgres.sh <service>
  ```
- [ ] Runbook для отката прочитан (см. `rollback-procedure.md`)
- [ ] Оповещение команды в чате о начале деплоя

## Процедура деплоя (docker-compose)

### Один сервис

```bash
# 1. Бэкап
./scripts/backup-postgres.sh <service-name>

# 2. Применить миграции (если есть)
docker compose exec <service-name> npx prisma migrate deploy

# 3. Обновить образ и пересоздать контейнер
docker compose up -d --no-deps --build <service-name>

# 4. Дождаться healthcheck
until curl -sf http://localhost:<port>/health > /dev/null; do sleep 2; done

# 5. Проверить /ready
curl -f http://localhost:<port>/ready

# 6. Smoke-тест
./scripts/smoke.sh
```

### Весь стек (rolling)

```bash
# 1. Бэкапы всех БД
./scripts/backup-postgres.sh

# 2. Обновить по порядку
for svc in admin-service profiles-service identity-service notifications-service payments-service trips-service api-gateway; do
  echo "=== Deploying ${svc} ==="
  docker compose up -d --no-deps --build "$svc"
  sleep 10
  ./scripts/smoke.sh
  echo "=== ${svc} deployed ==="
done
```

## Post-deploy verification

- [ ] `./scripts/smoke.sh` проходит (все /health и /ready — 200)
- [ ] Grafana: Sapar Overview — нет спайков 5xx
- [ ] Grafana: Gateway — CB все в CLOSED
- [ ] Grafana: p95 latency в пределах нормы
- [ ] Prometheus: нет firing алертов
- [ ] Логи: нет ERROR/FATAL в последних 50 строках каждого сервиса:
  ```bash
  for svc in api-gateway identity-service trips-service payments-service notifications-service admin-service; do
    echo "=== ${svc} ==="
    docker compose logs --tail 50 "$svc" 2>&1 | grep -i "error\|fatal" || echo "  [clean]"
  done
  ```
- [ ] Функциональный тест (если есть staging):
  - Логин/регистрация
  - Поиск поездок
  - Создание бронирования (если тестовая среда)

## Zero-downtime tips

1. **Healthcheck grace period**: `start_period: 20s` в docker-compose даёт время на прогрев
2. **Graceful shutdown**: NestJS обрабатывает SIGTERM, завершает текущие запросы
3. **Connection draining**: gateway перестаёт отправлять трафик к остановленному upstream через CB
4. **Outbox resilience**: если сервис перезапускается, outbox worker продолжит доставку при следующем цикле
