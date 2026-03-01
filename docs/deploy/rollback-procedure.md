# Rollback Procedure — Sapar

## Когда откатывать

- 5xx rate > 5% в течение 3+ минут после деплоя
- Circuit breaker в OPEN > 2 минут
- Критические ошибки в логах (DB connection, OOM, panic)
- P95 latency > 2x от baseline
- Пользователи сообщают о проблемах

## Типы отката

### 1. Быстрый откат (только код, без миграции)

Подходит когда: деплой не включал миграцию БД или миграция была expand-only.

```bash
# Шаг 1: Откатить на предыдущий образ
docker compose up -d --no-deps <service-name>
# Если используете тегированные образы:
# docker compose pull && docker compose up -d --no-deps <service-name>

# Шаг 2: Дождаться healthcheck
for i in $(seq 1 30); do
  code=$(curl -sf -o /dev/null -w '%{http_code}' "http://localhost:<port>/health" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then echo "Healthy after ${i}s"; break; fi
  sleep 1
done

# Шаг 3: Smoke-тест
./scripts/smoke.sh

# Шаг 4: Проверить дашборды
# - Sapar Overview: 5xx rate снижается
# - Gateway: CB transitions → CLOSED
```

**Время отката: ~1-2 минуты**

### 2. Откат с восстановлением БД

Подходит когда: миграция содержала contract-операции (удаление колонок/таблиц) или данные повреждены.

```bash
# Шаг 1: Остановить сервис
docker compose stop <service-name>

# Шаг 2: Найти последний бэкап ДО деплоя
ls -lt /backups/<service>/ | head -5
# Выбрать бэкап с timestamp ДО деплоя

# Шаг 3: Восстановить БД
./scripts/restore-postgres.sh <service> /backups/<service>/<pre-deploy-backup>.sql.gz

# Шаг 4: Задеплоить предыдущую версию кода
docker compose up -d --no-deps <service-name>

# Шаг 5: Smoke-тест
./scripts/smoke.sh
```

**Время отката: ~5-15 минут** (зависит от размера БД)

### 3. Полный откат стека

Крайняя мера: несколько сервисов затронуты, каскадные ошибки.

```bash
# Шаг 1: Остановить всё
docker compose down

# Шаг 2: Восстановить из бэкапов (полная процедура)
# См. docs/dr/disaster-recovery-plan.md — раздел "Полное восстановление всего стека"

# Шаг 3: Задеплоить предыдущие версии всех сервисов
docker compose up -d

# Шаг 4: Полная верификация
./scripts/smoke.sh
```

**Время отката: ~15-30 минут**

## Чеклист после отката

- [ ] Все /health и /ready возвращают 200
- [ ] 5xx rate вернулся к baseline (< 0.1%)
- [ ] P95 latency в пределах SLO
- [ ] Нет firing алертов в Prometheus
- [ ] Circuit breaker'ы в CLOSED
- [ ] Outbox events доставляются (нет роста PENDING)
- [ ] Оповестить команду об откате и причине
- [ ] Создать post-mortem issue

## Превентивные меры

1. **Всегда делайте бэкап перед деплоем**
2. **Используйте expand/contract миграции** (см. `migration-strategy.md`)
3. **Feature flags** для рискованных изменений (см. `feature-flags.md`)
4. **Canary deploy** (будущее): сначала 1 реплика, потом остальные
5. **Мониторинг во время деплоя**: держите дашборд открытым

## Decision tree

```
Проблема после деплоя?
├── Только код (нет миграции)?
│   └── Быстрый откат (#1) → ~1 мин
├── Была expand-only миграция?
│   └── Быстрый откат (#1) → ~1 мин (старый код совместим со схемой)
├── Была contract миграция?
│   └── Откат с БД (#2) → ~5-15 мин
└── Несколько сервисов затронуты?
    └── Полный откат (#3) → ~15-30 мин
```
