#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Runs quality-gate steps for a single service locally.
#
# Usage: ./scripts/run-service.sh <service-name> [step]
#   step: lint | typecheck | unit | e2e | all (default: all)
#
# Prerequisites:
#   • Service dependencies installed (npm ci in services/<name>)
#   • For e2e: Postgres (and Redis for api-gateway) running — see per-service
#     docker-compose.yml or the root docker-compose.yml
#   • DATABASE_URL env var (or rely on test/e2e/helpers/env-setup.ts defaults)
# ---------------------------------------------------------------------------

SERVICE="${1:?Usage: run-service.sh <service-name> [step]}"
STEP="${2:-all}"
SERVICE_DIR="services/${SERVICE}"

if [ ! -d "$SERVICE_DIR" ]; then
  echo "✗ Service directory not found: ${SERVICE_DIR}"
  exit 1
fi

cd "$SERVICE_DIR"

run_lint() {
  echo "──── Lint ────"
  npx eslint '{src,test}/**/*.ts'
}

run_typecheck() {
  echo "──── Typecheck ────"
  npx tsc --noEmit
}

run_unit() {
  echo "──── Unit tests + coverage ────"
  npx jest --runInBand --coverage \
    --coverageReporters=text-summary \
    --coverageReporters=json-summary
  echo ""
  bash "../../scripts/check-coverage.sh" coverage/coverage-summary.json "${COVERAGE_THRESHOLD:-60}"
}

run_e2e() {
  echo "──── E2E tests ────"
  npm run test:e2e
}

case "$STEP" in
  lint)      run_lint ;;
  typecheck) run_typecheck ;;
  unit)      run_unit ;;
  e2e)       run_e2e ;;
  all)
    run_lint
    run_typecheck
    run_unit
    run_e2e
    ;;
  *)
    echo "Unknown step: ${STEP}"
    echo "Available: lint | typecheck | unit | e2e | all"
    exit 1
    ;;
esac

echo ""
echo "✓ ${SERVICE} / ${STEP} — done"
