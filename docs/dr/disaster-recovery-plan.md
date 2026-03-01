# Disaster Recovery Plan — Sapar

## 1. RPO / RTO (MVP)

| Метрика | Целевое значение | Обоснование |
|---------|-------------------|-------------|
| **RPO** (Recovery Point Objective) | ≤ 1 час | Ежечасные бэкапы pg_dump; потеря данных — максимум последний час |
| **RTO** (Recovery Time Objective) | ≤ 30 мин | Восстановление из бэкапа + запуск миграций + smoke-тесты |

### RPO по сервисам

| Сервис | Критичность данных | RPO | Примечание |
|--------|--------------------|----|------------|
| payments | Высокая (деньги) | ≤ 15 мин | Бэкапы каждые 15 мин, WAL archiving рекомендован |
| trips (bookings) | Высокая | ≤ 1 час | Бронирования можно восстановить из payments + outbox |
| identity | Средняя | ≤ 1 час | Пароли хэшированы, токены регенерируются |
| notifications | Низкая | ≤ 4 часа | Нотификации можно переслать повторно |
| admin | Средняя | ≤ 1 час | Конфиги меняются редко |
| profiles | Низкая | ≤ 4 часа | Рейтинги пересчитываются из событий |

---

## 2. Стратегия бэкапов

### 2.1 Инструменты

- **pg_dump** — логические бэкапы (уже реализован: `scripts/backup-postgres.sh`)
- **Верификация** — восстановление во временную БД (`scripts/verify-backup.sh`)
- **Хранение** — локально `./backups/`, в продакшене — S3/GCS с lifecycle policy

### 2.2 Расписание (рекомендация)

| Сервис | Частота | Retention | Автоматизация |
|--------|---------|-----------|---------------|
| payments | каждые 15 мин | 30 дней | cron + backup-postgres.sh payments |
| trips | каждый час | 14 дней | cron + backup-postgres.sh trips |
| identity | каждый час | 14 дней | cron + backup-postgres.sh identity |
| notifications | каждые 4 часа | 7 дней | cron + backup-postgres.sh notifications |
| admin | каждые 4 часа | 7 дней | cron + backup-postgres.sh admin |
| profiles | ежедневно | 7 дней | cron + backup-postgres.sh profiles |

### 2.3 Cron-пример

```cron
# Payments — каждые 15 минут
*/15 * * * * /opt/sapar/scripts/backup-postgres.sh payments /backups/payments >> /var/log/backup-payments.log 2>&1

# Trips, Identity — каждый час
0 * * * * /opt/sapar/scripts/backup-postgres.sh trips /backups/trips >> /var/log/backup-trips.log 2>&1
5 * * * * /opt/sapar/scripts/backup-postgres.sh identity /backups/identity >> /var/log/backup-identity.log 2>&1

# Notifications, Admin — каждые 4 часа
0 */4 * * * /opt/sapar/scripts/backup-postgres.sh notifications /backups/notifications >> /var/log/backup-notifications.log 2>&1
15 */4 * * * /opt/sapar/scripts/backup-postgres.sh admin /backups/admin >> /var/log/backup-admin.log 2>&1
```

### 2.4 Ротация бэкапов

```bash
# Удаление бэкапов старше 30 дней
find /backups/payments -name "*.sql.gz" -mtime +30 -delete
# Удаление бэкапов старше 14 дней
find /backups/trips -name "*.sql.gz" -mtime +14 -delete
```

---

## 3. Процедура восстановления (step-by-step)

### 3.1 Полное восстановление одного сервиса

```bash
# Шаг 1: Остановить сервис
docker compose stop <service-name>

# Шаг 2: Найти последний бэкап
ls -lt /backups/<service>/ | head -5

# Шаг 3: Верифицировать бэкап
./scripts/verify-backup.sh <service> /backups/<service>/<file>.sql.gz

# Шаг 4: Восстановить
./scripts/restore-postgres.sh <service> /backups/<service>/<file>.sql.gz

# Шаг 5: Запустить миграции (если бэкап старше последней миграции)
docker compose exec <service-name> npx prisma migrate deploy

# Шаг 6: Запустить сервис
docker compose start <service-name>

# Шаг 7: Smoke-тест
curl -f http://localhost:<port>/health
curl -f http://localhost:<port>/ready
```

### 3.2 Полное восстановление всего стека

```bash
# 1. Остановить всё
docker compose down

# 2. Удалить volumes (если данные повреждены)
docker compose down -v

# 3. Поднять только базы данных
docker compose up -d postgres identity-postgres trips-postgres payments-postgres notifications-postgres admin-postgres profiles-postgres redis trips-redis

# 4. Дождаться healthcheck
for port in 5432 5433 5435 5437 5439 5441 5443; do
  until docker compose exec -T $(docker compose ps --format '{{.Name}}' | grep postgres | head -1) pg_isready; do sleep 1; done
done

# 5. Восстановить каждый бэкап (без интерактивного подтверждения)
for svc in identity trips payments notifications admin; do
  LATEST=$(ls -t /backups/${svc}/*.sql.gz 2>/dev/null | head -1)
  if [ -n "$LATEST" ]; then
    echo "yes" | ./scripts/restore-postgres.sh "$svc" "$LATEST"
  fi
done

# 6. Поднять все сервисы
docker compose up -d

# 7. Smoke-тест
./scripts/smoke.sh
```

---

## 4. Процедура верификации после восстановления

### 4.1 Smoke-тесты

```bash
# Автоматический smoke всех сервисов
./scripts/smoke.sh

# Ожидаемый результат: все /health и /ready возвращают 200
```

### 4.2 Проверка целостности данных

```bash
# Количество таблиц в каждой БД
for svc in identity trips payments notifications admin; do
  CONTAINER="${svc}-postgres"
  DB="sapar_${svc}"
  count=$(docker compose exec -T "$CONTAINER" psql -U sapar -d "$DB" -t -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")
  echo "${svc}: $(echo $count | tr -d ' ') tables"
done

# Проверить Prisma migrations
for svc in identity trips payments notifications admin; do
  CONTAINER="${svc}-postgres"
  DB="sapar_${svc}"
  count=$(docker compose exec -T "$CONTAINER" psql -U sapar -d "$DB" -t -c \
    "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;" 2>/dev/null || echo "N/A")
  echo "${svc}: $(echo $count | tr -d ' ') migrations applied"
done
```

### 4.3 Функциональная проверка

| Проверка | Команда | Ожидание |
|----------|---------|----------|
| Gateway проксирует | `curl http://localhost:3000/health` | 200 |
| Авторизация работает | `curl -X POST http://localhost:3000/api/v1/auth/login -d '...'` | 200/401 |
| Поиск поездок | `curl http://localhost:3000/api/v1/trips?from=A&to=B` | 200 |
| Метрики доступны | `curl http://localhost:3000/metrics` | 200, содержит `http_requests_total` |

### 4.4 Проверка Grafana

1. Открыть `http://localhost:3100`
2. Dashboard → Sapar Overview → убедиться что метрики поступают
3. Проверить что нет active alerts (Alerting → Alert rules)

---

## 5. Плейбук: расхождение состояний payment/booking

### Симптомы

- Бронирование в статусе `PENDING_PAYMENT`, но payment intent в `HOLD_PLACED`
- Payment в `CAPTURED`, но бронирование не `CONFIRMED`
- Пользователь списал деньги, но билет не подтвердился

### Диагностика

```bash
# 1. Проверить состояние бронирования
docker compose exec trips-postgres psql -U sapar -d sapar_trips -c \
  "SELECT id, status, updated_at FROM bookings WHERE id = '<booking-id>';"

# 2. Проверить payment intent
docker compose exec payments-postgres psql -U sapar -d sapar_payments -c \
  "SELECT id, status, booking_id, updated_at FROM payment_intents WHERE booking_id = '<booking-id>';"

# 3. Проверить outbox на обоих сервисах
docker compose exec trips-postgres psql -U sapar -d sapar_trips -c \
  "SELECT id, type, status, attempts, last_error FROM outbox_events WHERE payload::text LIKE '%<booking-id>%' ORDER BY created_at DESC;"

docker compose exec payments-postgres psql -U sapar -d sapar_payments -c \
  "SELECT id, type, status, attempts, last_error FROM outbox_events WHERE payload::text LIKE '%<booking-id>%' ORDER BY created_at DESC;"
```

### Сценарии и действия

#### A) Outbox event застрял (status = FAILED_FINAL)

```bash
# Сбросить статус для повторной доставки
docker compose exec payments-postgres psql -U sapar -d sapar_payments -c \
  "UPDATE outbox_events SET status = 'PENDING', attempts = 0, last_error = NULL WHERE id = '<event-id>';"
```

#### B) Payment прошёл, но бронирование не обновилось

```bash
# Вручную обновить бронирование (крайняя мера — только SRE)
docker compose exec trips-postgres psql -U sapar -d sapar_trips -c \
  "UPDATE bookings SET status = 'CONFIRMED', updated_at = NOW() WHERE id = '<booking-id>';"

# Или переслать событие вручную
curl -X POST http://localhost:3002/internal/events \
  -H "Content-Type: application/json" \
  -H "X-Event-Signature: sha256=<computed-hmac>" \
  -d '{"eventId":"manual-fix-001","type":"payment.intent.hold_placed","payload":{"paymentIntentId":"<pi-id>","bookingId":"<booking-id>"}}'
```

#### C) Деньги списаны, бронирование отменено → нужен рефанд

```bash
# Проверить что рефанд не был уже инициирован
docker compose exec payments-postgres psql -U sapar -d sapar_payments -c \
  "SELECT * FROM payment_intents WHERE booking_id = '<booking-id>';"

# Если рефанд не создан — обратиться к PSP через админку или вручную
# Создать запись о рефанде для аудита
```

### Превентивные меры

1. **Мониторинг outbox**: алерт `OutboxFailedFinalIncreasing` реагирует на застрявшие события
2. **Идемпотентность**: все event consumers используют `eventId` для дедупликации
3. **Reconciliation job** (рекомендация): периодическая сверка bookings ↔ payment_intents
