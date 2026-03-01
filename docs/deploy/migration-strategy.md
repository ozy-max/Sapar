# Migration Strategy — Sapar

## Принцип: Expand / Contract

Все миграции БД выполняются в два этапа:

1. **Expand** — добавить новую структуру, не трогая существующую
2. **Contract** — удалить старую структуру после того, как весь код переведён на новую

Это обеспечивает **backward compatibility** и возможность **отката** на предыдущую версию кода.

## Правила backward compatibility

### МОЖНО делать в одном деплое

| Операция | Пример | Безопасно? |
|----------|--------|------------|
| Добавить nullable колонку | `ALTER TABLE ADD COLUMN foo TEXT` | Да |
| Добавить таблицу | `CREATE TABLE new_table (...)` | Да |
| Добавить индекс (CONCURRENTLY) | `CREATE INDEX CONCURRENTLY ...` | Да |
| Расширить ENUM | `ALTER TYPE status ADD VALUE 'new_status'` | Да |
| Добавить default value | `ALTER TABLE ALTER COLUMN SET DEFAULT` | Да |

### НЕЛЬЗЯ делать в одном деплое

| Операция | Почему опасно | Правильный подход |
|----------|---------------|-------------------|
| Удалить колонку | Старый код читает её | Expand: добавить новую → Contract: удалить старую |
| Переименовать колонку | Старый код использует старое имя | Expand: добавить + trigger → Contract: удалить |
| Изменить тип колонки | Несовместимость типов | Expand: новая колонка → backfill → Contract |
| Удалить таблицу | Старый код обращается к ней | Contract в отдельном деплое |
| NOT NULL без default | INSERT из старого кода упадёт | Добавить с DEFAULT, потом ALTER |

## Пример: переименование колонки

### Деплой 1 (Expand)

```sql
-- Prisma migration: add new column
ALTER TABLE trips ADD COLUMN departure_city TEXT;

-- Backfill data from old column
UPDATE trips SET departure_city = from_city WHERE departure_city IS NULL;

-- Add trigger for sync during transition period
CREATE OR REPLACE FUNCTION sync_departure_city() RETURNS trigger AS $$
BEGIN
  NEW.departure_city := NEW.from_city;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_departure_city
  BEFORE INSERT OR UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION sync_departure_city();
```

Код v2 читает `departure_city`. Код v1 (если откат) продолжает читать `from_city`.

### Деплой 2 (Contract)

```sql
-- Удалить trigger
DROP TRIGGER IF EXISTS trg_sync_departure_city ON trips;
DROP FUNCTION IF EXISTS sync_departure_city();

-- Удалить старую колонку
ALTER TABLE trips DROP COLUMN from_city;
```

## Prisma-специфичные правила

### Миграции в CI

CI шаг `check-migrations.sh` проверяет что при изменении `schema.prisma` есть соответствующая миграция.

### Безопасный workflow

```bash
# 1. Изменить schema.prisma
# 2. Создать миграцию
npx prisma migrate dev --name add_departure_city

# 3. Проверить SQL в migration.sql — убедиться что нет breaking changes
cat prisma/migrations/*/migration.sql

# 4. Тестирование
npx prisma migrate deploy  # применить на тестовой БД
npm run test:e2e            # проверить что код работает

# 5. В продакшене
docker compose exec <service> npx prisma migrate deploy
```

### Откат миграции

Prisma не поддерживает `migrate down`. Для отката:

```bash
# 1. Восстановить из бэкапа
./scripts/restore-postgres.sh <service> /backups/<latest>.sql.gz

# 2. Пометить миграцию как "rolled back" (для Prisma tracking)
docker compose exec <service>-postgres psql -U sapar -d sapar_<service> -c \
  "DELETE FROM _prisma_migrations WHERE migration_name = '<migration_folder_name>';"

# 3. Задеплоить предыдущую версию кода
```

## Чеклист перед миграцией

- [ ] Миграция содержит только **expand** операции (или это явный contract после полного перехода)
- [ ] SQL проверен вручную (`cat prisma/migrations/*/migration.sql`)
- [ ] Бэкап создан (`./scripts/backup-postgres.sh <service>`)
- [ ] E2E тесты проходят с новой миграцией
- [ ] Откат проверен: предыдущая версия кода работает с новой схемой
- [ ] Для больших таблиц: индексы создаются CONCURRENTLY, ALTER выполняется без блокировок
