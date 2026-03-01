#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Enforces minimum code-coverage threshold using Jest's json-summary output.
#
# Usage: check-coverage.sh <path/to/coverage-summary.json> [threshold=60]
#
# To adjust the threshold:
#   • CI:    change env.COVERAGE_THRESHOLD in .github/workflows/ci.yml
#   • Local: pass the second argument, e.g. ./scripts/check-coverage.sh coverage/coverage-summary.json 80
# ---------------------------------------------------------------------------

SUMMARY="${1:?Usage: check-coverage.sh <coverage-summary.json> [threshold]}"
THRESHOLD="${2:-60}"

if [ ! -f "$SUMMARY" ]; then
  echo "✗ Coverage summary not found at: ${SUMMARY}"
  exit 1
fi

LINES_PCT=$(node -e "
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  process.stdout.write(String(data.total.lines.pct));
" "$SUMMARY")

echo "Lines coverage: ${LINES_PCT}% (threshold: ${THRESHOLD}%)"

PASS=$(node -e "process.stdout.write(Number(${LINES_PCT}) >= Number(${THRESHOLD}) ? 'true' : 'false')")

if [ "$PASS" = "false" ]; then
  echo "✗ FAIL: coverage ${LINES_PCT}% is below minimum ${THRESHOLD}%"
  exit 1
fi

echo "✓ Coverage check passed"
