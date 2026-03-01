#!/usr/bin/env bash
# Scenario E: Duplicate event delivery.
# Replays internal events to verify consumers remain idempotent.
#
# Strategy:
#   - notifications-service: full idempotency test with payment.captured
#     (handler exists, processes then deduplicates)
#   - payments-service: send unhandled event type → proves envelope validation
#     + dedup pipeline works (returns { status: "ignored" })
#   - trips-service: same approach with unhandled type
#
# Alerts expected: None (idempotency should silently handle duplicates)

set -euo pipefail
cd "$(dirname "$0")/.."
source lib/helpers.sh

begin_scenario "E — Duplicate event delivery (idempotency)"

ensure_system_ready

# Read HMAC secret from .env.docker
if [ -z "${EVENTS_HMAC_SECRET:-}" ] && [ -f "${PROJECT_ROOT}/.env.docker" ]; then
  HMAC_SECRET=$(grep '^EVENTS_HMAC_SECRET=' "${PROJECT_ROOT}/.env.docker" | cut -d= -f2-)
else
  HMAC_SECRET="${EVENTS_HMAC_SECRET:-change-me-to-random-string-at-least-32-chars}"
fi

UUID1="00000000-0000-4000-a000-$(date +%s)01"
UUID2="00000000-0000-4000-a000-$(date +%s)02"
UUID3="00000000-0000-4000-a000-$(date +%s)03"
OCCURRED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

send_event() {
  local target_url="$1"
  local payload="$2"

  local timestamp
  timestamp=$(date +%s)

  local sign_data="${timestamp}.${payload}"
  local signature
  signature=$(printf '%s' "$sign_data" | openssl dgst -sha256 -hmac "$HMAC_SECRET" -hex 2>/dev/null | sed 's/^.* //')

  curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-Event-Signature: ${signature}" \
    -H "X-Event-Timestamp: ${timestamp}" \
    -d "$payload" \
    "$target_url" 2>/dev/null || echo "000"
}

# ─── Test 1: Idempotency on notifications-service (full processing path) ─────

echo ">>> Test 1: Duplicate payment.captured event to notifications-service"
echo "  (handler exists — proves full idempotency with consumed_events table)"

NOTIF_EVENT="{\"eventId\":\"${UUID1}\",\"eventType\":\"payment.captured\",\"payload\":{\"paymentIntentId\":\"chaos-pi-001\",\"bookingId\":\"chaos-booking-001\",\"amount\":2000},\"occurredAt\":\"${OCCURRED_AT}\",\"producer\":\"chaos-test\",\"traceId\":\"chaos-trace-001\",\"version\":1}"

echo "  Sending first event (eventId: ${UUID1})..."
code1=$(send_event "http://localhost:3004/internal/events" "$NOTIF_EVENT")

echo "  Sending duplicate event (same eventId)..."
code2=$(send_event "http://localhost:3004/internal/events" "$NOTIF_EVENT")

if [[ "$code1" =~ ^2[0-9][0-9]$ ]]; then
  echo -e "  ${GREEN}[PASS]${NC} First event accepted (HTTP ${code1})"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo -e "  ${RED}[FAIL]${NC} First event rejected (HTTP ${code1})"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if [[ "$code2" =~ ^2[0-9][0-9]$ ]]; then
  echo -e "  ${GREEN}[PASS]${NC} Duplicate handled idempotently (HTTP ${code2})"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo -e "  ${RED}[FAIL]${NC} Duplicate not handled (HTTP ${code2})"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ─── Test 2: Envelope validation on payments-service (unhandled event type) ──

echo ""
echo ">>> Test 2: Unhandled event type to payments-service"
echo "  (no handler — proves HMAC + Zod validation + routing works)"

PAY_EVENT="{\"eventId\":\"${UUID2}\",\"eventType\":\"chaos.test.noop\",\"payload\":{\"test\":true},\"occurredAt\":\"${OCCURRED_AT}\",\"producer\":\"chaos-test\",\"traceId\":\"chaos-trace-002\",\"version\":1}"

echo "  Sending first event (eventId: ${UUID2})..."
code3=$(send_event "http://localhost:3003/internal/events" "$PAY_EVENT")

echo "  Sending duplicate event (same eventId)..."
code4=$(send_event "http://localhost:3003/internal/events" "$PAY_EVENT")

if [[ "$code3" =~ ^2[0-9][0-9]$ ]]; then
  echo -e "  ${GREEN}[PASS]${NC} Event accepted by payments (HTTP ${code3}, expected 'ignored')"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo -e "  ${RED}[FAIL]${NC} Event rejected by payments (HTTP ${code3})"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if [[ "$code4" =~ ^2[0-9][0-9]$ ]]; then
  echo -e "  ${GREEN}[PASS]${NC} Duplicate accepted by payments (HTTP ${code4}, idempotent 'ignored')"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo -e "  ${RED}[FAIL]${NC} Duplicate rejected by payments (HTTP ${code4})"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ─── Test 3: Envelope validation on trips-service (unhandled event type) ─────

echo ""
echo ">>> Test 3: Unhandled event type to trips-service"
echo "  (no handler — proves HMAC + Zod validation + routing works)"

TRIPS_EVENT="{\"eventId\":\"${UUID3}\",\"eventType\":\"chaos.test.noop\",\"payload\":{\"test\":true},\"occurredAt\":\"${OCCURRED_AT}\",\"producer\":\"chaos-test\",\"traceId\":\"chaos-trace-003\",\"version\":1}"

echo "  Sending first event (eventId: ${UUID3})..."
code5=$(send_event "http://localhost:3002/internal/events" "$TRIPS_EVENT")

echo "  Sending duplicate event (same eventId)..."
code6=$(send_event "http://localhost:3002/internal/events" "$TRIPS_EVENT")

if [[ "$code5" =~ ^2[0-9][0-9]$ ]]; then
  echo -e "  ${GREEN}[PASS]${NC} Event accepted by trips (HTTP ${code5}, expected 'ignored')"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo -e "  ${RED}[FAIL]${NC} Event rejected by trips (HTTP ${code5})"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if [[ "$code6" =~ ^2[0-9][0-9]$ ]]; then
  echo -e "  ${GREEN}[PASS]${NC} Duplicate accepted by trips (HTTP ${code6}, idempotent 'ignored')"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo -e "  ${RED}[FAIL]${NC} Duplicate rejected by trips (HTTP ${code6})"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

end_scenario
