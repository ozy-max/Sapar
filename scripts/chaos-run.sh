#!/usr/bin/env bash
set -euo pipefail

# Run all chaos test scenarios sequentially.
# Usage: ./scripts/chaos-run.sh [scenario-letter]
#
# Examples:
#   ./scripts/chaos-run.sh       # run all scenarios A-E
#   ./scripts/chaos-run.sh b     # run only scenario B
#   ./scripts/chaos-run.sh a c   # run scenarios A and C

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CHAOS_DIR="${PROJECT_DIR}/chaos-tests/scenarios"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ALL_SCENARIOS=(
  "a:a-downstream-down.sh:Downstream service down"
  "b:b-database-down.sh:Database down"
  "c:c-redis-down.sh:Redis down"
  "d:d-slow-network.sh:Slow network / timeouts"
  "e:e-duplicate-events.sh:Duplicate event delivery"
)

SELECTED=()
if [ $# -gt 0 ]; then
  for arg in "$@"; do
    letter=$(echo "$arg" | tr '[:upper:]' '[:lower:]')
    for entry in "${ALL_SCENARIOS[@]}"; do
      IFS=: read -r id file desc <<< "$entry"
      if [ "$id" = "$letter" ]; then
        SELECTED+=("$entry")
      fi
    done
  done
  if [ ${#SELECTED[@]} -eq 0 ]; then
    echo -e "${RED}No matching scenarios found for: $*${NC}"
    echo "Available: a b c d e"
    exit 1
  fi
else
  SELECTED=("${ALL_SCENARIOS[@]}")
fi

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║               SAPAR CHAOS TEST SUITE                       ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Scenarios to run: ${#SELECTED[@]}"
echo ""

ENV_FILE="${ENV_FILE:-.env.docker}"

# Pre-flight: verify compose stack is running
echo -e "${YELLOW}>>> Pre-flight: checking docker compose stack...${NC}"
if ! docker compose --env-file "$ENV_FILE" ps --format '{{.Name}}' 2>/dev/null | grep -q "gateway"; then
  echo -e "${RED}Docker compose stack does not appear to be running.${NC}"
  echo "Start it with: docker compose --env-file .env.docker up -d --build"
  exit 1
fi

echo -e "${YELLOW}>>> Pre-flight: running smoke test...${NC}"
if ! bash "${SCRIPT_DIR}/smoke.sh" 2>/dev/null; then
  echo -e "${YELLOW}[WARN] Some services are not healthy. Proceeding anyway...${NC}"
fi

TOTAL=0
PASSED=0
FAILED=0
RESULTS=()
START_TIME=$(date +%s)

for entry in "${SELECTED[@]}"; do
  IFS=: read -r id file desc <<< "$entry"
  TOTAL=$((TOTAL + 1))

  ID_UPPER=$(echo "$id" | tr '[:lower:]' '[:upper:]')

  echo ""
  echo -e "${CYAN}------------------------------------------------------------${NC}"
  echo -e "${CYAN}  Running scenario ${ID_UPPER}: ${desc}${NC}"
  echo -e "${CYAN}------------------------------------------------------------${NC}"

  scenario_start=$(date +%s)

  if bash "${CHAOS_DIR}/${file}"; then
    scenario_end=$(date +%s)
    elapsed=$((scenario_end - scenario_start))
    PASSED=$((PASSED + 1))
    RESULTS+=("${GREEN}[PASS]${NC} Scenario ${ID_UPPER}: ${desc} (${elapsed}s)")
  else
    scenario_end=$(date +%s)
    elapsed=$((scenario_end - scenario_start))
    FAILED=$((FAILED + 1))
    RESULTS+=("${RED}[FAIL]${NC} Scenario ${ID_UPPER}: ${desc} (${elapsed}s)")
  fi
done

END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                    FINAL RESULTS                           ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
for result in "${RESULTS[@]}"; do
  echo -e "  ${result}"
done
echo ""
echo -e "${CYAN}──────────────────────────────────────────────────────────────${NC}"
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}  ALL ${PASSED}/${TOTAL} scenarios PASSED (${TOTAL_TIME}s total)${NC}"
else
  echo -e "${RED}  ${FAILED}/${TOTAL} scenarios FAILED, ${PASSED} passed (${TOTAL_TIME}s total)${NC}"
fi
echo -e "${CYAN}──────────────────────────────────────────────────────────────${NC}"
echo ""

# Post-flight: restore system
echo -e "${YELLOW}>>> Post-flight: ensuring system is restored...${NC}"
docker compose --env-file "$ENV_FILE" start 2>/dev/null || docker-compose --env-file "$ENV_FILE" start 2>/dev/null || true
sleep 15
bash "${SCRIPT_DIR}/smoke.sh" || true

exit "$FAILED"
