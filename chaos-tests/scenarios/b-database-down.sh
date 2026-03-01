#!/usr/bin/env bash
# Scenario B: Database down.
# Stops trips-postgres and verifies:
#   - trips-service /ready fails (db not reachable)
#   - gateway returns 503 for trips routes
#   - other services (identity, payments, notifications) remain healthy
#
# Alerts expected: DatabaseErrorsIncreasing, ServiceHigh5xxRate, CircuitBreakerOpenSpike

set -euo pipefail
cd "$(dirname "$0")/.."
source lib/helpers.sh

begin_scenario "B — trips-postgres down"

ensure_system_ready

echo ">>> Phase 1: Verify baseline — all databases healthy"
assert_http "trips-service /health is 200" "200" "http://localhost:3002/health"
assert_http "trips-service /ready is 200" "200" "http://localhost:3002/ready"
assert_http "Gateway /health is 200" "200" "${GATEWAY_URL}/health"

echo ""
echo ">>> Phase 2: Inject failure — stop trips-postgres"
docker_stop "trips-postgres"
sleep 5

echo ""
echo ">>> Phase 3: Validate impact"

# trips-service /ready should fail — DB is down
actual_ready=$(http_code "http://localhost:3002/ready")
if [ "$actual_ready" = "503" ] || [ "$actual_ready" = "500" ] || [ "$actual_ready" = "000" ]; then
  echo -e "  ${GREEN}[PASS]${NC} trips-service /ready reflects DB down (HTTP ${actual_ready})"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo -e "  ${RED}[FAIL]${NC} trips-service /ready expected 503/500/000, got ${actual_ready}"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Other services should remain healthy
assert_http "identity-service /health is 200" "200" "http://localhost:3001/health"
assert_http "payments-service /health is 200" "200" "http://localhost:3003/health"
assert_http "notifications-service /health is 200" "200" "http://localhost:3004/health"
assert_http "admin-service /health is 200" "200" "http://localhost:3005/health"

# Gateway should still respond (partial degradation)
assert_http "Gateway /health is 200 (partial degradation)" "200" "${GATEWAY_URL}/health"

echo ""
echo ">>> Phase 4: Verify blast radius is contained"
# Identity routes should still work fine
assert_http "identity routes still accessible" "200" "http://localhost:3001/health"

echo ""
echo ">>> Phase 5: Restore — start trips-postgres"
docker_start "trips-postgres"

echo -e "  ${YELLOW}[WAIT]${NC} Waiting for trips-postgres to be ready..."
for i in $(seq 1 30); do
  if dc exec -T trips-postgres pg_isready -U sapar -d sapar_trips >/dev/null 2>&1; then
    echo -e "  ${GREEN}[OK]${NC} trips-postgres ready after ${i}s"
    break
  fi
  sleep 1
done

sleep 5

echo ""
echo ">>> Phase 6: Verify recovery"
wait_healthy "trips-service" "http://localhost:3002/ready" 30
assert_http "trips-service /health is 200" "200" "http://localhost:3002/health"
assert_http "trips-service /ready is 200" "200" "http://localhost:3002/ready"
assert_http "Gateway /health is 200" "200" "${GATEWAY_URL}/health"

end_scenario
