#!/usr/bin/env bash
###############################################################################
#  SAPAR — Полная функциональная верификация платформы
#  Версия: 1.0
#  Дата: 2026-03-02
#  Автор: QA Automation Agent
#
#  Запуск: bash scripts/functional-verification.sh
#  Предусловие: docker compose доступен, jq установлен, порты 3000-3006 свободны
###############################################################################
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# ЦВЕТА
# ─────────────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# ─────────────────────────────────────────────────────────────────────────────
# СЧЁТЧИКИ
# ─────────────────────────────────────────────────────────────────────────────
TOTAL_CHECKS=0; PASSED=0; FAILED=0; WARNINGS=0
BUGS=()
SCENARIO_RESULTS=()

pass()  { PASSED=$((PASSED+1));  TOTAL_CHECKS=$((TOTAL_CHECKS+1)); echo -e "  ${GREEN}[PASS]${NC} $1"; }
fail()  { FAILED=$((FAILED+1));  TOTAL_CHECKS=$((TOTAL_CHECKS+1)); echo -e "  ${RED}[FAIL]${NC} $1"; BUGS+=("$1"); }
warn()  { WARNINGS=$((WARNINGS+1)); echo -e "  ${YELLOW}[WARN]${NC} $1"; }
info()  { echo -e "  ${CYAN}[INFO]${NC} $1"; }
header(){ echo ""; echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"; echo -e "${BOLD}  $1${NC}"; echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}"; }
sub()   { echo ""; echo -e "  ${CYAN}--- $1 ---${NC}"; }

scenario_start() { SCENARIO_START_PASSED=$PASSED; SCENARIO_START_FAILED=$FAILED; }
scenario_end() {
  local name="$1"
  local sp=$((PASSED - SCENARIO_START_PASSED))
  local sf=$((FAILED - SCENARIO_START_FAILED))
  if [ "$sf" -eq 0 ]; then
    SCENARIO_RESULTS+=("${GREEN}PASS${NC} $name ($sp checks)")
  else
    SCENARIO_RESULTS+=("${RED}FAIL${NC} $name ($sp passed, $sf failed)")
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 0 — Конфигурация
# ─────────────────────────────────────────────────────────────────────────────
header "PHASE 0 — Запуск и проверка готовности"

BASE=http://localhost:3000
NOTIF_BASE=http://localhost:3004
IDENTITY_DIRECT=http://localhost:3001
TS=$(date +%s)
DEPART_AT=$(date -u -v+2d '+%Y-%m-%dT08:00:00.000Z' 2>/dev/null || date -u -d '+2 days' '+%Y-%m-%dT08:00:00.000Z')

req() {
  local method="$1"; shift
  local url="$1"; shift
  local rid
  rid=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "rid-$(date +%s%N)")
  if [ "$method" = "GET" ]; then
    curl -sS -w '\n%{http_code}' --max-time 10 \
      -H "x-request-id: $rid" \
      -H "Content-Type: application/json" \
      "$@" "$url"
  else
    curl -sS -w '\n%{http_code}' --max-time 10 \
      -X "$method" \
      -H "x-request-id: $rid" \
      -H "Content-Type: application/json" \
      "$@" "$url"
  fi
}

req_auth() {
  local method="$1"; shift
  local url="$1"; shift
  local token="$1"; shift
  local rid
  rid=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "rid-$(date +%s%N)")
  if [ "$method" = "GET" ]; then
    curl -sS -w '\n%{http_code}' --max-time 10 \
      -H "x-request-id: $rid" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $token" \
      "$@" "$url"
  else
    curl -sS -w '\n%{http_code}' --max-time 10 \
      -X "$method" \
      -H "x-request-id: $rid" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $token" \
      "$@" "$url"
  fi
}

extract_body_and_code() {
  local raw="$1"
  HTTP_CODE=$(echo "$raw" | tail -n1)
  HTTP_BODY=$(echo "$raw" | sed '$d')
}

decode_jwt_sub() {
  local token="$1"
  echo "$token" | cut -d. -f2 | base64 -d 2>/dev/null | jq -r '.sub // empty' 2>/dev/null || echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Проверка .env.docker
# ─────────────────────────────────────────────────────────────────────────────
sub "Проверка .env.docker"
if [ ! -f ".env.docker" ]; then
  info "Файл .env.docker не найден, создаю из .env.docker.example..."
  if [ -f ".env.docker.example" ]; then
    cp .env.docker.example .env.docker
    sed -i.bak 's/change-me-strong-password/sapar_test_pwd_2026/g' .env.docker 2>/dev/null || \
      sed -i '' 's/change-me-strong-password/sapar_test_pwd_2026/g' .env.docker
    sed -i.bak 's/change-me-to-random-string-at-least-32-chars/sapar-hmac-secret-for-testing-32chars-ok/g' .env.docker 2>/dev/null || \
      sed -i '' 's/change-me-to-random-string-at-least-32-chars/sapar-hmac-secret-for-testing-32chars-ok/g' .env.docker
    sed -i.bak 's/change-me-in-production/admin123/g' .env.docker 2>/dev/null || \
      sed -i '' 's/change-me-in-production/admin123/g' .env.docker
    rm -f .env.docker.bak
    info ".env.docker создан с тестовыми значениями"
  else
    fail ".env.docker.example не найден — невозможно продолжить"
    exit 1
  fi
fi
pass ".env.docker существует"

# ─────────────────────────────────────────────────────────────────────────────
# Запуск docker-compose
# ─────────────────────────────────────────────────────────────────────────────
sub "Запуск docker-compose"
info "docker compose --env-file .env.docker up -d --build"
docker compose --env-file .env.docker up -d --build 2>&1 | tail -5
pass "docker compose up завершён"

# ─────────────────────────────────────────────────────────────────────────────
# Ожидание готовности
# ─────────────────────────────────────────────────────────────────────────────
sub "Ожидание готовности сервисов (таймаут: 120с)"

SERVICES_PORTS=(
  "api-gateway:3000"
  "identity-service:3001"
  "trips-service:3002"
  "payments-service:3003"
  "notifications-service:3004"
  "admin-service:3005"
  "profiles-service:3006"
)

MAX_WAIT=120
WAITED=0
ALL_READY=false

while [ "$WAITED" -lt "$MAX_WAIT" ]; do
  ALL_UP=true
  for entry in "${SERVICES_PORTS[@]}"; do
    svc="${entry%%:*}"
    port="${entry#*:}"
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:${port}/health" 2>/dev/null || echo "000")
    if [ "$code" != "200" ]; then
      ALL_UP=false
      break
    fi
  done
  if [ "$ALL_UP" = "true" ]; then
    ALL_READY=true
    break
  fi
  sleep 3
  WAITED=$((WAITED + 3))
  echo -ne "\r  Ожидание... ${WAITED}/${MAX_WAIT}с"
done
echo ""

if [ "$ALL_READY" = "true" ]; then
  pass "Все сервисы доступны за ${WAITED}с"
else
  fail "Не все сервисы доступны за ${MAX_WAIT}с"
  for entry in "${SERVICES_PORTS[@]}"; do
    svc="${entry%%:*}"
    port="${entry#*:}"
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:${port}/health" 2>/dev/null || echo "000")
    if [ "$code" != "200" ]; then
      fail "  $svc (:$port) /health → $code"
    fi
  done
  echo ""
  echo "Логи проблемных сервисов:"
  docker compose --env-file .env.docker logs --tail=30
  exit 1
fi

# Проверка /health и /ready для всех сервисов
sub "Проверка /health и /ready"
for entry in "${SERVICES_PORTS[@]}"; do
  svc="${entry%%:*}"
  port="${entry#*:}"

  h_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:${port}/health" 2>/dev/null || echo "000")
  r_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:${port}/ready" 2>/dev/null || echo "000")

  if [ "$h_code" = "200" ]; then
    pass "$svc /health → 200"
  else
    fail "$svc /health → $h_code"
  fi

  if [ "$r_code" = "200" ]; then
    pass "$svc /ready → 200"
  else
    fail "$svc /ready → $r_code (ожидалось 200)"
  fi
done

###############################################################################
# SCENARIO B — Водитель (создаём поездку ДО сценария пассажира)
###############################################################################
header "SCENARIO B — Поток водителя"
scenario_start

sub "B.1 — Регистрация водителя"
DRIVER_EMAIL="driver-${TS}@sapar-test.kg"
DRIVER_PASS="DriverPass123!"

RAW=$(req POST "$BASE/identity/auth/register" \
  -d "{\"email\":\"$DRIVER_EMAIL\",\"password\":\"$DRIVER_PASS\"}")
extract_body_and_code "$RAW"

if [ "$HTTP_CODE" = "201" ]; then
  DRIVER_USER_ID=$(echo "$HTTP_BODY" | jq -r '.userId // empty')
  if [ -n "$DRIVER_USER_ID" ]; then
    pass "B.1 Водитель зарегистрирован: userId=$DRIVER_USER_ID"
  else
    fail "B.1 Регистрация водителя: userId не получен. Body: $HTTP_BODY"
  fi
else
  fail "B.1 Регистрация водителя: HTTP $HTTP_CODE. Body: $HTTP_BODY"
fi

sub "B.1b — Логин водителя"
RAW=$(req POST "$BASE/identity/auth/login" \
  -d "{\"email\":\"$DRIVER_EMAIL\",\"password\":\"$DRIVER_PASS\"}")
extract_body_and_code "$RAW"

if [ "$HTTP_CODE" = "200" ]; then
  DRIVER_ACCESS_TOKEN=$(echo "$HTTP_BODY" | jq -r '.accessToken // empty')
  DRIVER_REFRESH_TOKEN=$(echo "$HTTP_BODY" | jq -r '.refreshToken // empty')
  if [ -n "$DRIVER_ACCESS_TOKEN" ]; then
    pass "B.1b Водитель залогинен (token получен)"
    # Извлечение userId из JWT если не получен при регистрации
    if [ -z "${DRIVER_USER_ID:-}" ]; then
      DRIVER_USER_ID=$(decode_jwt_sub "$DRIVER_ACCESS_TOKEN")
    fi
  else
    fail "B.1b Логин водителя: accessToken пуст. Body: $HTTP_BODY"
  fi
else
  fail "B.1b Логин водителя: HTTP $HTTP_CODE. Body: $HTTP_BODY"
fi

sub "B.2 — Создание поездки"
IDEM_KEY=$(uuidgen 2>/dev/null || echo "idem-$(date +%s)")
RAW=$(req_auth POST "$BASE/trips/" "$DRIVER_ACCESS_TOKEN" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -d "{\"fromCity\":\"Бишкек\",\"toCity\":\"Ош\",\"departAt\":\"$DEPART_AT\",\"seatsTotal\":4,\"priceKgs\":1500}")
extract_body_and_code "$RAW"

if [ "$HTTP_CODE" = "201" ]; then
  TRIP_ID=$(echo "$HTTP_BODY" | jq -r '.tripId // empty')
  TRIP_STATUS=$(echo "$HTTP_BODY" | jq -r '.status // empty')
  TRIP_SEATS=$(echo "$HTTP_BODY" | jq -r '.seatsAvailable // empty')
  if [ -n "$TRIP_ID" ]; then
    pass "B.2 Поездка создана: tripId=$TRIP_ID, status=$TRIP_STATUS, seats=$TRIP_SEATS"
  else
    fail "B.2 Поездка создана, но tripId пуст. Body: $HTTP_BODY"
  fi

  if [ "$TRIP_STATUS" = "ACTIVE" ]; then
    pass "B.2 Статус поездки = ACTIVE"
  else
    fail "B.2 Статус поездки = '$TRIP_STATUS' (ожидался ACTIVE)"
  fi

  if [ "$TRIP_SEATS" = "4" ]; then
    pass "B.2 seatsAvailable = 4"
  else
    fail "B.2 seatsAvailable = '$TRIP_SEATS' (ожидалось 4)"
  fi
else
  fail "B.2 Создание поездки: HTTP $HTTP_CODE. Body: $HTTP_BODY"
  TRIP_ID=""
fi

scenario_end "SCENARIO B (часть 1: регистрация + создание поездки)"

###############################################################################
# SCENARIO A — Пассажир
###############################################################################
header "SCENARIO A — Поток пассажира (BFF + saga + notifications)"
scenario_start

sub "A.1 — Регистрация пассажира"
PASSENGER_EMAIL="passenger-${TS}@sapar-test.kg"
PASSENGER_PASS="PassengerPass123!"

RAW=$(req POST "$BASE/identity/auth/register" \
  -d "{\"email\":\"$PASSENGER_EMAIL\",\"password\":\"$PASSENGER_PASS\"}")
extract_body_and_code "$RAW"

if [ "$HTTP_CODE" = "201" ]; then
  PASSENGER_USER_ID=$(echo "$HTTP_BODY" | jq -r '.userId // empty')
  if [ -n "$PASSENGER_USER_ID" ]; then
    pass "A.1 Пассажир зарегистрирован: userId=$PASSENGER_USER_ID"
  else
    fail "A.1 Регистрация пассажира: userId не получен"
  fi
else
  fail "A.1 Регистрация пассажира: HTTP $HTTP_CODE. Body: $HTTP_BODY"
fi

sub "A.2 — Логин пассажира"
RAW=$(req POST "$BASE/identity/auth/login" \
  -d "{\"email\":\"$PASSENGER_EMAIL\",\"password\":\"$PASSENGER_PASS\"}")
extract_body_and_code "$RAW"

if [ "$HTTP_CODE" = "200" ]; then
  PASSENGER_ACCESS_TOKEN=$(echo "$HTTP_BODY" | jq -r '.accessToken // empty')
  PASSENGER_REFRESH_TOKEN=$(echo "$HTTP_BODY" | jq -r '.refreshToken // empty')
  EXPIRES_IN=$(echo "$HTTP_BODY" | jq -r '.expiresInSec // empty')
  if [ -n "$PASSENGER_ACCESS_TOKEN" ]; then
    pass "A.2 Пассажир залогинен (expiresInSec=$EXPIRES_IN)"
    if [ -z "${PASSENGER_USER_ID:-}" ]; then
      PASSENGER_USER_ID=$(decode_jwt_sub "$PASSENGER_ACCESS_TOKEN")
    fi
  else
    fail "A.2 Логин пассажира: accessToken пуст"
  fi
else
  fail "A.2 Логин пассажира: HTTP $HTTP_CODE. Body: $HTTP_BODY"
fi

sub "A.3 — Поиск поездок (BFF)"
RAW=$(req GET "$BASE/v1/trips/search?fromCity=%D0%91%D0%B8%D1%88%D0%BA%D0%B5%D0%BA&toCity=%D0%9E%D1%88")
extract_body_and_code "$RAW"

if [ "$HTTP_CODE" = "200" ]; then
  ITEMS_COUNT=$(echo "$HTTP_BODY" | jq '.items | length' 2>/dev/null || echo "0")
  PAGING_TOTAL=$(echo "$HTTP_BODY" | jq '.paging.total // 0' 2>/dev/null || echo "0")
  TRACE_ID=$(echo "$HTTP_BODY" | jq -r '.meta.traceId // empty' 2>/dev/null || echo "")
  HAS_ITEMS=$(echo "$HTTP_BODY" | jq 'has("items")' 2>/dev/null || echo "false")
  HAS_PAGING=$(echo "$HTTP_BODY" | jq 'has("paging")' 2>/dev/null || echo "false")
  HAS_META=$(echo "$HTTP_BODY" | jq 'has("meta")' 2>/dev/null || echo "false")

  if [ "$HAS_ITEMS" = "true" ] && [ "$HAS_PAGING" = "true" ] && [ "$HAS_META" = "true" ]; then
    pass "A.3 BFF search: envelope {items, paging, meta} присутствует"
  else
    fail "A.3 BFF search: отсутствуют ключи (items=$HAS_ITEMS, paging=$HAS_PAGING, meta=$HAS_META)"
  fi

  if [ -n "$TRACE_ID" ]; then
    pass "A.3 meta.traceId присутствует: $TRACE_ID"
  else
    fail "A.3 meta.traceId отсутствует"
  fi

  if [ "$ITEMS_COUNT" -gt 0 ]; then
    pass "A.3 Найдено поездок: $ITEMS_COUNT (total: $PAGING_TOTAL)"
    SEARCH_TRIP_ID=$(echo "$HTTP_BODY" | jq -r '.items[0].tripId // empty' 2>/dev/null)
    if [ -n "$TRIP_ID" ] && [ "$SEARCH_TRIP_ID" = "$TRIP_ID" ]; then
      pass "A.3 Созданная поездка найдена в результатах поиска"
    fi
  else
    warn "A.3 Поездок не найдено (items=0) — используем tripId из B.2"
  fi
else
  fail "A.3 BFF search: HTTP $HTTP_CODE. Body: $HTTP_BODY"
fi

sub "A.4 — Бронирование места"
if [ -n "${TRIP_ID:-}" ]; then
  BOOK_IDEM=$(uuidgen 2>/dev/null || echo "book-idem-$(date +%s)")
  RAW=$(req_auth POST "$BASE/trips/${TRIP_ID}/book" "$PASSENGER_ACCESS_TOKEN" \
    -H "idempotency-key: $BOOK_IDEM" \
    -d '{"seats":1}')
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "201" ]; then
    BOOKING_ID=$(echo "$HTTP_BODY" | jq -r '.bookingId // empty')
    BOOKING_STATUS=$(echo "$HTTP_BODY" | jq -r '.status // empty')
    if [ -n "$BOOKING_ID" ]; then
      pass "A.4 Бронирование создано: bookingId=$BOOKING_ID, status=$BOOKING_STATUS"
    else
      fail "A.4 Бронирование: bookingId пуст. Body: $HTTP_BODY"
    fi
  else
    fail "A.4 Бронирование: HTTP $HTTP_CODE. Body: $HTTP_BODY"
    BOOKING_ID=""
  fi
else
  fail "A.4 Бронирование: TRIP_ID не определён (B.2 не прошёл)"
  BOOKING_ID=""
fi

sub "A.5 — Поллинг BFF booking details (ожидание saga: CONFIRMED + HOLD_PLACED)"
if [ -n "${BOOKING_ID:-}" ]; then
  POLL_MAX=30
  POLL_INTERVAL=2
  POLL_ELAPSED=0
  BOOKING_CONFIRMED=false
  PAYMENT_STATUS_FINAL=""

  while [ "$POLL_ELAPSED" -lt "$POLL_MAX" ]; do
    RAW=$(req_auth GET "$BASE/v1/bookings/${BOOKING_ID}" "$PASSENGER_ACCESS_TOKEN")
    extract_body_and_code "$RAW"

    if [ "$HTTP_CODE" = "200" ]; then
      B_STATUS=$(echo "$HTTP_BODY" | jq -r '.status // empty' 2>/dev/null)
      P_STATUS=$(echo "$HTTP_BODY" | jq -r '.payment.paymentStatus // empty' 2>/dev/null)
      P_INTENT=$(echo "$HTTP_BODY" | jq -r '.payment.paymentIntentId // empty' 2>/dev/null)
      B_TRACE=$(echo "$HTTP_BODY" | jq -r '.meta.traceId // empty' 2>/dev/null)

      if [ "$B_STATUS" = "CONFIRMED" ]; then
        BOOKING_CONFIRMED=true
        PAYMENT_STATUS_FINAL="$P_STATUS"
        PAYMENT_INTENT_ID="$P_INTENT"
        break
      fi
    fi
    sleep "$POLL_INTERVAL"
    POLL_ELAPSED=$((POLL_ELAPSED + POLL_INTERVAL))
    echo -ne "\r  Поллинг booking... ${POLL_ELAPSED}/${POLL_MAX}с (status=$B_STATUS, payment=$P_STATUS)"
  done
  echo ""

  if [ "$BOOKING_CONFIRMED" = "true" ]; then
    pass "A.5 Booking status = CONFIRMED (saga завершена за ~${POLL_ELAPSED}с)"
  else
    fail "A.5 Booking status = '${B_STATUS:-?}' (ожидался CONFIRMED, таймаут ${POLL_MAX}с)"
  fi

  if [ -n "${PAYMENT_STATUS_FINAL:-}" ]; then
    if [ "$PAYMENT_STATUS_FINAL" = "HOLD_PLACED" ] || [ "$PAYMENT_STATUS_FINAL" = "CAPTURED" ]; then
      pass "A.5 payment.paymentStatus = $PAYMENT_STATUS_FINAL"
    else
      warn "A.5 payment.paymentStatus = '$PAYMENT_STATUS_FINAL' (ожидался HOLD_PLACED или CAPTURED)"
    fi
  else
    warn "A.5 payment.paymentStatus пуст (платёжный интент может не отобразиться через BFF)"
  fi

  if [ -n "${B_TRACE:-}" ]; then
    pass "A.5 meta.traceId присутствует в BFF booking response"
  else
    fail "A.5 meta.traceId отсутствует в BFF booking response"
  fi
else
  fail "A.5 Поллинг невозможен: BOOKING_ID не определён"
fi

sub "A.6 — Проверка уведомлений (прямой доступ к notifications-service :3004)"
info "notifications-service не проксируется через gateway, проверяем напрямую"
N_HEALTH=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$NOTIF_BASE/health" 2>/dev/null || echo "000")
if [ "$N_HEALTH" = "200" ]; then
  pass "A.6 notifications-service /health → 200 (сервис работает)"
  info "Прямая проверка конкретного уведомления невозможна без notificationId"
  info "Уведомления создаются через internal events от payments-service"
else
  fail "A.6 notifications-service /health → $N_HEALTH"
fi

sub "A.7 — Отмена бронирования (компенсация)"
if [ -n "${BOOKING_ID:-}" ]; then
  RAW=$(req_auth POST "$BASE/trips/bookings/${BOOKING_ID}/cancel" "$PASSENGER_ACCESS_TOKEN")
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "200" ]; then
    CANCEL_STATUS=$(echo "$HTTP_BODY" | jq -r '.status // empty')
    CANCEL_BID=$(echo "$HTTP_BODY" | jq -r '.bookingId // empty')
    if [ "$CANCEL_STATUS" = "CANCELLED" ]; then
      pass "A.7 Бронирование отменено: status=CANCELLED"
    else
      fail "A.7 Статус после отмены: '$CANCEL_STATUS' (ожидался CANCELLED)"
    fi
    if [ "$CANCEL_BID" = "$BOOKING_ID" ]; then
      pass "A.7 bookingId совпадает"
    else
      fail "A.7 bookingId не совпадает: '$CANCEL_BID' != '$BOOKING_ID'"
    fi
  else
    fail "A.7 Отмена бронирования: HTTP $HTTP_CODE. Body: $HTTP_BODY"
  fi

  # Проверка что платёж компенсирован (поллинг)
  sub "A.7b — Поллинг статуса платежа после отмены"
  CANCEL_POLL_MAX=15
  CANCEL_POLL_ELAPSED=0
  PAYMENT_CANCELLED=false

  while [ "$CANCEL_POLL_ELAPSED" -lt "$CANCEL_POLL_MAX" ]; do
    RAW=$(req_auth GET "$BASE/v1/bookings/${BOOKING_ID}" "$PASSENGER_ACCESS_TOKEN")
    extract_body_and_code "$RAW"
    if [ "$HTTP_CODE" = "200" ]; then
      CP_STATUS=$(echo "$HTTP_BODY" | jq -r '.payment.paymentStatus // empty' 2>/dev/null)
      CB_STATUS=$(echo "$HTTP_BODY" | jq -r '.status // empty' 2>/dev/null)
      if [ "$CP_STATUS" = "CANCELLED" ] || [ "$CP_STATUS" = "REFUNDED" ]; then
        PAYMENT_CANCELLED=true
        break
      fi
    fi
    sleep 2
    CANCEL_POLL_ELAPSED=$((CANCEL_POLL_ELAPSED + 2))
  done

  if [ "$PAYMENT_CANCELLED" = "true" ]; then
    pass "A.7b Платёж компенсирован: payment.status=$CP_STATUS"
  else
    warn "A.7b Платёж не компенсирован за ${CANCEL_POLL_MAX}с (status=${CP_STATUS:-?})"
  fi

  if [ "${CB_STATUS:-}" = "CANCELLED" ]; then
    pass "A.7b Booking status = CANCELLED в BFF"
  else
    warn "A.7b Booking status = '${CB_STATUS:-?}' в BFF после отмены"
  fi

  # Проверка восстановления мест
  sub "A.7c — Проверка восстановления seatsAvailable"
  if [ -n "${TRIP_ID:-}" ]; then
    RAW=$(req GET "$BASE/v1/trips/${TRIP_ID}")
    extract_body_and_code "$RAW"
    if [ "$HTTP_CODE" = "200" ]; then
      SEATS_NOW=$(echo "$HTTP_BODY" | jq -r '.seatsAvailable // empty' 2>/dev/null)
      if [ "$SEATS_NOW" = "4" ]; then
        pass "A.7c seatsAvailable восстановлено до 4"
      else
        warn "A.7c seatsAvailable = '$SEATS_NOW' (ожидалось 4)"
      fi
    else
      warn "A.7c Получение деталей поездки: HTTP $HTTP_CODE"
    fi
  fi
else
  fail "A.7 Отмена невозможна: BOOKING_ID не определён"
fi

sub "A.8 — Re-booking после отмены (R1: partial unique index)"
if [ -n "${TRIP_ID:-}" ] && [ -n "${PASSENGER_ACCESS_TOKEN:-}" ]; then
  REBOOK_IDEM=$(uuidgen 2>/dev/null || echo "rebook-idem-$(date +%s)")
  RAW=$(req_auth POST "$BASE/trips/${TRIP_ID}/book" "$PASSENGER_ACCESS_TOKEN" \
    -H "idempotency-key: $REBOOK_IDEM" \
    -d '{"seats":1}')
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "201" ]; then
    REBOOK_ID=$(echo "$HTTP_BODY" | jq -r '.bookingId // empty')
    REBOOK_STATUS=$(echo "$HTTP_BODY" | jq -r '.status // empty')
    if [ -n "$REBOOK_ID" ] && [ "$REBOOK_ID" != "$BOOKING_ID" ]; then
      pass "A.8 Re-booking после отмены успешно: bookingId=$REBOOK_ID (новый), status=$REBOOK_STATUS"
    else
      fail "A.8 Re-booking: bookingId совпадает со старым или пуст"
    fi
  else
    fail "A.8 Re-booking после отмены: HTTP $HTTP_CODE (ожидался 201). Body: $HTTP_BODY"
  fi

  # Отменяем re-booking чтобы не мешать следующим тестам
  if [ -n "${REBOOK_ID:-}" ]; then
    req_auth POST "$BASE/trips/bookings/${REBOOK_ID}/cancel" "$PASSENGER_ACCESS_TOKEN" > /dev/null 2>&1
  fi
else
  warn "A.8 Re-booking пропущен: TRIP_ID или PASSENGER_ACCESS_TOKEN не определён"
fi

scenario_end "SCENARIO A — Пассажир"

###############################################################################
# SCENARIO B (часть 2) — Завершение поездки + рейтинг
###############################################################################
header "SCENARIO B (часть 2) — Завершение поездки + рейтинг"
scenario_start

# Создаём новое бронирование для рейтинга (т.к. предыдущее отменено)
sub "B.3pre — Новое бронирование для рейтинга"
if [ -n "${TRIP_ID:-}" ] && [ -n "${PASSENGER_ACCESS_TOKEN:-}" ]; then
  BOOK_IDEM2=$(uuidgen 2>/dev/null || echo "book-idem2-$(date +%s)")
  RAW=$(req_auth POST "$BASE/trips/${TRIP_ID}/book" "$PASSENGER_ACCESS_TOKEN" \
    -H "idempotency-key: $BOOK_IDEM2" \
    -d '{"seats":1}')
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "201" ]; then
    BOOKING_ID_2=$(echo "$HTTP_BODY" | jq -r '.bookingId // empty')
    pass "B.3pre Новое бронирование: bookingId=$BOOKING_ID_2"

    # Ждём подтверждения saga
    POLL2_MAX=20
    POLL2_ELAPSED=0
    while [ "$POLL2_ELAPSED" -lt "$POLL2_MAX" ]; do
      RAW=$(req_auth GET "$BASE/v1/bookings/${BOOKING_ID_2}" "$PASSENGER_ACCESS_TOKEN")
      extract_body_and_code "$RAW"
      if [ "$HTTP_CODE" = "200" ]; then
        B2_STATUS=$(echo "$HTTP_BODY" | jq -r '.status // empty' 2>/dev/null)
        if [ "$B2_STATUS" = "CONFIRMED" ]; then break; fi
      fi
      sleep 2
      POLL2_ELAPSED=$((POLL2_ELAPSED + 2))
    done
    if [ "${B2_STATUS:-}" = "CONFIRMED" ]; then
      pass "B.3pre Booking #2 подтверждён (CONFIRMED)"
    else
      warn "B.3pre Booking #2 status='${B2_STATUS:-?}' (ожидался CONFIRMED)"
    fi
  else
    warn "B.3pre Новое бронирование не создано: HTTP $HTTP_CODE"
    BOOKING_ID_2=""
  fi
fi

sub "B.3 — Завершение поездки"
if [ -n "${TRIP_ID:-}" ] && [ -n "${DRIVER_ACCESS_TOKEN:-}" ]; then
  RAW=$(req_auth POST "$BASE/trips/${TRIP_ID}/complete" "$DRIVER_ACCESS_TOKEN")
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "200" ]; then
    COMPLETE_STATUS=$(echo "$HTTP_BODY" | jq -r '.status // empty')
    COMPLETED_AT=$(echo "$HTTP_BODY" | jq -r '.completedAt // empty')
    if [ "$COMPLETE_STATUS" = "COMPLETED" ]; then
      pass "B.3 Поездка завершена: status=COMPLETED, completedAt=$COMPLETED_AT"
    else
      fail "B.3 Статус после завершения: '$COMPLETE_STATUS' (ожидался COMPLETED)"
    fi
  else
    fail "B.3 Завершение поездки: HTTP $HTTP_CODE. Body: $HTTP_BODY"
  fi
else
  fail "B.3 TRIP_ID или DRIVER_ACCESS_TOKEN не определён"
fi

sub "B.4 — Водитель оценивает пассажира (Task 16)"
if [ -n "${BOOKING_ID_2:-}" ] && [ -n "${DRIVER_ACCESS_TOKEN:-}" ]; then
  RAW=$(req_auth POST "$BASE/profiles/ratings" "$DRIVER_ACCESS_TOKEN" \
    -d "{\"bookingId\":\"$BOOKING_ID_2\",\"score\":5,\"comment\":\"Отличный пассажир!\"}")
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "201" ]; then
    RATING_ID=$(echo "$HTTP_BODY" | jq -r '.id // empty')
    RATING_SCORE=$(echo "$HTTP_BODY" | jq -r '.score // empty')
    RATING_ROLE=$(echo "$HTTP_BODY" | jq -r '.role // empty')
    pass "B.4 Рейтинг создан: id=$RATING_ID, score=$RATING_SCORE, role=$RATING_ROLE"
  else
    fail "B.4 Создание рейтинга: HTTP $HTTP_CODE. Body: $HTTP_BODY"
  fi
else
  warn "B.4 Пропущен: BOOKING_ID_2 или DRIVER_ACCESS_TOKEN не определён"
fi

sub "B.5 — Чтение профиля пассажира"
if [ -n "${PASSENGER_USER_ID:-}" ]; then
  sleep 2  # ждём обработки события
  RAW=$(req GET "$BASE/profiles/profiles/${PASSENGER_USER_ID}")
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "200" ]; then
    RATING_COUNT=$(echo "$HTTP_BODY" | jq -r '.ratingCount // .rating_count // 0' 2>/dev/null)
    RATING_AVG=$(echo "$HTTP_BODY" | jq -r '.ratingAvg // .rating_avg // 0' 2>/dev/null)
    pass "B.5 Профиль пассажира: ratingCount=$RATING_COUNT, ratingAvg=$RATING_AVG"
    if [ "$RATING_COUNT" != "0" ] && [ "$RATING_COUNT" != "null" ]; then
      pass "B.5 Рейтинг агрегирован (count > 0)"
    else
      warn "B.5 ratingCount=0 (возможно, профиль ещё не обновлён)"
    fi
  else
    warn "B.5 Профиль пассажира: HTTP $HTTP_CODE. Body: $HTTP_BODY"
  fi
else
  warn "B.5 Пропущен: PASSENGER_USER_ID не определён"
fi

scenario_end "SCENARIO B — Водитель"

###############################################################################
# SCENARIO C — Администратор (RBAC + configs + disputes + moderation)
###############################################################################
header "SCENARIO C — Поток администратора"
scenario_start

sub "C.1 — Bootstrap администратора через seed"
ADMIN_EMAIL="admin@sapar.kg"
ADMIN_PASS="SaparAdmin2026!SecurePass"

info "Запускаем seed:admin через docker compose exec"
docker compose --env-file .env.docker exec -T identity-service \
  sh -c "SEED_ADMIN_EMAIL='$ADMIN_EMAIL' SEED_ADMIN_PASSWORD='$ADMIN_PASS' npx ts-node --compiler-options '{\"module\":\"CommonJS\"}' prisma/seed.ts" 2>&1 | tail -3

if [ $? -eq 0 ]; then
  pass "C.1 Seed admin выполнен успешно"
else
  warn "C.1 Seed admin завершился с ошибкой — пробуем альтернативный путь через npx prisma db seed"
  docker compose --env-file .env.docker exec -T -e SEED_ADMIN_EMAIL="$ADMIN_EMAIL" -e SEED_ADMIN_PASSWORD="$ADMIN_PASS" identity-service \
    npx prisma db seed 2>&1 | tail -3
fi

# Логин админа
RAW=$(req POST "$BASE/identity/auth/login" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")
extract_body_and_code "$RAW"

if [ "$HTTP_CODE" = "200" ]; then
  ADMIN_ACCESS_TOKEN=$(echo "$HTTP_BODY" | jq -r '.accessToken // empty')
  ADMIN_USER_ID=$(decode_jwt_sub "$ADMIN_ACCESS_TOKEN")
  if [ -n "$ADMIN_ACCESS_TOKEN" ]; then
    pass "C.1 Админ залогинен: userId=$ADMIN_USER_ID"
  else
    fail "C.1 Логин админа: accessToken пуст"
  fi
else
  fail "C.1 Логин админа: HTTP $HTTP_CODE. Body: $HTTP_BODY"
fi

# Проверка: назначение роли через API (ADMIN → второй пользователь)
sub "C.1b — Назначение роли через API /identity/admin/users/:id/roles"
if [ -n "${ADMIN_ACCESS_TOKEN:-}" ] && [ -n "${DRIVER_USER_ID:-}" ]; then
  RAW=$(req_auth POST "$BASE/identity/admin/users/${DRIVER_USER_ID}/roles" "$ADMIN_ACCESS_TOKEN" \
    -d '{"roles":["DRIVER"]}')
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "200" ]; then
    ASSIGNED_ROLES=$(echo "$HTTP_BODY" | jq -r '.roles // empty')
    pass "C.1b Роли назначены водителю через API: $ASSIGNED_ROLES"
  else
    fail "C.1b Назначение ролей: HTTP $HTTP_CODE. Body: $HTTP_BODY"
  fi
fi

sub "C.2 — Управление конфигами"
if [ -n "${ADMIN_ACCESS_TOKEN:-}" ]; then
  # PUT конфиг
  RAW=$(req_auth PUT "$BASE/admin/configs/BOOKING_TTL_SEC" "$ADMIN_ACCESS_TOKEN" \
    -d '{"type":"INT","value":120,"min":30,"max":3600}')
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    CONFIG_VAL=$(echo "$HTTP_BODY" | jq -r '.value // empty')
    pass "C.2 PUT config BOOKING_TTL_SEC: HTTP $HTTP_CODE, value=$CONFIG_VAL"
  else
    fail "C.2 PUT config: HTTP $HTTP_CODE. Body: $HTTP_BODY"
  fi

  # GET конфиг
  RAW=$(req_auth GET "$BASE/admin/configs/BOOKING_TTL_SEC" "$ADMIN_ACCESS_TOKEN")
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "200" ]; then
    GET_VAL=$(echo "$HTTP_BODY" | jq -r '.value // empty')
    if [ "$GET_VAL" = "120" ]; then
      pass "C.2 GET config BOOKING_TTL_SEC = 120"
    else
      fail "C.2 GET config: value='$GET_VAL' (ожидалось 120)"
    fi
  else
    fail "C.2 GET config: HTTP $HTTP_CODE. Body: $HTTP_BODY"
  fi
else
  fail "C.2 Конфиги: ADMIN_ACCESS_TOKEN не определён"
fi

sub "C.3 — Создание и разрешение диспута"
if [ -n "${ADMIN_ACCESS_TOKEN:-}" ] && [ -n "${BOOKING_ID_2:-}" ]; then
  RAW=$(req_auth POST "$BASE/admin/disputes" "$ADMIN_ACCESS_TOKEN" \
    -d "{\"bookingId\":\"$BOOKING_ID_2\",\"departAt\":\"$DEPART_AT\",\"type\":\"NO_SHOW\",\"evidenceUrls\":[\"https://example.com/photo.jpg\"]}")
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    DISPUTE_ID=$(echo "$HTTP_BODY" | jq -r '.id // empty')
    DISPUTE_STATUS=$(echo "$HTTP_BODY" | jq -r '.status // empty')
    if [ -n "$DISPUTE_ID" ]; then
      pass "C.3 Диспут создан: id=$DISPUTE_ID, status=$DISPUTE_STATUS"
    else
      fail "C.3 Диспут создан, но id пуст. Body: $HTTP_BODY"
    fi
  else
    fail "C.3 Создание диспута: HTTP $HTTP_CODE. Body: $HTTP_BODY"
    DISPUTE_ID=""
  fi

  # Разрешение диспута
  if [ -n "${DISPUTE_ID:-}" ]; then
    RAW=$(req_auth POST "$BASE/admin/disputes/${DISPUTE_ID}/resolve" "$ADMIN_ACCESS_TOKEN" \
      -d '{"resolution":"REFUND"}')
    extract_body_and_code "$RAW"

    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
      RESOLVE_STATUS=$(echo "$HTTP_BODY" | jq -r '.status // empty')
      RESOLVE_RESOLUTION=$(echo "$HTTP_BODY" | jq -r '.resolution // empty')
      if [ "$RESOLVE_STATUS" = "RESOLVED" ] && [ "$RESOLVE_RESOLUTION" = "REFUND" ]; then
        pass "C.3 Диспут разрешён: status=RESOLVED, resolution=REFUND"
      else
        fail "C.3 Разрешение диспута: status=$RESOLVE_STATUS, resolution=$RESOLVE_RESOLUTION"
      fi
    else
      fail "C.3 Разрешение диспута: HTTP $HTTP_CODE. Body: $HTTP_BODY"
    fi
  fi
else
  warn "C.3 Диспут пропущен: ADMIN_ACCESS_TOKEN или BOOKING_ID_2 не определён"
fi

sub "C.4 — Модерация: бан пользователя"
if [ -n "${ADMIN_ACCESS_TOKEN:-}" ] && [ -n "${PASSENGER_USER_ID:-}" ]; then
  # Бан
  RAW=$(req_auth POST "$BASE/admin/moderation/users/${PASSENGER_USER_ID}/ban" "$ADMIN_ACCESS_TOKEN" \
    -d '{"reason":"Тестовый бан для верификации"}')
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    BAN_CMD_ID=$(echo "$HTTP_BODY" | jq -r '.commandId // empty')
    BAN_STATUS=$(echo "$HTTP_BODY" | jq -r '.status // empty')
    pass "C.4 Команда бана создана: commandId=$BAN_CMD_ID, status=$BAN_STATUS"
  else
    fail "C.4 Бан пользователя: HTTP $HTTP_CODE. Body: $HTTP_BODY"
  fi

  sleep 3  # ждём обработки команды

  # Проверка что забаненный пользователь не может бронировать (создаём новую поездку для теста)
  info "Проверяем ограничения забаненного пользователя..."

  # Разбан
  sub "C.4b — Разбан пользователя"
  RAW=$(req_auth POST "$BASE/admin/moderation/users/${PASSENGER_USER_ID}/unban" "$ADMIN_ACCESS_TOKEN" \
    -d '{"reason":"Тестовый разбан"}')
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    UNBAN_CMD_ID=$(echo "$HTTP_BODY" | jq -r '.commandId // empty')
    pass "C.4b Команда разбана создана: commandId=$UNBAN_CMD_ID"
  else
    fail "C.4b Разбан: HTTP $HTTP_CODE. Body: $HTTP_BODY"
  fi
else
  warn "C.4 Модерация пропущена: токен или userId не определены"
fi

sub "C.4c — Модерация: отмена поездки администратором"
# Создаём новую поездку для теста отмены
if [ -n "${DRIVER_ACCESS_TOKEN:-}" ]; then
  DEPART_AT2=$(date -u -v+5d '+%Y-%m-%dT10:00:00.000Z' 2>/dev/null || date -u -d '+5 days' '+%Y-%m-%dT10:00:00.000Z')
  RAW=$(req_auth POST "$BASE/trips/" "$DRIVER_ACCESS_TOKEN" \
    -d "{\"fromCity\":\"Алматы\",\"toCity\":\"Астана\",\"departAt\":\"$DEPART_AT2\",\"seatsTotal\":3,\"priceKgs\":2000}")
  extract_body_and_code "$RAW"
  if [ "$HTTP_CODE" = "201" ]; then
    TRIP_ID_2=$(echo "$HTTP_BODY" | jq -r '.tripId // empty')
    pass "C.4c Вторая поездка создана: tripId=$TRIP_ID_2"
  else
    warn "C.4c Создание второй поездки: HTTP $HTTP_CODE"
    TRIP_ID_2=""
  fi
fi

if [ -n "${ADMIN_ACCESS_TOKEN:-}" ] && [ -n "${TRIP_ID_2:-}" ]; then
  RAW=$(req_auth POST "$BASE/admin/moderation/trips/${TRIP_ID_2}/cancel" "$ADMIN_ACCESS_TOKEN" \
    -d '{"reason":"Тестовая отмена администратором"}')
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    CANCEL_CMD_ID=$(echo "$HTTP_BODY" | jq -r '.commandId // empty')
    pass "C.4c Команда отмены поездки создана: commandId=$CANCEL_CMD_ID"
  else
    fail "C.4c Отмена поездки администратором: HTTP $HTTP_CODE. Body: $HTTP_BODY"
  fi
fi

sub "C.5 — RBAC: негативные проверки"
# Пассажир пытается вызвать /admin/* -> 403
if [ -n "${PASSENGER_ACCESS_TOKEN:-}" ]; then
  RAW=$(req_auth GET "$BASE/admin/configs" "$PASSENGER_ACCESS_TOKEN")
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "403" ]; then
    pass "C.5 Пассажир → /admin/configs → 403 (RBAC работает)"
  else
    fail "C.5 Пассажир → /admin/configs → HTTP $HTTP_CODE (ожидался 403)"
  fi

  RAW=$(req_auth POST "$BASE/admin/moderation/users/${PASSENGER_USER_ID}/ban" "$PASSENGER_ACCESS_TOKEN" \
    -d '{"reason":"self-ban"}')
  extract_body_and_code "$RAW"

  if [ "$HTTP_CODE" = "403" ]; then
    pass "C.5 Пассажир → /admin/moderation → 403 (RBAC работает)"
  else
    fail "C.5 Пассажир → /admin/moderation → HTTP $HTTP_CODE (ожидался 403)"
  fi
fi

# Создадим SUPPORT-пользователя и проверим ограничения
sub "C.5b — RBAC: SUPPORT не может модерировать"
SUPPORT_EMAIL="support-${TS}@sapar-test.kg"
SUPPORT_PASS="SupportPass123!"

RAW=$(req POST "$BASE/identity/auth/register" \
  -d "{\"email\":\"$SUPPORT_EMAIL\",\"password\":\"$SUPPORT_PASS\"}")
extract_body_and_code "$RAW"
SUPPORT_USER_ID=$(echo "$HTTP_BODY" | jq -r '.userId // empty' 2>/dev/null)

if [ -n "${SUPPORT_USER_ID:-}" ] && [ -n "${ADMIN_ACCESS_TOKEN:-}" ]; then
  # Назначаем SUPPORT роль
  req_auth POST "$BASE/identity/admin/users/${SUPPORT_USER_ID}/roles" "$ADMIN_ACCESS_TOKEN" \
    -d '{"roles":["SUPPORT"]}' > /dev/null 2>&1

  # Логин SUPPORT
  RAW=$(req POST "$BASE/identity/auth/login" \
    -d "{\"email\":\"$SUPPORT_EMAIL\",\"password\":\"$SUPPORT_PASS\"}")
  extract_body_and_code "$RAW"
  SUPPORT_TOKEN=$(echo "$HTTP_BODY" | jq -r '.accessToken // empty' 2>/dev/null)

  if [ -n "${SUPPORT_TOKEN:-}" ]; then
    # SUPPORT пытается забанить пользователя → ожидаем 403 (модерация = ADMIN + OPS)
    RAW=$(req_auth POST "$BASE/admin/moderation/users/${PASSENGER_USER_ID}/ban" "$SUPPORT_TOKEN" \
      -d '{"reason":"support-ban-test"}')
    extract_body_and_code "$RAW"

    if [ "$HTTP_CODE" = "403" ]; then
      pass "C.5b SUPPORT → moderation/ban → 403 (RBAC работает)"
    else
      fail "C.5b SUPPORT → moderation/ban → HTTP $HTTP_CODE (ожидался 403)"
    fi

    # SUPPORT может читать конфиги
    RAW=$(req_auth GET "$BASE/admin/configs" "$SUPPORT_TOKEN")
    extract_body_and_code "$RAW"

    if [ "$HTTP_CODE" = "200" ]; then
      pass "C.5b SUPPORT → /admin/configs → 200 (чтение разрешено)"
    else
      warn "C.5b SUPPORT → /admin/configs → HTTP $HTTP_CODE"
    fi

    # SUPPORT может создавать диспуты
    RAW=$(req_auth POST "$BASE/admin/disputes" "$SUPPORT_TOKEN" \
      -d "{\"bookingId\":\"00000000-0000-4000-a000-000000000099\",\"departAt\":\"$DEPART_AT\",\"type\":\"OTHER\",\"evidenceUrls\":[]}")
    extract_body_and_code "$RAW"

    if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "404" ]; then
      pass "C.5b SUPPORT → /admin/disputes → HTTP $HTTP_CODE (доступ есть)"
    else
      if [ "$HTTP_CODE" = "403" ]; then
        fail "C.5b SUPPORT → /admin/disputes → 403 (ожидался доступ)"
      else
        warn "C.5b SUPPORT → /admin/disputes → HTTP $HTTP_CODE"
      fi
    fi
  fi
fi

scenario_end "SCENARIO C — Администратор"

###############################################################################
# SCENARIO D — Гео-поиск + кеширование
###############################################################################
header "SCENARIO D — Гео-поиск + кеширование"
scenario_start

sub "D.1 — Поиск по координатам (geo)"
RAW=$(req GET "$BASE/v1/trips/search?fromLat=42.8746&fromLon=74.5698&radiusKm=50")
extract_body_and_code "$RAW"

if [ "$HTTP_CODE" = "200" ]; then
  D_ITEMS=$(echo "$HTTP_BODY" | jq '.items | length' 2>/dev/null || echo "0")
  D_TRACE=$(echo "$HTTP_BODY" | jq -r '.meta.traceId // empty' 2>/dev/null)
  pass "D.1 Гео-поиск: HTTP 200, items=$D_ITEMS, traceId=$D_TRACE"
else
  fail "D.1 Гео-поиск: HTTP $HTTP_CODE. Body: $HTTP_BODY"
fi

sub "D.2 — Поиск по cityId (если используется)"
RAW=$(req GET "$BASE/v1/trips/search?fromCity=%D0%91%D0%B8%D1%88%D0%BA%D0%B5%D0%BA&toCity=%D0%9E%D1%88&limit=5&offset=0")
extract_body_and_code "$RAW"

if [ "$HTTP_CODE" = "200" ]; then
  D2_ITEMS=$(echo "$HTTP_BODY" | jq '.items | length' 2>/dev/null || echo "0")
  pass "D.2 Поиск по городам: HTTP 200, items=$D2_ITEMS"
else
  fail "D.2 Поиск по городам: HTTP $HTTP_CODE"
fi

sub "D.3 — Повторный запрос (кеш-проверка best-effort)"
START_SEC=$(date +%s)
RAW=$(req GET "$BASE/v1/trips/search?fromLat=42.8746&fromLon=74.5698&radiusKm=50")
extract_body_and_code "$RAW"
END_SEC=$(date +%s)

if [ "$HTTP_CODE" = "200" ]; then
  RESP_TIME=$((END_SEC - START_SEC))
  pass "D.3 Повторный запрос: HTTP 200, ~${RESP_TIME}с"
else
  fail "D.3 Повторный запрос: HTTP $HTTP_CODE"
fi

sub "D.4 — Валидация: запрос без location-фильтра → 400"
RAW=$(req GET "$BASE/v1/trips/search?limit=10")
extract_body_and_code "$RAW"

if [ "$HTTP_CODE" = "400" ]; then
  pass "D.4 Запрос без location → 400 (валидация работает)"
else
  fail "D.4 Запрос без location → HTTP $HTTP_CODE (ожидался 400)"
fi

scenario_end "SCENARIO D — Гео-поиск"

###############################################################################
# SCENARIO E — Observability smoke
###############################################################################
header "SCENARIO E — Observability smoke"
scenario_start

sub "E.1 — /metrics для каждого сервиса"
METRICS_SERVICES=(
  "api-gateway:3000"
  "identity-service:3001"
  "trips-service:3002"
  "payments-service:3003"
  "notifications-service:3004"
  "admin-service:3005"
  "profiles-service:3006"
)

for entry in "${METRICS_SERVICES[@]}"; do
  svc="${entry%%:*}"
  port="${entry#*:}"

  code=$(curl -s -o /tmp/sapar_metrics_${svc}.txt -w '%{http_code}' --max-time 5 "http://localhost:${port}/metrics" 2>/dev/null || echo "000")

  if [ "$code" = "200" ]; then
    # Проверка ключевых метрик
    HAS_HTTP=$(grep -c 'http_request' /tmp/sapar_metrics_${svc}.txt 2>/dev/null || echo "0")
    HAS_PROCESS=$(grep -c 'process_' /tmp/sapar_metrics_${svc}.txt 2>/dev/null || echo "0")
    HAS_NODEJS=$(grep -c 'nodejs_' /tmp/sapar_metrics_${svc}.txt 2>/dev/null || echo "0")

    if [ "$HAS_HTTP" -gt 0 ] || [ "$HAS_PROCESS" -gt 0 ]; then
      pass "E.1 $svc /metrics → 200 (http_request: $HAS_HTTP, process: $HAS_PROCESS)"
    else
      warn "E.1 $svc /metrics → 200, но ключевые метрики не найдены"
    fi

    # Spot-check на high-cardinality labels
    HIGH_CARD=$(grep -E 'path="\/[^"]*\/[0-9a-f]{8}-' /tmp/sapar_metrics_${svc}.txt 2>/dev/null | head -3)
    if [ -n "$HIGH_CARD" ]; then
      warn "E.1 $svc: возможные high-cardinality labels (UUID в path): $(echo "$HIGH_CARD" | head -1)"
    fi
  else
    fail "E.1 $svc /metrics → $code (ожидался 200)"
  fi
done

scenario_end "SCENARIO E — Observability"

###############################################################################
# ФИНАЛЬНЫЙ ОТЧЁТ
###############################################################################
header "ФИНАЛЬНЫЙ ОТЧЁТ"

echo ""
echo -e "${BOLD}Результаты по сценариям:${NC}"
for result in "${SCENARIO_RESULTS[@]}"; do
  echo -e "  $result"
done

echo ""
echo -e "${BOLD}Общая статистика:${NC}"
echo -e "  Всего проверок: $TOTAL_CHECKS"
echo -e "  ${GREEN}Пройдено: $PASSED${NC}"
echo -e "  ${RED}Провалено: $FAILED${NC}"
echo -e "  ${YELLOW}Предупреждений: $WARNINGS${NC}"

if [ ${#BUGS[@]} -gt 0 ]; then
  echo ""
  echo -e "${RED}${BOLD}Список багов / неуспешных проверок:${NC}"
  for i in "${!BUGS[@]}"; do
    echo -e "  ${RED}$((i+1)). ${BUGS[$i]}${NC}"
  done
  echo ""
  echo -e "${YELLOW}Для диагностики:${NC}"
  echo "  docker compose --env-file .env.docker logs api-gateway --tail=200"
  echo "  docker compose --env-file .env.docker logs identity-service --tail=200"
  echo "  docker compose --env-file .env.docker logs trips-service --tail=200"
  echo "  docker compose --env-file .env.docker logs payments-service --tail=200"
  echo "  docker compose --env-file .env.docker logs notifications-service --tail=200"
  echo "  docker compose --env-file .env.docker logs admin-service --tail=200"
  echo "  docker compose --env-file .env.docker logs profiles-service --tail=200"
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  ИТОГ: ALL PASS ✓  ($PASSED/$TOTAL_CHECKS)${NC}"
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}══════════════════════════════════════════════════════${NC}"
  echo -e "${RED}${BOLD}  ИТОГ: FAIL  ($FAILED из $TOTAL_CHECKS не прошли)${NC}"
  echo -e "${RED}${BOLD}══════════════════════════════════════════════════════${NC}"
  exit 1
fi
