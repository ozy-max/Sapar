#!/usr/bin/env bash
set -euo pipefail

# Backup Postgres databases for all Sapar services.
# Usage: ./scripts/backup-postgres.sh [service] [output-dir]
#
# Examples:
#   ./scripts/backup-postgres.sh                   # backup all, to ./backups/
#   ./scripts/backup-postgres.sh trips              # backup trips only
#   ./scripts/backup-postgres.sh payments /tmp/bak  # backup payments to /tmp/bak/

SERVICES=("identity" "trips" "payments" "notifications" "admin")
OUTPUT_DIR="${2:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SINGLE_SERVICE="${1:-}"

mkdir -p "$OUTPUT_DIR"

backup_service() {
  local svc="$1"
  local container="sapar-postgres-${svc}-1"
  local db="${svc}_db"
  local outfile="${OUTPUT_DIR}/${svc}_${TIMESTAMP}.sql.gz"

  echo ">>> Backing up ${svc} (container: ${container}, db: ${db})..."

  if ! docker inspect "$container" &>/dev/null; then
    echo "  [SKIP] Container $container not found"
    return 1
  fi

  docker exec "$container" pg_dump -U postgres --clean --if-exists "$db" \
    | gzip > "$outfile"

  local size
  size=$(du -h "$outfile" | cut -f1)
  echo "  [OK] ${outfile} (${size})"
}

if [ -n "$SINGLE_SERVICE" ]; then
  backup_service "$SINGLE_SERVICE"
else
  failed=0
  for svc in "${SERVICES[@]}"; do
    if ! backup_service "$svc"; then
      failed=$((failed + 1))
    fi
  done

  echo ""
  echo "Backup complete. Output: ${OUTPUT_DIR}/"
  ls -lh "${OUTPUT_DIR}/"*"${TIMESTAMP}"* 2>/dev/null || true

  if [ "$failed" -gt 0 ]; then
    echo "[WARN] ${failed} service(s) skipped"
    exit 1
  fi
fi
