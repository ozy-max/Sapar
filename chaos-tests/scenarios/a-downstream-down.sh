#!/usr/bin/env bash
# Scenario A: Downstream service down.
# Verifies graceful degradation when payments-service or notifications-service is unavailable.
#
# Expected behavior:
#   - payments-service down: gateway returns 503 for payments routes,
#     circuit breaker opens, other routes still work
#   - notifications-service down: bookings still process,
#     outbox accumulates undelivered events
#
# Alerts expected: CircuitBreakerOpenSpike, ServiceHigh5xxRate, OutboxDeliveryErrorsHigh

set -euo pipefail
cd "$(dirname "$0")/.."
source lib/helpers.sh

TOTAL_FAILURES=0

# ─── Sub-scenario A1: payments-service down ──────────────────────────────────

begin_scenario "A1 — payments-service down"

ensure_system_ready

echo ">>> Phase 1: Verify baseline — payments-service healthy"
assert_http "Gateway /health is 200" "200" "${GATEWAY_URL}/health"
assert_http "payments-service direct /health is 200" "200" "http://localhost:3003/health"

echo ""
echo ">>> Phase 2: Inject failure — stop payments-service"
docker_stop "payments-service"
sleep 3

echo ""
echo ">>> Phase 3: Validate degradation"
assert_http "Gateway /health still 200 (partial degradation)" "200" "${GATEWAY_URL}/health"
assert_http "identity-service still healthy" "200" "http://localhost:3001/health"
assert_http "trips-service still healthy" "200" "http://localhost:3002/health"
assert_http "notifications-service still healthy" "200" "http://localhost:3004/health"

# Gateway should return 502 or 503 for payments-proxied routes
# Routes: /payments/* → payments-service
actual_code=$(http_code "${GATEWAY_URL}/payments/health")
if [ "$actual_code" = "502" ] || [ "$actual_code" = "503" ]; then
  echo -e "  ${GREEN}[PASS]${NC} Payments route returns error (HTTP ${actual_code})"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo -e "  ${RED}[FAIL]${NC} Payments route expected 502/503, got ${actual_code}"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""
echo ">>> Phase 4: Restore — start payments-service"
docker_start "payments-service"
wait_healthy "payments-service" "http://localhost:3003/health" 45

echo ""
echo ">>> Phase 5: Verify recovery"
assert_http "Gateway /health is 200" "200" "${GATEWAY_URL}/health"
assert_http "payments-service /health is 200" "200" "http://localhost:3003/health"

end_scenario || TOTAL_FAILURES=$((TOTAL_FAILURES + $?))

# ─── Sub-scenario A2: notifications-service down ─────────────────────────────

begin_scenario "A2 — notifications-service down"

ensure_system_ready

echo ">>> Phase 1: Verify baseline"
assert_http "notifications-service /health is 200" "200" "http://localhost:3004/health"

echo ""
echo ">>> Phase 2: Inject failure — stop notifications-service"
docker_stop "notifications-service"
sleep 3

echo ""
echo ">>> Phase 3: Validate degradation"
assert_http "Gateway /health still 200" "200" "${GATEWAY_URL}/health"
assert_http "identity-service still healthy" "200" "http://localhost:3001/health"
assert_http "trips-service still healthy" "200" "http://localhost:3002/health"
assert_http "payments-service still healthy" "200" "http://localhost:3003/health"

# Bookings (trips-service) should still work — notifications are async via outbox.
# The outbox will accumulate events destined for notifications-service.
assert_http "trips-service /ready is 200 (bookings still work)" "200" "http://localhost:3002/ready"

echo ""
echo ">>> Phase 4: Restore — start notifications-service"
docker_start "notifications-service"
wait_healthy "notifications-service" "http://localhost:3004/health" 45

echo ""
echo ">>> Phase 5: Verify recovery"
assert_http "notifications-service /health is 200" "200" "http://localhost:3004/health"
assert_http "Gateway /health is 200" "200" "${GATEWAY_URL}/health"

end_scenario || TOTAL_FAILURES=$((TOTAL_FAILURES + $?))

exit "$TOTAL_FAILURES"
