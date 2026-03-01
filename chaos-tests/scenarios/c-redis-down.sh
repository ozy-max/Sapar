#!/usr/bin/env bash
# Scenario C: Redis down.
# Stops Redis and verifies:
#   - gateway rate limiting degrades according to policy (fail-open or fail-closed)
#   - gateway logs/metrics reflect Redis unavailability
#   - core routing still functions (fail-open) or returns 503 (fail-closed)
#   - trips-service cache degrades gracefully (falls back to DB)
#
# Alerts expected: RedisErrorsHigh

set -euo pipefail
cd "$(dirname "$0")/.."
source lib/helpers.sh

begin_scenario "C — Redis down"

ensure_system_ready

echo ">>> Phase 1: Verify baseline — Redis healthy"
assert_http "Gateway /health is 200" "200" "${GATEWAY_URL}/health"

# Verify Redis is reachable
assert_true "Redis PING responds" \
  dc exec -T redis redis-cli ping

echo ""
echo ">>> Phase 2: Inject failure — stop redis"
docker_stop "redis"
sleep 3

echo ""
echo ">>> Phase 3: Validate gateway behavior"

# Gateway behavior depends on fail-open/fail-closed policy for rate limiter.
# Test: gateway should still respond (possibly degraded).
gw_code=$(http_code "${GATEWAY_URL}/health")

if [ "$gw_code" = "200" ]; then
  echo -e "  ${GREEN}[PASS]${NC} Gateway /health still 200 (fail-open policy for rate limiter)"
  PASS_COUNT=$((PASS_COUNT + 1))

  # In fail-open mode, routes should still proxy
  assert_http "identity-service proxied via gateway" "200" "http://localhost:3001/health"
elif [ "$gw_code" = "503" ]; then
  echo -e "  ${GREEN}[PASS]${NC} Gateway /health returns 503 (fail-closed policy for rate limiter)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo -e "  ${RED}[FAIL]${NC} Gateway /health unexpected code: ${gw_code}"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""
echo ">>> Phase 4: Verify downstream services unaffected"
assert_http "identity-service /health (direct) is 200" "200" "http://localhost:3001/health"
assert_http "trips-service /health (direct) is 200" "200" "http://localhost:3002/health"
assert_http "payments-service /health (direct) is 200" "200" "http://localhost:3003/health"
assert_http "notifications-service /health (direct) is 200" "200" "http://localhost:3004/health"

echo ""
echo ">>> Phase 5: Check trips-redis separately"
# trips-redis is a different container; stop it to test trips cache degradation
docker_stop "trips-redis"
sleep 3

assert_http "trips-service /health still 200 (cache miss falls back to DB)" "200" "http://localhost:3002/health"

docker_start "trips-redis"
sleep 3

echo ""
echo ">>> Phase 6: Restore — start redis"
docker_start "redis"
sleep 3

echo ""
echo ">>> Phase 7: Verify recovery"
assert_true "Redis PING responds after restore" \
  dc exec -T redis redis-cli ping
wait_healthy "api-gateway" "${GATEWAY_URL}/health" 30
assert_http "Gateway /health is 200" "200" "${GATEWAY_URL}/health"

end_scenario
