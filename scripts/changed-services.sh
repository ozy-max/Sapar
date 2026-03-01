#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Detects which services changed in the current PR / push.
# Sets GitHub Actions outputs:
#   services  — JSON array, e.g. ["api-gateway","trips-service"]
#   run_all   — "true" | "false"
# ---------------------------------------------------------------------------

ALL_SERVICES=(
  "api-gateway"
  "identity-service"
  "trips-service"
  "payments-service"
  "notifications-service"
)

# Shared paths: any change here → rebuild ALL services
SHARED_PATTERNS=(
  "^scripts/"
  "^\.github/"
  "^docker-compose\.yml$"
  "^\.eslintrc"
  "^\.prettierrc"
)

# ── resolve diff range ────────────────────────────────────────────────────
resolve_changed_files() {
  if [ -n "${GITHUB_BASE_REF:-}" ]; then
    git diff --name-only "origin/${GITHUB_BASE_REF}...HEAD"
  elif [ -n "${GITHUB_EVENT_BEFORE:-}" ] &&
       [ "${GITHUB_EVENT_BEFORE}" != "0000000000000000000000000000000000000000" ]; then
    git diff --name-only "${GITHUB_EVENT_BEFORE}..HEAD"
  else
    git diff --name-only HEAD~1..HEAD 2>/dev/null || true
  fi
}

CHANGED_FILES=$(resolve_changed_files)

if [ -z "$CHANGED_FILES" ]; then
  echo "No changed files detected."
  echo "services=[]"  >> "${GITHUB_OUTPUT:-/dev/stdout}"
  echo "run_all=false" >> "${GITHUB_OUTPUT:-/dev/stdout}"
  exit 0
fi

echo "=== Changed files ==="
echo "$CHANGED_FILES"
echo ""

# ── check shared paths ────────────────────────────────────────────────────
run_all=false
for pattern in "${SHARED_PATTERNS[@]}"; do
  if echo "$CHANGED_FILES" | grep -qE "$pattern"; then
    run_all=true
    break
  fi
done

if [ "$run_all" = "true" ]; then
  json=$(printf '%s\n' "${ALL_SERVICES[@]}" | jq -R . | jq -sc .)
  echo "Shared files changed → running ALL services: $json"
  echo "services=${json}"  >> "${GITHUB_OUTPUT:-/dev/stdout}"
  echo "run_all=true"       >> "${GITHUB_OUTPUT:-/dev/stdout}"
  exit 0
fi

# ── map changed files → services ──────────────────────────────────────────
changed=()
for svc in "${ALL_SERVICES[@]}"; do
  if echo "$CHANGED_FILES" | grep -q "^services/${svc}/"; then
    changed+=("$svc")
  fi
done

if [ ${#changed[@]} -eq 0 ]; then
  json="[]"
else
  json=$(printf '%s\n' "${changed[@]}" | jq -R . | jq -sc .)
fi

echo "Affected services: $json"
echo "services=${json}" >> "${GITHUB_OUTPUT:-/dev/stdout}"
echo "run_all=false"     >> "${GITHUB_OUTPUT:-/dev/stdout}"
