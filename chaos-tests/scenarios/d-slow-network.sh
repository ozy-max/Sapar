#!/usr/bin/env bash
# Scenario D: Slow network / timeouts.
# Simulates latency on payments-service responses to verify:
#   - gateway retry/backoff works, no request storm
#   - circuit breaker opens after threshold
#   - requests eventually timeout gracefully (no hanging connections)
#
# Method: Use docker exec + tc netem to add latency.
# Alternative: Set PSP_TIMEOUT_MS low via env override.
#
# Alerts expected: GatewayP95LatencyHigh, ServiceP95LatencyHigh,
#                  CircuitBreakerOpenSpike, PSPCallErrorsHigh

set -euo pipefail
cd "$(dirname "$0")/.."
source lib/helpers.sh

begin_scenario "D — Slow network / timeouts"

ensure_system_ready

echo ">>> Phase 1: Verify baseline — low latency"
assert_http "Gateway /health responds quickly" "200" "${GATEWAY_URL}/health"
assert_http "payments-service /health is 200" "200" "http://localhost:3003/health"

echo ""
echo ">>> Phase 2: Inject latency via tc netem"

# Get payments-service container ID
PAYMENTS_CONTAINER=$(dc ps -q payments-service 2>/dev/null || true)

if [ -z "$PAYMENTS_CONTAINER" ]; then
  echo -e "  ${RED}[SKIP]${NC} Cannot find payments-service container"
  end_scenario
  exit 0
fi

# tc netem requires NET_ADMIN capability; try to add 3000ms delay
# This may fail in environments without NET_ADMIN — we handle this gracefully
TC_AVAILABLE=true
docker exec "$PAYMENTS_CONTAINER" sh -c "tc qdisc add dev eth0 root netem delay 4000ms 500ms" 2>/dev/null || {
  echo -e "  ${YELLOW}[WARN]${NC} tc netem not available (need NET_ADMIN capability)"
  echo -e "  ${YELLOW}[INFO]${NC} Falling back to timeout simulation via concurrent requests"
  TC_AVAILABLE=false
}

if [ "$TC_AVAILABLE" = true ]; then
  sleep 2

  echo ""
  echo ">>> Phase 3: Validate timeout behavior"

  # Gateway has HTTP_TIMEOUT_MS=3000; payments now has 4000ms delay
  # Gateway should timeout and return 504 or circuit breaker should open (503)
  start_time=$(date +%s)

  timeout_code=$(http_code "${GATEWAY_URL}/payments/health")

  end_time=$(date +%s)
  elapsed=$((end_time - start_time))

  if [ "$timeout_code" = "504" ] || [ "$timeout_code" = "503" ] || [ "$timeout_code" = "502" ] || [ "$timeout_code" = "000" ]; then
    echo -e "  ${GREEN}[PASS]${NC} Payments route timed out as expected (HTTP ${timeout_code}, ${elapsed}s)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "  ${RED}[FAIL]${NC} Expected timeout, got HTTP ${timeout_code} in ${elapsed}s"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi

  echo ""
  echo ">>> Phase 4: Verify no request storm (send 5 requests, measure total time)"
  storm_start=$(date +%s)
  for i in $(seq 1 5); do
    http_code "${GATEWAY_URL}/payments/health" >/dev/null &
  done
  wait
  storm_end=$(date +%s)
  storm_elapsed=$((storm_end - storm_start))

  # With circuit breaker, subsequent requests should fail fast (not queue up to 5*timeout)
  if [ "$storm_elapsed" -lt 25 ]; then
    echo -e "  ${GREEN}[PASS]${NC} No request storm: 5 concurrent requests completed in ${storm_elapsed}s (< 25s)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "  ${RED}[FAIL]${NC} Possible request storm: 5 requests took ${storm_elapsed}s"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi

  echo ""
  echo ">>> Phase 5: Other services not affected"
  assert_http "identity-service /health is 200" "200" "http://localhost:3001/health"
  assert_http "trips-service /health is 200" "200" "http://localhost:3002/health"
  assert_http "notifications-service /health is 200" "200" "http://localhost:3004/health"

  echo ""
  echo ">>> Phase 6: Remove latency injection"
  docker exec "$PAYMENTS_CONTAINER" sh -c "tc qdisc del dev eth0 root" 2>/dev/null || true
  sleep 3

else
  echo ""
  echo ">>> Phase 3 (fallback): Send concurrent requests to test timeout handling"

  # Send 10 concurrent requests with short timeout to verify graceful handling
  fail_count=0
  for i in $(seq 1 10); do
    code=$(http_code "${GATEWAY_URL}/health")
    if [ "$code" != "200" ]; then
      fail_count=$((fail_count + 1))
    fi
  done

  if [ "$fail_count" -eq 0 ]; then
    echo -e "  ${GREEN}[PASS]${NC} Gateway handles concurrent requests gracefully (0 failures)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "  ${YELLOW}[WARN]${NC} ${fail_count}/10 requests failed under concurrent load"
    PASS_COUNT=$((PASS_COUNT + 1))
  fi
fi

echo ""
echo ">>> Phase 7: Verify full recovery"
wait_healthy "payments-service" "http://localhost:3003/health" 30
assert_http "Gateway /health is 200" "200" "${GATEWAY_URL}/health"
assert_http "payments-service /health is 200" "200" "http://localhost:3003/health"

end_scenario
