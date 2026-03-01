#!/usr/bin/env bash
set -euo pipefail

# Smoke-test: verify /health and /ready for all Sapar services.
# Usage: ./scripts/smoke.sh [--wait <seconds>]
#
# Exit codes:
#   0 — all services healthy
#   1 — one or more services unhealthy

MAX_WAIT=0
if [ "${1:-}" = "--wait" ]; then
  MAX_WAIT="${2:-30}"
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SERVICES="api-gateway:3000 identity-service:3001 trips-service:3002 payments-service:3003 notifications-service:3004 admin-service:3005 profiles-service:3006"
TOTAL=7
PASS=0
FAIL=0

check_endpoint() {
  local name="$1"
  local port="$2"
  local endpoint="$3"
  local url="http://localhost:${port}${endpoint}"

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")

  if [ "$code" = "200" ]; then
    echo -e "  ${GREEN}[OK]${NC}   ${name} ${endpoint} -> ${code}"
    return 0
  else
    echo -e "  ${RED}[FAIL]${NC} ${name} ${endpoint} -> ${code}"
    return 1
  fi
}

wait_for_services() {
  local waited=0
  while [ "$waited" -lt "$MAX_WAIT" ]; do
    local all_ok=true
    for entry in $SERVICES; do
      local port="${entry#*:}"
      if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:${port}/health" 2>/dev/null || echo "000")" != "200" ]; then
        all_ok=false
        break
      fi
    done
    if [ "$all_ok" = "true" ]; then
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
    echo -e "${YELLOW}Waiting for services... (${waited}/${MAX_WAIT}s)${NC}"
  done
}

echo ""
echo -e "${CYAN}+--------------------------------------------------------------+${NC}"
echo -e "${CYAN}|                    SAPAR SMOKE TEST                          |${NC}"
echo -e "${CYAN}+--------------------------------------------------------------+${NC}"
echo ""

if [ "$MAX_WAIT" -gt 0 ]; then
  wait_for_services
fi

for entry in $SERVICES; do
  svc="${entry%%:*}"
  port="${entry#*:}"

  echo -e "${CYAN}${svc}${NC} (http://localhost:${port})"

  health_ok=true
  ready_ok=true

  check_endpoint "$svc" "$port" "/health" || health_ok=false
  check_endpoint "$svc" "$port" "/ready"  || ready_ok=false

  if [ "$health_ok" = "true" ] && [ "$ready_ok" = "true" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
  fi
  echo ""
done

echo -e "${CYAN}--------------------------------------------------------------${NC}"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}  RESULT: ALL ${PASS}/${TOTAL} services HEALTHY${NC}"
else
  echo -e "${RED}  RESULT: ${FAIL}/${TOTAL} services UNHEALTHY${NC}"
fi
echo -e "${CYAN}--------------------------------------------------------------${NC}"
echo ""

exit "$FAIL"
