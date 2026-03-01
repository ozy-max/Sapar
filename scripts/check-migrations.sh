#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Prisma migration safety check.
# For a given service, if prisma/schema.prisma was modified in this diff
# then at least one NEW migration folder must also be present in the diff.
#
# Usage: check-migrations.sh <service-name>
# ---------------------------------------------------------------------------

SERVICE="${1:?Usage: check-migrations.sh <service-name>}"
SERVICE_DIR="services/${SERVICE}"

# ── resolve diff range (same logic as changed-services.sh) ────────────────
resolve_diff_ref() {
  if [ -n "${GITHUB_BASE_REF:-}" ]; then
    echo "origin/${GITHUB_BASE_REF}...HEAD"
  elif [ -n "${GITHUB_EVENT_BEFORE:-}" ] &&
       [ "${GITHUB_EVENT_BEFORE}" != "0000000000000000000000000000000000000000" ]; then
    echo "${GITHUB_EVENT_BEFORE}..HEAD"
  else
    echo "HEAD~1..HEAD"
  fi
}

DIFF_REF=$(resolve_diff_ref)

# ── check if schema.prisma was changed ────────────────────────────────────
schema_diff=$(git diff --name-only "$DIFF_REF" -- "${SERVICE_DIR}/prisma/schema.prisma" 2>/dev/null || true)

if [ -z "$schema_diff" ]; then
  echo "✓ ${SERVICE}: prisma/schema.prisma not changed — migration check skipped"
  exit 0
fi

echo "⚠ ${SERVICE}: prisma/schema.prisma was modified — verifying new migration exists…"

# ── look for newly ADDED migration files (exclude lock file) ──────────────
new_migrations=$(
  git diff --diff-filter=A --name-only "$DIFF_REF" \
    -- "${SERVICE_DIR}/prisma/migrations/" 2>/dev/null |
  grep -v "migration_lock.toml" || true
)

if [ -z "$new_migrations" ]; then
  echo ""
  echo "✗ FAIL: ${SERVICE}/prisma/schema.prisma was changed but no new migration was added."
  echo "  Run locally:"
  echo "    cd ${SERVICE_DIR}"
  echo "    npx prisma migrate dev --name <description>"
  echo "  Then commit the generated migration folder."
  exit 1
fi

echo "✓ ${SERVICE}: new migration(s) detected:"
echo "$new_migrations"
