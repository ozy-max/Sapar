#!/usr/bin/env bash
set -euo pipefail

# Verify a Postgres backup by restoring it into a temporary database
# and running basic checks (table existence, row counts).
#
# Usage: ./scripts/verify-backup.sh <service> <backup-file>
#
# Example:
#   ./scripts/verify-backup.sh trips ./backups/trips_20260301_120000.sql.gz

SERVICE="${1:?Usage: verify-backup.sh <service> <backup-file>}"
BACKUP_FILE="${2:?Usage: verify-backup.sh <service> <backup-file>}"

CONTAINER="sapar-postgres-${SERVICE}-1"
TEMP_DB="${SERVICE}_verify_$(date +%s)"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "[ERROR] Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

if ! docker inspect "$CONTAINER" &>/dev/null; then
  echo "[ERROR] Container not found: ${CONTAINER}"
  exit 1
fi

cleanup() {
  echo ">>> Cleaning up temporary database ${TEMP_DB}..."
  docker exec "$CONTAINER" psql -U postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEMP_DB}' AND pid <> pg_backend_pid();" \
    2>/dev/null || true
  docker exec "$CONTAINER" psql -U postgres -c "DROP DATABASE IF EXISTS \"${TEMP_DB}\";" 2>/dev/null || true
}

trap cleanup EXIT

echo "================================================================="
echo "  VERIFY BACKUP"
echo "  Service:   ${SERVICE}"
echo "  Backup:    ${BACKUP_FILE}"
echo "  Temp DB:   ${TEMP_DB}"
echo "================================================================="
echo ""

echo ">>> Creating temporary database..."
docker exec "$CONTAINER" psql -U postgres -c "CREATE DATABASE \"${TEMP_DB}\";"

echo ">>> Restoring backup into temp database..."
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER" psql -U postgres -d "$TEMP_DB" 2>&1 | tail -5
else
  docker exec -i "$CONTAINER" psql -U postgres -d "$TEMP_DB" < "$BACKUP_FILE" 2>&1 | tail -5
fi

echo ""
echo ">>> Checking tables..."
TABLES=$(docker exec "$CONTAINER" psql -U postgres -d "$TEMP_DB" -t -c \
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;")

TABLE_COUNT=$(echo "$TABLES" | grep -c '\S' || true)
echo "  Found ${TABLE_COUNT} table(s):"
echo "$TABLES" | while read -r tbl; do
  tbl=$(echo "$tbl" | tr -d ' ')
  [ -z "$tbl" ] && continue
  ROWS=$(docker exec "$CONTAINER" psql -U postgres -d "$TEMP_DB" -t -c "SELECT count(*) FROM \"${tbl}\";")
  echo "    ${tbl}: $(echo "$ROWS" | tr -d ' ') rows"
done

echo ""
echo ">>> Checking Prisma migrations table..."
MIGRATION_COUNT=$(docker exec "$CONTAINER" psql -U postgres -d "$TEMP_DB" -t -c \
  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;" 2>/dev/null || echo "0")
echo "  Applied migrations: $(echo "$MIGRATION_COUNT" | tr -d ' ')"

echo ""

if [ "$TABLE_COUNT" -gt 0 ]; then
  echo "[OK] Backup verification PASSED"
  echo "  - ${TABLE_COUNT} tables restored"
  echo "  - $(echo "$MIGRATION_COUNT" | tr -d ' ') migrations applied"
else
  echo "[FAIL] Backup verification FAILED — no tables found"
  exit 1
fi
