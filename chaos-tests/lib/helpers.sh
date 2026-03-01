#!/usr/bin/env bash
# Shared helpers for chaos test scenarios.
# Source this file: source "$(dirname "$0")/../lib/helpers.sh"

set -euo pipefail

HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${HELPERS_DIR}/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${PROJECT_ROOT}/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-${PROJECT_ROOT}/.env.docker}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:3000}"
MAX_WAIT="${MAX_WAIT:-30}"

dc() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@" 2>/dev/null || \
    docker-compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@" 2>/dev/null
}

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
SCENARIO_NAME=""

begin_scenario() {
  SCENARIO_NAME="$1"
  PASS_COUNT=0
  FAIL_COUNT=0
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║  CHAOS SCENARIO: ${SCENARIO_NAME}${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

end_scenario() {
  echo ""
  echo -e "${CYAN}──────────────────────────────────────────────────────────────${NC}"
  if [ "$FAIL_COUNT" -eq 0 ]; then
    echo -e "${GREEN}  RESULT: ALL ${PASS_COUNT} checks PASSED${NC}"
  else
    echo -e "${RED}  RESULT: ${FAIL_COUNT} FAILED, ${PASS_COUNT} passed${NC}"
  fi
  echo -e "${CYAN}──────────────────────────────────────────────────────────────${NC}"
  echo ""
  return "$FAIL_COUNT"
}

http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null || echo "000"
}

assert_http() {
  local description="$1"
  local expected_code="$2"
  local url="$3"

  local actual_code
  actual_code=$(http_code "$url")

  if [ "$actual_code" = "$expected_code" ]; then
    echo -e "  ${GREEN}[PASS]${NC} ${description} (HTTP ${actual_code})"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "  ${RED}[FAIL]${NC} ${description} (expected ${expected_code}, got ${actual_code})"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

assert_http_not() {
  local description="$1"
  local unexpected_code="$2"
  local url="$3"

  local actual_code
  actual_code=$(http_code "$url")

  if [ "$actual_code" != "$unexpected_code" ]; then
    echo -e "  ${GREEN}[PASS]${NC} ${description} (HTTP ${actual_code}, not ${unexpected_code})"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "  ${RED}[FAIL]${NC} ${description} (got unexpected ${actual_code})"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

assert_contains() {
  local description="$1"
  local url="$2"
  local expected_substring="$3"

  local body
  body=$(curl -s --max-time 10 "$url" 2>/dev/null || echo "")

  if echo "$body" | grep -q "$expected_substring"; then
    echo -e "  ${GREEN}[PASS]${NC} ${description}"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "  ${RED}[FAIL]${NC} ${description} (substring '${expected_substring}' not found)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

assert_true() {
  local description="$1"
  shift

  if "$@" >/dev/null 2>&1; then
    echo -e "  ${GREEN}[PASS]${NC} ${description}"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "  ${RED}[FAIL]${NC} ${description}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

assert_false() {
  local description="$1"
  shift

  if ! "$@" >/dev/null 2>&1; then
    echo -e "  ${GREEN}[PASS]${NC} ${description}"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "  ${RED}[FAIL]${NC} ${description}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

docker_stop() {
  local service="$1"
  echo -e "  ${YELLOW}[INJECT]${NC} Stopping ${service}..."
  dc stop "$service"
  sleep 2
}

docker_start() {
  local service="$1"
  echo -e "  ${YELLOW}[RESTORE]${NC} Starting ${service}..."
  dc start "$service"
}

wait_healthy() {
  local service="$1"
  local url="$2"
  local max_wait="${3:-$MAX_WAIT}"

  echo -e "  ${YELLOW}[WAIT]${NC} Waiting for ${service} to become healthy (max ${max_wait}s)..."
  for i in $(seq 1 "$max_wait"); do
    if [ "$(http_code "$url")" = "200" ]; then
      echo -e "  ${GREEN}[OK]${NC} ${service} healthy after ${i}s"
      return 0
    fi
    sleep 1
  done
  echo -e "  ${RED}[TIMEOUT]${NC} ${service} not healthy after ${max_wait}s"
  return 1
}

check_gateway_health() {
  wait_healthy "api-gateway" "${GATEWAY_URL}/health" "$MAX_WAIT"
}

ensure_system_ready() {
  echo -e "${YELLOW}>>> Ensuring all services are running...${NC}"
  dc start
  check_gateway_health
  echo ""
}
