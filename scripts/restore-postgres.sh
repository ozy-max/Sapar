#!/usr/bin/env bash
set -euo pipefail

# Restore a Postgres backup for a Sapar service.
# Usage: ./scripts/restore-postgres.sh <service> <backup-file>
#
# Example:
#   ./scripts/restore-postgres.sh trips ./backups/trips_20260301_120000.sql.gz
#
# Safety:
#   - Asks for confirmation before restoring
#   - Terminates existing connections before restore
#   - Supports both .sql.gz and .sql files

SERVICE="${1:?Usage: restore-postgres.sh <service> <backup-file>}"
BACKUP_FILE="${2:?Usage: restore-postgres.sh <service> <backup-file>}"

CONTAINER="sapar-postgres-${SERVICE}-1"
DB="${SERVICE}_db"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "[ERROR] Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

if ! docker inspect "$CONTAINER" &>/dev/null; then
  echo "[ERROR] Container not found: ${CONTAINER}"
  exit 1
fi

echo "================================================================="
echo "  RESTORE POSTGRES BACKUP"
echo "  Service:   ${SERVICE}"
echo "  Container: ${CONTAINER}"
echo "  Database:  ${DB}"
echo "  Backup:    ${BACKUP_FILE}"
echo "================================================================="
echo ""
echo "WARNING: This will DROP and recreate the database."
echo ""
read -r -p "Type 'yes' to confirm: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

echo ""
echo ">>> Terminating existing connections..."
docker exec "$CONTAINER" psql -U postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB}' AND pid <> pg_backend_pid();" \
  2>/dev/null || true

echo ">>> Restoring backup..."
if [[ "$BACKUP_FILE" == *.gz ]]; then
  gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER" psql -U postgres -d "$DB"
else
  docker exec -i "$CONTAINER" psql -U postgres -d "$DB" < "$BACKUP_FILE"
fi

echo ""
echo ">>> Verifying restore..."
TABLES=$(docker exec "$CONTAINER" psql -U postgres -d "$DB" -t -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
echo "  Tables in ${DB}: $(echo "$TABLES" | tr -d ' ')"

echo ""
echo "[OK] Restore complete for ${SERVICE}"
