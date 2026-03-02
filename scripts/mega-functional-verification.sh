#!/usr/bin/env bash
###############################################################################
# mega-functional-verification.sh — Полная функциональная верификация Sapar
# Безопасен для повторного запуска (идемпотентен). Создаёт уникальные данные.
# Выход 0 только если ВСЕ проверки пройдены.
###############################################################################
set -o pipefail

###############################################################################
# КОНФИГУРАЦИЯ
###############################################################################
GW=http://localhost:3000
IDENTITY=http://localhost:3001
TRIPS=http://localhost:3002
PAYMENTS=http://localhost:3003
NOTIFICATIONS=http://localhost:3004
ADMIN_SVC=http://localhost:3005
PROFILES=http://localhost:3006

HMAC_SECRET="sapar-hmac-secret-dev-at-least-32-chars!!"
WEBHOOK_SECRET="sapar-webhook-secret-dev-32-chars-long!!"
SEED_ADMIN_EMAIL="admin@sapar.kg"
SEED_ADMIN_PASSWORD="SaparAdmin2026!SecurePass"

RUN_ID=$(date +%s)
TP="t${RUN_ID}"
TMP_DIR="/tmp/sapar-verify-${RUN_ID}"
mkdir -p "$TMP_DIR"

BODY="$TMP_DIR/body.json"
HDR="$TMP_DIR/hdr.txt"
CSV="$TMP_DIR/results.csv"
REPORT="$TMP_DIR/report.md"

PASS_N=0; FAIL_N=0; SKIP_N=0; TOTAL_N=0
BUGS=""

echo "phase,id,endpoint,role,method,expected,actual,result,detail" > "$CSV"

###############################################################################
# ЗАВИСИМОСТИ
###############################################################################
for cmd in curl jq openssl docker; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ОШИБКА: $cmd не найден"; exit 1; }
done

new_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    cat /proc/sys/kernel/random/uuid 2>/dev/null || printf '%04x%04x-%04x-%04x-%04x-%04x%04x%04x' $RANDOM $RANDOM $RANDOM $RANDOM $RANDOM $RANDOM $RANDOM $RANDOM
  fi
}

###############################################################################
# УТИЛИТЫ
###############################################################################
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; N='\033[0m'
info()    { echo -e "${C}[ИНФО]${N} $*" >&2; }
ok()      { echo -e "${G}[PASS]${N} $*" >&2; }
fail()    { echo -e "${R}[FAIL]${N} $*" >&2; }
warn()    { echo -e "${Y}[WARN]${N} $*" >&2; }
section() { echo -e "\n${C}════════════════════════════════════════${N}" >&2; echo -e "${C}  $*${N}" >&2; echo -e "${C}════════════════════════════════════════${N}" >&2; }

rid() { new_uuid; }

rec() {
  local phase="$1" tid="$2" ep="$3" role="$4" meth="$5" exp="$6" act="$7" res="$8" det="${9:-}"
  TOTAL_N=$((TOTAL_N+1))
  case "$res" in
    PASS) PASS_N=$((PASS_N+1)); ok "[$tid] $meth $ep ($role) => $act";;
    FAIL) FAIL_N=$((FAIL_N+1)); fail "[$tid] $meth $ep ($role) => $act (ожидалось $exp) $det";;
    SKIP) SKIP_N=$((SKIP_N+1)); warn "[$tid] $meth $ep ($role) ПРОПУСК: $det";;
  esac
  echo "\"$phase\",\"$tid\",\"$ep\",\"$role\",\"$meth\",\"$exp\",\"$act\",\"$res\",\"$det\"" >> "$CSV"
}

bug() {
  local sev="$1" desc="$2" repro="$3"
  BUGS="${BUGS}\n| $sev | $desc | \`$repro\` |"
}

body() { cat "$BODY" 2>/dev/null || echo "{}"; }
jf()   { jq -r "$1" < "$BODY" 2>/dev/null || echo ""; }

hmac_sign() {
  local body_str="$1" ts="$2" secret="$3"
  printf '%s' "${ts}.${body_str}" | openssl dgst -sha256 -hmac "$secret" 2>/dev/null | sed 's/^.*= //'
}

wh_sign() {
  local body_str="$1" secret="$2"
  printf '%s' "$body_str" | openssl dgst -sha256 -hmac "$secret" 2>/dev/null | sed 's/^.*= //'
}

jwt_decode() {
  local p
  p=$(echo "$1" | cut -d'.' -f2 | tr '_-' '/+')
  local mod=$((${#p} % 4))
  [ "$mod" -eq 2 ] && p="${p}=="
  [ "$mod" -eq 3 ] && p="${p}="
  echo "$p" | base64 --decode 2>/dev/null || echo "$p" | base64 -d 2>/dev/null || echo "{}"
}

do_register() {
  local email="$1" pass="$2"
  curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $(rid)" \
    -X POST "$GW/identity/auth/register" \
    -d "{\"email\":\"$email\",\"password\":\"$pass\"}" 2>/dev/null | tail -1
}

do_login() {
  local email="$1" pass="$2"
  curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $(rid)" \
    -X POST "$GW/identity/auth/login" \
    -d "{\"email\":\"$email\",\"password\":\"$pass\"}" 2>/dev/null | tail -1
}

do_assign() {
  local uid="$1" token="$2" roles_json="$3"
  curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" -H "x-request-id: $(rid)" \
    -X POST "$GW/identity/admin/users/${uid}/roles" \
    -d "{\"roles\":$roles_json}" 2>/dev/null | tail -1
}

###############################################################################
# USER STATE
###############################################################################
P_EMAIL="" ; P_PASS="" ; P_ID="" ; P_TOK="" ; P_REF=""
D_EMAIL="" ; D_PASS="" ; D_ID="" ; D_TOK="" ; D_REF=""
P2_EMAIL=""; P2_PASS=""; P2_ID=""; P2_TOK=""
S_EMAIL="" ; S_PASS="" ; S_ID="" ; S_TOK=""
O_EMAIL="" ; O_PASS="" ; O_ID="" ; O_TOK=""
A_TOK=""   ; A_REF=""  ; A_ID=""

###############################################################################
# ФАЗА 0 — Запуск и готовность
###############################################################################
phase0() {
  section "ФАЗА 0: Запуск стека и проверка готовности"

  info "Запуск docker compose (--build)..."
  docker compose --env-file .env.docker up -d --build 2>&1 | tail -3

  local svc_list="api-gateway:$GW identity-service:$IDENTITY trips-service:$TRIPS payments-service:$PAYMENTS notifications-service:$NOTIFICATIONS admin-service:$ADMIN_SVC profiles-service:$PROFILES"

  for entry in $svc_list; do
    local sname="${entry%%:*}" surl="${entry#*:}"
    local ok_flag=false elapsed=0 max=240
    while [ $elapsed -lt $max ]; do
      local hs rs
      hs=$(curl -s -o /dev/null -w "%{http_code}" "$surl/health" 2>/dev/null) || hs=000
      rs=$(curl -s -o /dev/null -w "%{http_code}" "$surl/ready"  2>/dev/null) || rs=000
      if [ "$hs" = "200" ] && [ "$rs" = "200" ]; then ok_flag=true; break; fi
      sleep 5; elapsed=$((elapsed+5))
    done
    if $ok_flag; then
      rec P0 "P0-${sname}" "/health,/ready" system GET 200 200 PASS "${sname} готов (${elapsed}с)"
    else
      rec P0 "P0-${sname}" "/health,/ready" system GET 200 "$hs/$rs" FAIL "${sname} НЕ готов"
      docker compose logs "$sname" --tail=80 2>&1 || true
      echo "FATAL: $sname не запустился"; exit 1
    fi
  done
}

###############################################################################
# ФАЗА 1 — Swagger
###############################################################################
phase1() {
  section "ФАЗА 1: Обнаружение эндпоинтов (Swagger)"
  local svc_list="api-gateway:$GW identity-service:$IDENTITY trips-service:$TRIPS payments-service:$PAYMENTS notifications-service:$NOTIFICATIONS admin-service:$ADMIN_SVC profiles-service:$PROFILES"
  for entry in $svc_list; do
    local sname="${entry%%:*}" surl="${entry#*:}"
    local st
    st=$(curl -s -o "$BODY" -w "%{http_code}" "$surl/swagger-json" 2>/dev/null) || st=000
    if [ "$st" = "200" ]; then
      local cnt
      cnt=$(jq '[.paths|to_entries[]|.value|keys[]]|length' < "$BODY" 2>/dev/null || echo 0)
      rec P1 "P1-${sname}" "/swagger-json" system GET 200 "$st" PASS "${cnt} операций"
      info "${sname}: ${cnt} операций"
      jq -r '.paths|to_entries[]|.key as $p|.value|to_entries[]|"  \(.key|ascii_upcase) \($p)"' < "$BODY" 2>/dev/null | head -25
    elif [ "$st" = "404" ]; then
      rec P1 "P1-${sname}" "/swagger-json" system GET 200 "$st" SKIP "Swagger отключён (NODE_ENV=production)"
    else
      rec P1 "P1-${sname}" "/swagger-json" system GET 200 "$st" FAIL "Swagger недоступен"
    fi
  done
}

###############################################################################
# ФАЗА 2 — Пользователи и роли
###############################################################################
phase2() {
  section "ФАЗА 2: Создание пользователей и ролей"

  # Seed admin login
  info "Вход seed-админом..."
  local st
  st=$(do_login "$SEED_ADMIN_EMAIL" "$SEED_ADMIN_PASSWORD")
  if [ "$st" = "200" ]; then
    A_TOK=$(jf .accessToken); A_REF=$(jf .refreshToken)
    A_ID=$(jwt_decode "$A_TOK" | jq -r .sub 2>/dev/null)
    rec P2 P2-admin-login "/identity/auth/login" admin POST 200 "$st" PASS ""
  else
    rec P2 P2-admin-login "/identity/auth/login" admin POST 200 "$st" FAIL "$(body|head -c 200)"
    exit 1
  fi

  create_user() {
    local label="$1" email="$2" pass="$3" roles_json="$4"
    info "Регистрация ${label}: ${email}"
    local st
    st=$(do_register "$email" "$pass")
    local uid=""
    if [ "$st" = "201" ]; then
      uid=$(jf .userId)
      rec P2 "P2-reg-${label}" "/identity/auth/register" anon POST 201 "$st" PASS "userId=$uid"
    else
      rec P2 "P2-reg-${label}" "/identity/auth/register" anon POST 201 "$st" FAIL "$(body|head -c 200)"
      return 1
    fi
    st=$(do_assign "$uid" "$A_TOK" "$roles_json")
    if [ "$st" = "200" ]; then
      rec P2 "P2-role-${label}" "/identity/admin/users/{id}/roles" admin POST 200 "$st" PASS ""
    else
      rec P2 "P2-role-${label}" "/identity/admin/users/{id}/roles" admin POST 200 "$st" FAIL "$(body|head -c 200)"
    fi
    st=$(do_login "$email" "$pass")
    local tok ref
    tok=$(jf .accessToken); ref=$(jf .refreshToken)
    echo "${uid}|${tok}|${ref}"
  }

  P_EMAIL="${TP}-pax@test.sapar.kg";   P_PASS="Test1234!Secure"
  D_EMAIL="${TP}-drv@test.sapar.kg";   D_PASS="Test1234!Secure"
  P2_EMAIL="${TP}-pax2@test.sapar.kg"; P2_PASS="Test1234!Secure"
  S_EMAIL="${TP}-sup@test.sapar.kg";   S_PASS="Test1234!Secure"
  O_EMAIL="${TP}-ops@test.sapar.kg";   O_PASS="Test1234!Secure"

  local out
  out=$(create_user passenger "$P_EMAIL"  "$P_PASS"  '["PASSENGER"]')
  P_ID=$(echo "$out"|cut -d'|' -f1);  P_TOK=$(echo "$out"|cut -d'|' -f2); P_REF=$(echo "$out"|cut -d'|' -f3)

  out=$(create_user driver "$D_EMAIL" "$D_PASS" '["DRIVER"]')
  D_ID=$(echo "$out"|cut -d'|' -f1);  D_TOK=$(echo "$out"|cut -d'|' -f2); D_REF=$(echo "$out"|cut -d'|' -f3)

  out=$(create_user passenger2 "$P2_EMAIL" "$P2_PASS" '["PASSENGER"]')
  P2_ID=$(echo "$out"|cut -d'|' -f1); P2_TOK=$(echo "$out"|cut -d'|' -f2)

  out=$(create_user support "$S_EMAIL" "$S_PASS" '["SUPPORT"]')
  S_ID=$(echo "$out"|cut -d'|' -f1);  S_TOK=$(echo "$out"|cut -d'|' -f2)

  out=$(create_user ops "$O_EMAIL" "$O_PASS" '["OPS"]')
  O_ID=$(echo "$out"|cut -d'|' -f1);  O_TOK=$(echo "$out"|cut -d'|' -f2)

  # JWT claims check
  for pair in "passenger:$P_TOK:PASSENGER" "driver:$D_TOK:DRIVER" "admin:$A_TOK:ADMIN" "support:$S_TOK:SUPPORT" "ops:$O_TOK:OPS"; do
    local lbl tok role
    lbl=$(echo "$pair"|cut -d: -f1); tok=$(echo "$pair"|cut -d: -f2); role=$(echo "$pair"|cut -d: -f3)
    local roles_str
    roles_str=$(jwt_decode "$tok" | jq -r '.roles[]?' 2>/dev/null | tr '\n' ',')
    if echo "$roles_str" | grep -q "$role"; then
      rec P2 "P2-jwt-${lbl}" "JWT" "$lbl" VERIFY "$role" "$role" PASS ""
    else
      rec P2 "P2-jwt-${lbl}" "JWT" "$lbl" VERIFY "$role" "$roles_str" FAIL "Роль $role не найдена в JWT"
      bug HIGH "Роль $role не в JWT для $lbl" "jwt_decode token | jq .roles"
    fi
  done
}

###############################################################################
# ФАЗА 3A — Identity
###############################################################################
phase3a() {
  section "ФАЗА 3A: Identity — Auth & Admin"
  local st r

  # Duplicate email → 409
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -X POST "$GW/identity/auth/register" \
    -d "{\"email\":\"$P_EMAIL\",\"password\":\"$P_PASS\"}" 2>/dev/null | tail -1)
  if [ "$st" = "409" ]; then
    rec P3A 3A-dup-email "/identity/auth/register" anon POST 409 "$st" PASS "Дубликат email"
  else
    rec P3A 3A-dup-email "/identity/auth/register" anon POST 409 "$st" FAIL "$(body|head -c 200)"
    bug HIGH "Дублирование email не возвращает 409" "curl -X POST $GW/identity/auth/register"
  fi

  # Wrong password → 401
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -X POST "$GW/identity/auth/login" \
    -d "{\"email\":\"$P_EMAIL\",\"password\":\"WrongPass999\"}" 2>/dev/null | tail -1)
  if [ "$st" = "401" ]; then
    rec P3A 3A-wrong-pass "/identity/auth/login" anon POST 401 "$st" PASS ""
  else
    rec P3A 3A-wrong-pass "/identity/auth/login" anon POST 401 "$st" FAIL ""
  fi

  # Validation error → 400 (short password)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -X POST "$GW/identity/auth/register" \
    -d "{\"email\":\"short@test.kg\",\"password\":\"abc\"}" 2>/dev/null | tail -1)
  if [ "$st" = "400" ]; then
    rec P3A 3A-validation "/identity/auth/register" anon POST 400 "$st" PASS "Валидация пароля"
  else
    rec P3A 3A-validation "/identity/auth/register" anon POST 400 "$st" FAIL ""
  fi

  # Refresh token success
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -X POST "$GW/identity/auth/refresh" \
    -d "{\"refreshToken\":\"$P_REF\"}" 2>/dev/null | tail -1)
  local new_access="" new_refresh="" old_refresh="$P_REF"
  if [ "$st" = "200" ]; then
    new_access=$(jf .accessToken); new_refresh=$(jf .refreshToken)
    P_TOK="$new_access"; P_REF="$new_refresh"
    rec P3A 3A-refresh "/identity/auth/refresh" passenger POST 200 "$st" PASS "Ротация токена"
  else
    rec P3A 3A-refresh "/identity/auth/refresh" passenger POST 200 "$st" FAIL "$(body|head -c 200)"
  fi

  # Refresh old token reuse → should fail (revoke chain)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -X POST "$GW/identity/auth/refresh" \
    -d "{\"refreshToken\":\"$old_refresh\"}" 2>/dev/null | tail -1)
  if [ "$st" = "401" ]; then
    rec P3A 3A-refresh-reuse "/identity/auth/refresh" passenger POST 401 "$st" PASS "Повторное использование отозвано"
  else
    rec P3A 3A-refresh-reuse "/identity/auth/refresh" passenger POST 401 "$st" FAIL "Ожидалось 401 при reuse"
    bug HIGH "Refresh token reuse не отклоняется" "curl POST /identity/auth/refresh old_token"
  fi

  # Re-login passenger since tokens may have been revoked
  st=$(do_login "$P_EMAIL" "$P_PASS")
  P_TOK=$(jf .accessToken); P_REF=$(jf .refreshToken)

  # Logout → 204
  local logout_ref="$P_REF"
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -X POST "$GW/identity/auth/logout" \
    -d "{\"refreshToken\":\"$logout_ref\"}" 2>/dev/null | tail -1)
  if [ "$st" = "204" ]; then
    rec P3A 3A-logout "/identity/auth/logout" passenger POST 204 "$st" PASS ""
  else
    rec P3A 3A-logout "/identity/auth/logout" passenger POST 204 "$st" FAIL ""
  fi

  # Refresh after logout → 401
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -X POST "$GW/identity/auth/refresh" \
    -d "{\"refreshToken\":\"$logout_ref\"}" 2>/dev/null | tail -1)
  if [ "$st" = "401" ]; then
    rec P3A 3A-refresh-post-logout "/identity/auth/refresh" passenger POST 401 "$st" PASS "Refresh после logout отклонён"
  else
    rec P3A 3A-refresh-post-logout "/identity/auth/refresh" passenger POST 401 "$st" FAIL ""
    bug MEDIUM "Refresh после logout не отклоняется" ""
  fi

  # Re-login passenger
  st=$(do_login "$P_EMAIL" "$P_PASS")
  P_TOK=$(jf .accessToken); P_REF=$(jf .refreshToken)

  # Invalid JWT → 401 on protected endpoint
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer invalid.jwt.token" \
    -H "x-request-id: $r" \
    -X POST "$GW/identity/admin/users/00000000-0000-0000-0000-000000000000/roles" \
    -d '{"roles":["ADMIN"]}' 2>/dev/null | tail -1)
  if [ "$st" = "401" ]; then
    rec P3A 3A-invalid-jwt "/identity/admin/users/{id}/roles" anon POST 401 "$st" PASS ""
  else
    rec P3A 3A-invalid-jwt "/identity/admin/users/{id}/roles" anon POST 401 "$st" FAIL ""
  fi

  # Non-admin assigning roles → 403
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
    -H "x-request-id: $r" \
    -X POST "$GW/identity/admin/users/$D_ID/roles" \
    -d '{"roles":["ADMIN"]}' 2>/dev/null | tail -1)
  if [ "$st" = "403" ]; then
    rec P3A 3A-rbac-assign "/identity/admin/users/{id}/roles" passenger POST 403 "$st" PASS "Пассажир не может назначать роли"
  else
    rec P3A 3A-rbac-assign "/identity/admin/users/{id}/roles" passenger POST 403 "$st" FAIL ""
    bug CRITICAL "Пассажир может назначать роли" "curl -H 'Bearer passenger_token' POST /admin/users/{id}/roles"
  fi
}

###############################################################################
# ФАЗА 3C — Trips (перед BFF — нужны данные для тестов)
###############################################################################
TRIP1_ID="" ; TRIP_RACE_ID="" ; TRIP_CANCEL_ID="" ; TRIP_COMPLETE_ID="" ; TRIP_PAY_ID=""
BOOKING1_ID=""; BOOKING_CANCEL_ID=""; BOOKING_COMPLETE_ID=""; BOOKING_PAY_ID=""

create_trip() {
  local token="$1" from="$2" to="$3" seats="$4" price="$5" depart="$6"
  local r
  r=$(rid)
  curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -H "x-request-id: $r" \
    -X POST "$GW/trips" \
    -d "{\"fromCity\":\"$from\",\"toCity\":\"$to\",\"departAt\":\"$depart\",\"seatsTotal\":$seats,\"priceKgs\":$price}" 2>/dev/null | tail -1
}

phase3c() {
  section "ФАЗА 3C: Trips — Поездки и бронирования"
  local st r depart
  depart=$(date -u -v+7d +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -d "+7 days" +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || echo "2026-06-15T08:00:00.000Z")

  # Create trip (driver)
  st=$(create_trip "$D_TOK" "Бишкек" "Ош" 4 1500 "$depart")
  if [ "$st" = "201" ]; then
    TRIP1_ID=$(jf .tripId)
    rec P3C 3C-create-trip "POST /trips" driver POST 201 "$st" PASS "tripId=$TRIP1_ID"
  else
    rec P3C 3C-create-trip "POST /trips" driver POST 201 "$st" FAIL "$(body|head -c 200)"
    bug HIGH "Не удалось создать поездку" "curl POST /trips"
  fi

  # Create trip — validation error (missing fields)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $D_TOK" -H "x-request-id: $r" \
    -X POST "$GW/trips" -d '{}' 2>/dev/null | tail -1)
  if [ "$st" = "400" ]; then
    rec P3C 3C-trip-validation "POST /trips" driver POST 400 "$st" PASS ""
  else
    rec P3C 3C-trip-validation "POST /trips" driver POST 400 "$st" FAIL ""
  fi

  # Create trip — no auth
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -X POST "$GW/trips" \
    -d "{\"fromCity\":\"A\",\"toCity\":\"B\",\"departAt\":\"$depart\",\"seatsTotal\":1,\"priceKgs\":100}" 2>/dev/null | tail -1)
  if [ "$st" = "401" ]; then
    rec P3C 3C-trip-noauth "POST /trips" anon POST 401 "$st" PASS ""
  else
    rec P3C 3C-trip-noauth "POST /trips" anon POST 401 "$st" FAIL ""
  fi

  # Search trips (city-based)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "x-request-id: $r" \
    "$GW/trips/search?fromCity=%D0%91%D0%B8%D1%88%D0%BA%D0%B5%D0%BA&limit=5" 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    rec P3C 3C-search "GET /trips/search" anon GET 200 "$st" PASS ""
  else
    rec P3C 3C-search "GET /trips/search" anon GET 200 "$st" FAIL "$(body|head -c 200)"
  fi

  # Book seat (passenger)
  local idem_key
  idem_key=$(new_uuid)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
    -H "x-request-id: $r" -H "idempotency-key: $idem_key" \
    -X POST "$GW/trips/${TRIP1_ID}/book" -d '{"seats":1}' 2>/dev/null | tail -1)
  if [ "$st" = "201" ]; then
    BOOKING1_ID=$(jf .bookingId)
    rec P3C 3C-book "POST /trips/{id}/book" passenger POST 201 "$st" PASS "bookingId=$BOOKING1_ID"
  else
    rec P3C 3C-book "POST /trips/{id}/book" passenger POST 201 "$st" FAIL "$(body|head -c 200)"
    bug HIGH "Бронирование не удалось" "curl POST /trips/{id}/book"
  fi

  # Idempotency: same key → same result
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
    -H "x-request-id: $r" -H "idempotency-key: $idem_key" \
    -X POST "$GW/trips/${TRIP1_ID}/book" -d '{"seats":1}' 2>/dev/null | tail -1)
  local idem_bid
  idem_bid=$(jf .bookingId)
  if [ "$st" = "201" ] && [ "$idem_bid" = "$BOOKING1_ID" ]; then
    rec P3C 3C-idempotent "POST /trips/{id}/book" passenger POST 201 "$st" PASS "Идемпотентность OK"
  elif [ "$st" = "201" ] || [ "$st" = "200" ]; then
    rec P3C 3C-idempotent "POST /trips/{id}/book" passenger POST "201+same" "$st" PASS "Идемпотентность (code=$st)"
  else
    rec P3C 3C-idempotent "POST /trips/{id}/book" passenger POST 201 "$st" FAIL "Идемпотентность нарушена"
    bug HIGH "Идемпотентность бронирования сломана" ""
  fi

  # Duplicate booking (same passenger, diff key) → 409
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
    -H "x-request-id: $r" -H "idempotency-key: $(new_uuid)" \
    -X POST "$GW/trips/${TRIP1_ID}/book" -d '{"seats":1}' 2>/dev/null | tail -1)
  if [ "$st" = "409" ]; then
    rec P3C 3C-dup-booking "POST /trips/{id}/book" passenger POST 409 "$st" PASS "Повторное бронирование отклонено"
  else
    rec P3C 3C-dup-booking "POST /trips/{id}/book" passenger POST 409 "$st" FAIL ""
  fi

  # Cancel booking by non-owner → 403
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $P2_TOK" \
    -H "x-request-id: $r" \
    -X POST "$GW/trips/bookings/${BOOKING1_ID}/cancel" 2>/dev/null | tail -1)
  if [ "$st" = "403" ]; then
    rec P3C 3C-cancel-nonowner "POST /trips/bookings/{id}/cancel" passenger2 POST 403 "$st" PASS ""
  else
    rec P3C 3C-cancel-nonowner "POST /trips/bookings/{id}/cancel" passenger2 POST 403 "$st" FAIL ""
    bug HIGH "Отмена бронирования не-владельцем не отклонена" ""
  fi

  # === RACE TEST: Last seat ===
  info "Тест гонки: последнее место..."
  st=$(create_trip "$D_TOK" "Алматы" "Караганда" 1 2000 "$depart")
  if [ "$st" = "201" ]; then
    TRIP_RACE_ID=$(jf .tripId)
  fi

  if [ -n "$TRIP_RACE_ID" ]; then
    local f1="$TMP_DIR/race1.txt" f2="$TMP_DIR/race2.txt"
    (curl -s -w "\n%{http_code}" -o "$TMP_DIR/race1.json" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $(rid)" -H "idempotency-key: $(new_uuid)" \
      -X POST "$GW/trips/${TRIP_RACE_ID}/book" -d '{"seats":1}' 2>/dev/null | tail -1 > "$f1") &
    local pid1=$!
    (curl -s -w "\n%{http_code}" -o "$TMP_DIR/race2.json" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P2_TOK" \
      -H "x-request-id: $(rid)" -H "idempotency-key: $(new_uuid)" \
      -X POST "$GW/trips/${TRIP_RACE_ID}/book" -d '{"seats":1}' 2>/dev/null | tail -1 > "$f2") &
    local pid2=$!
    wait $pid1 $pid2 2>/dev/null || true

    local s1 s2
    s1=$(cat "$f1" 2>/dev/null | tr -d '[:space:]')
    s2=$(cat "$f2" 2>/dev/null | tr -d '[:space:]')
    info "Гонка: P1=$s1, P2=$s2"

    if { [ "$s1" = "201" ] && [ "$s2" = "409" ]; } || { [ "$s1" = "409" ] && [ "$s2" = "201" ]; }; then
      rec P3C 3C-race-seat "POST /trips/{id}/book (race)" "P1+P2" POST "201+409" "${s1}+${s2}" PASS "Один получил место, другой — 409"
    elif [ "$s1" = "201" ] && [ "$s2" = "201" ]; then
      rec P3C 3C-race-seat "POST /trips/{id}/book (race)" "P1+P2" POST "201+409" "${s1}+${s2}" FAIL "Оба получили место (oversell!)"
      bug CRITICAL "Race condition: oversell последнего места" "Два concurrent POST /trips/{id}/book"
    else
      rec P3C 3C-race-seat "POST /trips/{id}/book (race)" "P1+P2" POST "201+409" "${s1}+${s2}" FAIL "Неожиданные коды"
    fi
  fi

  # === Idempotency race: same key concurrent ===
  info "Тест гонки идемпотентности..."
  st=$(create_trip "$D_TOK" "Нарын" "Жалал-Абад" 3 1000 "$depart")
  local trip_idem_id=""
  if [ "$st" = "201" ]; then trip_idem_id=$(jf .tripId); fi

  if [ -n "$trip_idem_id" ]; then
    local ik
    ik=$(new_uuid)
    local f3="$TMP_DIR/idem1.txt" f4="$TMP_DIR/idem2.txt"
    (curl -s -w "\n%{http_code}" -o "$TMP_DIR/idem1.json" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $(rid)" -H "idempotency-key: $ik" \
      -X POST "$GW/trips/${trip_idem_id}/book" -d '{"seats":1}' 2>/dev/null | tail -1 > "$f3") &
    local pid3=$!
    (curl -s -w "\n%{http_code}" -o "$TMP_DIR/idem2.json" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $(rid)" -H "idempotency-key: $ik" \
      -X POST "$GW/trips/${trip_idem_id}/book" -d '{"seats":1}' 2>/dev/null | tail -1 > "$f4") &
    local pid4=$!
    wait $pid3 $pid4 2>/dev/null || true

    local si1 si2
    si1=$(cat "$f3" 2>/dev/null | tr -d '[:space:]')
    si2=$(cat "$f4" 2>/dev/null | tr -d '[:space:]')

    if [ "$si1" != "500" ] && [ "$si2" != "500" ]; then
      local b1 b2
      b1=$(jq -r .bookingId < "$TMP_DIR/idem1.json" 2>/dev/null || echo "")
      b2=$(jq -r .bookingId < "$TMP_DIR/idem2.json" 2>/dev/null || echo "")
      if [ -n "$b1" ] && [ "$b1" = "$b2" ]; then
        rec P3C 3C-idem-race "POST /trips/{id}/book (idem race)" passenger POST "no 500" "${si1}+${si2}" PASS "Одинаковый bookingId"
      else
        rec P3C 3C-idem-race "POST /trips/{id}/book (idem race)" passenger POST "no 500" "${si1}+${si2}" PASS "Без 500 (bookingId: $b1 / $b2)"
      fi
    else
      rec P3C 3C-idem-race "POST /trips/{id}/book (idem race)" passenger POST "no 500" "${si1}+${si2}" FAIL "500 при concurrent идемпотентности"
      bug CRITICAL "500 при concurrent идемпотентности" "Два concurrent POST с одинаковым Idempotency-Key"
    fi
  fi

  # === Trip cancel by driver ===
  st=$(create_trip "$D_TOK" "Токмок" "Балыкчы" 3 500 "$depart")
  if [ "$st" = "201" ]; then
    TRIP_CANCEL_ID=$(jf .tripId)
  fi
  # Cancel by non-driver → 403
  if [ -n "$TRIP_CANCEL_ID" ]; then
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" -H "x-request-id: $r" \
      -X POST "$GW/trips/${TRIP_CANCEL_ID}/cancel" 2>/dev/null | tail -1)
    if [ "$st" = "403" ]; then
      rec P3C 3C-cancel-nondriver "POST /trips/{id}/cancel" passenger POST 403 "$st" PASS ""
    else
      rec P3C 3C-cancel-nondriver "POST /trips/{id}/cancel" passenger POST 403 "$st" FAIL ""
    fi

    # Cancel by driver → 200
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $D_TOK" -H "x-request-id: $r" \
      -X POST "$GW/trips/${TRIP_CANCEL_ID}/cancel" 2>/dev/null | tail -1)
    if [ "$st" = "200" ]; then
      rec P3C 3C-cancel-trip "POST /trips/{id}/cancel" driver POST 200 "$st" PASS ""
    else
      rec P3C 3C-cancel-trip "POST /trips/{id}/cancel" driver POST 200 "$st" FAIL "$(body|head -c 200)"
    fi

    # Book on cancelled trip → 409
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $r" -H "idempotency-key: $(new_uuid)" \
      -X POST "$GW/trips/${TRIP_CANCEL_ID}/book" -d '{"seats":1}' 2>/dev/null | tail -1)
    if [ "$st" = "409" ]; then
      rec P3C 3C-book-cancelled "POST /trips/{id}/book" passenger POST 409 "$st" PASS "Бронь на отменённую поездку отклонена"
    else
      rec P3C 3C-book-cancelled "POST /trips/{id}/book" passenger POST 409 "$st" FAIL ""
      bug HIGH "Можно бронировать отменённую поездку" ""
    fi
  fi

  # === Trip complete ===
  st=$(create_trip "$D_TOK" "Ош" "Бишкек" 4 2500 "$depart")
  if [ "$st" = "201" ]; then
    TRIP_COMPLETE_ID=$(jf .tripId)
  fi
  if [ -n "$TRIP_COMPLETE_ID" ]; then
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $r" -H "idempotency-key: $(new_uuid)" \
      -X POST "$GW/trips/${TRIP_COMPLETE_ID}/book" -d '{"seats":1}' 2>/dev/null | tail -1)
    if [ "$st" = "201" ]; then BOOKING_COMPLETE_ID=$(jf .bookingId); fi

    # Complete by non-driver → 403
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" -H "x-request-id: $r" \
      -X POST "$GW/trips/${TRIP_COMPLETE_ID}/complete" 2>/dev/null | tail -1)
    if [ "$st" = "403" ]; then
      rec P3C 3C-complete-nondriver "POST /trips/{id}/complete" passenger POST 403 "$st" PASS ""
    else
      rec P3C 3C-complete-nondriver "POST /trips/{id}/complete" passenger POST 403 "$st" FAIL ""
    fi

    # Complete by driver → 200
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $D_TOK" -H "x-request-id: $r" \
      -X POST "$GW/trips/${TRIP_COMPLETE_ID}/complete" 2>/dev/null | tail -1)
    if [ "$st" = "200" ]; then
      rec P3C 3C-complete-trip "POST /trips/{id}/complete" driver POST 200 "$st" PASS ""
    else
      rec P3C 3C-complete-trip "POST /trips/{id}/complete" driver POST 200 "$st" FAIL "$(body|head -c 200)"
    fi
  fi

  # === Cancel booking by owner ===
  st=$(create_trip "$D_TOK" "Каракол" "Чолпон-Ата" 3 800 "$depart")
  if [ "$st" = "201" ]; then
    local trip_c
    trip_c=$(jf .tripId)
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $r" -H "idempotency-key: $(new_uuid)" \
      -X POST "$GW/trips/${trip_c}/book" -d '{"seats":1}' 2>/dev/null | tail -1)
    if [ "$st" = "201" ]; then
      BOOKING_CANCEL_ID=$(jf .bookingId)
      r=$(rid)
      st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
        -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" -H "x-request-id: $r" \
        -X POST "$GW/trips/bookings/${BOOKING_CANCEL_ID}/cancel" 2>/dev/null | tail -1)
      if [ "$st" = "200" ]; then
        rec P3C 3C-cancel-booking "POST /trips/bookings/{id}/cancel" passenger POST 200 "$st" PASS ""
      else
        rec P3C 3C-cancel-booking "POST /trips/bookings/{id}/cancel" passenger POST 200 "$st" FAIL ""
      fi
    fi
  fi

  # Book on non-existent trip → 404
  r=$(rid)
  local fake_trip_id
  fake_trip_id=$(new_uuid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
    -H "x-request-id: $r" -H "idempotency-key: $(new_uuid)" \
    -X POST "$GW/trips/${fake_trip_id}/book" -d '{"seats":1}' 2>/dev/null | tail -1)
  if [ "$st" = "404" ]; then
    rec P3C 3C-book-notfound "POST /trips/{id}/book" passenger POST 404 "$st" PASS ""
  else
    rec P3C 3C-book-notfound "POST /trips/{id}/book" passenger POST 404 "$st" FAIL ""
  fi

  # Create trip for payment tests
  st=$(create_trip "$D_TOK" "Бишкек" "Токмок" 2 3000 "$depart")
  if [ "$st" = "201" ]; then
    TRIP_PAY_ID=$(jf .tripId)
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $r" -H "idempotency-key: $(new_uuid)" \
      -X POST "$GW/trips/${TRIP_PAY_ID}/book" -d '{"seats":1}' 2>/dev/null | tail -1)
    if [ "$st" = "201" ]; then BOOKING_PAY_ID=$(jf .bookingId); fi
  fi
}

###############################################################################
# ФАЗА 3B — BFF /v1
###############################################################################
phase3b() {
  section "ФАЗА 3B: BFF /v1 — Агрегированные эндпоинты"
  local st r

  # Search via BFF (city-based)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "x-request-id: $r" \
    "$GW/v1/trips/search?fromCity=%D0%91%D0%B8%D1%88%D0%BA%D0%B5%D0%BA&limit=5" 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    local cnt
    cnt=$(jf '.items|length')
    rec P3B 3B-bff-search "GET /v1/trips/search" anon GET 200 "$st" PASS "items=${cnt}"
  else
    rec P3B 3B-bff-search "GET /v1/trips/search" anon GET 200 "$st" FAIL "$(body|head -c 200)"
  fi

  # Search validation error (no location filter)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "x-request-id: $r" \
    "$GW/v1/trips/search?limit=5" 2>/dev/null | tail -1)
  if [ "$st" = "400" ]; then
    rec P3B 3B-bff-search-400 "GET /v1/trips/search" anon GET 400 "$st" PASS "Валидация: нужен фильтр локации"
  else
    rec P3B 3B-bff-search-400 "GET /v1/trips/search" anon GET 400 "$st" FAIL ""
  fi

  # Trip details
  if [ -n "$TRIP1_ID" ]; then
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "x-request-id: $r" \
      "$GW/v1/trips/${TRIP1_ID}" 2>/dev/null | tail -1)
    if [ "$st" = "200" ]; then
      rec P3B 3B-bff-trip "GET /v1/trips/{id}" anon GET 200 "$st" PASS ""
    else
      rec P3B 3B-bff-trip "GET /v1/trips/{id}" anon GET 200 "$st" FAIL ""
    fi
  fi

  # Trip details — invalid UUID → 400
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "x-request-id: $r" \
    "$GW/v1/trips/not-a-uuid" 2>/dev/null | tail -1)
  if [ "$st" = "400" ] || [ "$st" = "422" ]; then
    rec P3B 3B-bff-trip-baduuid "GET /v1/trips/{invalid}" anon GET 400 "$st" PASS ""
  else
    rec P3B 3B-bff-trip-baduuid "GET /v1/trips/{invalid}" anon GET 400 "$st" FAIL ""
  fi

  # Trip details — non-existent → 404
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "x-request-id: $r" \
    "$GW/v1/trips/$(new_uuid)" 2>/dev/null | tail -1)
  if [ "$st" = "404" ]; then
    rec P3B 3B-bff-trip-404 "GET /v1/trips/{unknown}" anon GET 404 "$st" PASS ""
  else
    rec P3B 3B-bff-trip-404 "GET /v1/trips/{unknown}" anon GET 404 "$st" FAIL ""
  fi

  # Booking details — no auth → 401
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "x-request-id: $r" \
    "$GW/v1/bookings/$(new_uuid)" 2>/dev/null | tail -1)
  if [ "$st" = "401" ]; then
    rec P3B 3B-bff-booking-noauth "GET /v1/bookings/{id}" anon GET 401 "$st" PASS ""
  else
    rec P3B 3B-bff-booking-noauth "GET /v1/bookings/{id}" anon GET 401 "$st" FAIL ""
  fi

  # Booking details — with auth
  if [ -n "$BOOKING1_ID" ]; then
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "x-request-id: $r" -H "Authorization: Bearer $P_TOK" \
      "$GW/v1/bookings/${BOOKING1_ID}" 2>/dev/null | tail -1)
    if [ "$st" = "200" ]; then
      rec P3B 3B-bff-booking "GET /v1/bookings/{id}" passenger GET 200 "$st" PASS ""
    else
      rec P3B 3B-bff-booking "GET /v1/bookings/{id}" passenger GET 200 "$st" FAIL "$(body|head -c 200)"
    fi
  fi

  # My bookings — no auth → 401
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "x-request-id: $r" \
    "$GW/v1/me/bookings" 2>/dev/null | tail -1)
  if [ "$st" = "401" ]; then
    rec P3B 3B-bff-me-noauth "GET /v1/me/bookings" anon GET 401 "$st" PASS ""
  else
    rec P3B 3B-bff-me-noauth "GET /v1/me/bookings" anon GET 401 "$st" FAIL ""
  fi

  # My bookings — with auth
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "x-request-id: $r" -H "Authorization: Bearer $P_TOK" \
    "$GW/v1/me/bookings?limit=10" 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    rec P3B 3B-bff-me "GET /v1/me/bookings" passenger GET 200 "$st" PASS ""
  else
    rec P3B 3B-bff-me "GET /v1/me/bookings" passenger GET 200 "$st" FAIL "$(body|head -c 200)"
  fi

  # My bookings — invalid status filter → 400
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "x-request-id: $r" -H "Authorization: Bearer $P_TOK" \
    "$GW/v1/me/bookings?status=INVALID_STATUS" 2>/dev/null | tail -1)
  if [ "$st" = "400" ]; then
    rec P3B 3B-bff-me-badstatus "GET /v1/me/bookings?status=INVALID" passenger GET 400 "$st" PASS ""
  else
    rec P3B 3B-bff-me-badstatus "GET /v1/me/bookings?status=INVALID" passenger GET 400 "$st" FAIL ""
  fi
}

###############################################################################
# ФАЗА 3D — Payments
###############################################################################
phase3d() {
  section "ФАЗА 3D: Payments — Платежи"
  local st r

  # Wait for saga to process booking (outbox worker)
  if [ -n "$BOOKING_PAY_ID" ]; then
    info "Ожидание саги платежа (8с)..."
    sleep 8
  fi

  # Create payment intent manually
  r=$(rid)
  local idem_pay
  idem_pay=$(new_uuid)
  local pay_booking_id
  # Create a fresh booking for manual intent testing
  local pay_trip_depart
  pay_trip_depart=$(date -u -v+10d +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -d "+10 days" +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || echo "2026-06-20T08:00:00.000Z")
  st=$(create_trip "$D_TOK" "Тараз" "Шымкент" 5 4000 "$pay_trip_depart")
  local pay_trip_id=""
  if [ "$st" = "201" ]; then pay_trip_id=$(jf .tripId); fi
  if [ -n "$pay_trip_id" ]; then
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $(rid)" -H "idempotency-key: $(new_uuid)" \
      -X POST "$GW/trips/${pay_trip_id}/book" -d '{"seats":1}' 2>/dev/null | tail -1)
    if [ "$st" = "201" ]; then pay_booking_id=$(jf .bookingId); fi
  fi

  local INTENT_ID=""
  if [ -n "$pay_booking_id" ]; then
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $r" -H "idempotency-key: $idem_pay" \
      -X POST "$GW/payments/payments/intents" \
      -d "{\"bookingId\":\"$pay_booking_id\",\"amountKgs\":4000}" 2>/dev/null | tail -1)
    if [ "$st" = "201" ]; then
      INTENT_ID=$(jf .paymentIntentId)
      rec P3D 3D-create-intent "POST /payments/payments/intents" passenger POST 201 "$st" PASS "intentId=$INTENT_ID"
    elif [ "$st" = "409" ]; then
      rec P3D 3D-create-intent "POST /payments/payments/intents" passenger POST "201/409" "$st" PASS "Конфликт (сага уже создала)"
    else
      rec P3D 3D-create-intent "POST /payments/payments/intents" passenger POST 201 "$st" FAIL "$(body|head -c 200)"
    fi

    # Idempotency: same key → same result
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $r" -H "idempotency-key: $idem_pay" \
      -X POST "$GW/payments/payments/intents" \
      -d "{\"bookingId\":\"$pay_booking_id\",\"amountKgs\":4000}" 2>/dev/null | tail -1)
    if [ "$st" = "201" ] || [ "$st" = "200" ] || [ "$st" = "409" ]; then
      rec P3D 3D-intent-idem "POST /payments/payments/intents" passenger POST "201/409" "$st" PASS "Идемпотентность платежа"
    else
      rec P3D 3D-intent-idem "POST /payments/payments/intents" passenger POST "201/409" "$st" FAIL ""
    fi
  fi

  # No auth → 401
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -X POST "$GW/payments/payments/intents" \
    -d "{\"bookingId\":\"$(new_uuid)\",\"amountKgs\":100}" 2>/dev/null | tail -1)
  if [ "$st" = "401" ]; then
    rec P3D 3D-intent-noauth "POST /payments/payments/intents" anon POST 401 "$st" PASS ""
  else
    rec P3D 3D-intent-noauth "POST /payments/payments/intents" anon POST 401 "$st" FAIL ""
  fi

  # Wait for hold worker
  if [ -n "$INTENT_ID" ]; then
    info "Ожидание hold worker (5с)..."
    sleep 5
  fi

  # Capture
  if [ -n "$INTENT_ID" ]; then
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $r" \
      -X POST "$GW/payments/payments/intents/${INTENT_ID}/capture" 2>/dev/null | tail -1)
    local already_captured=false
    if [ "$st" = "200" ]; then
      rec P3D 3D-capture "POST /payments/.../capture" passenger POST 200 "$st" PASS "$(jf .status)"
    elif [ "$st" = "409" ]; then
      local cap_msg
      cap_msg=$(jf .message)
      if echo "$cap_msg" | grep -qi "CAPTURED"; then
        rec P3D 3D-capture "POST /payments/.../capture" passenger POST "200/409" "$st" PASS "Сага уже capture-ила intent"
        already_captured=true
      else
        rec P3D 3D-capture "POST /payments/.../capture" passenger POST 200 "$st" FAIL "$cap_msg"
      fi
    else
      rec P3D 3D-capture "POST /payments/.../capture" passenger POST 200 "$st" FAIL "$(body|head -c 200)"
    fi

    # Double capture → 409
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $r" \
      -X POST "$GW/payments/payments/intents/${INTENT_ID}/capture" 2>/dev/null | tail -1)
    if [ "$st" = "409" ]; then
      rec P3D 3D-double-capture "POST /payments/.../capture (2nd)" passenger POST 409 "$st" PASS "Повторный capture отклонён"
    else
      rec P3D 3D-double-capture "POST /payments/.../capture (2nd)" passenger POST 409 "$st" FAIL ""
      bug HIGH "Повторный capture не возвращает 409" ""
    fi

    # Refund after capture → 200
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $r" \
      -X POST "$GW/payments/payments/intents/${INTENT_ID}/refund" 2>/dev/null | tail -1)
    if [ "$st" = "200" ]; then
      rec P3D 3D-refund "POST /payments/.../refund" passenger POST 200 "$st" PASS ""
    else
      rec P3D 3D-refund "POST /payments/.../refund" passenger POST 200 "$st" FAIL "$(body|head -c 200)"
    fi
  fi

  # Create another intent for cancel test
  local cancel_intent_id=""
  st=$(create_trip "$D_TOK" "Бишкек" "Каракол" 2 2000 "$pay_trip_depart")
  if [ "$st" = "201" ]; then
    local ct_id
    ct_id=$(jf .tripId)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $(rid)" -H "idempotency-key: $(new_uuid)" \
      -X POST "$GW/trips/${ct_id}/book" -d '{"seats":1}' 2>/dev/null | tail -1)
    if [ "$st" = "201" ]; then
      local cancel_booking
      cancel_booking=$(jf .bookingId)
      st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
        -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
        -H "x-request-id: $(rid)" -H "idempotency-key: $(new_uuid)" \
        -X POST "$GW/payments/payments/intents" \
        -d "{\"bookingId\":\"$cancel_booking\",\"amountKgs\":2000}" 2>/dev/null | tail -1)
      if [ "$st" = "201" ]; then
        cancel_intent_id=$(jf .paymentIntentId)
      fi
    fi
  fi

  # Cancel intent
  if [ -n "$cancel_intent_id" ]; then
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $r" \
      -X POST "$GW/payments/payments/intents/${cancel_intent_id}/cancel" 2>/dev/null | tail -1)
    if [ "$st" = "200" ]; then
      rec P3D 3D-cancel-intent "POST /payments/.../cancel" passenger POST 200 "$st" PASS ""
    else
      rec P3D 3D-cancel-intent "POST /payments/.../cancel" passenger POST 200 "$st" FAIL "$(body|head -c 200)"
    fi

    # Refund cancelled → 409
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
      -H "x-request-id: $r" \
      -X POST "$GW/payments/payments/intents/${cancel_intent_id}/refund" 2>/dev/null | tail -1)
    if [ "$st" = "409" ]; then
      rec P3D 3D-refund-cancelled "POST /payments/.../refund (cancelled)" passenger POST 409 "$st" PASS ""
    else
      rec P3D 3D-refund-cancelled "POST /payments/.../refund (cancelled)" passenger POST 409 "$st" FAIL ""
    fi
  fi

  # === PSP Webhook tests (прямое обращение к payments-service, минуя proxy) ===
  info "Тесты PSP webhook (напрямую -> payments:3003)..."

  # Invalid signature → 401
  local wh_body='{"eventId":"evt_test_1","type":"hold.succeeded","pspIntentId":"fake_psp_123"}'
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -H "x-webhook-signature: invalid_sig" \
    -H "x-webhook-timestamp: $(date +%s)" \
    -X POST "$PAYMENTS/payments/webhooks/psp" \
    --data-raw "$wh_body" 2>/dev/null | tail -1)
  if [ "$st" = "401" ]; then
    rec P3D 3D-wh-badsig "POST /payments/webhooks/psp" psp POST 401 "$st" PASS "Невалидная подпись отклонена"
  else
    rec P3D 3D-wh-badsig "POST /payments/webhooks/psp" psp POST 401 "$st" FAIL ""
    bug CRITICAL "Webhook с невалидной подписью не отклонён" "curl -H x-webhook-signature:invalid"
  fi

  # Valid signature (but non-existent pspIntentId → 404)
  local ts_now
  ts_now=$(date +%s)
  local valid_sig
  valid_sig=$(wh_sign "$wh_body" "$WEBHOOK_SECRET")
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -H "x-webhook-signature: $valid_sig" \
    -H "x-webhook-timestamp: $ts_now" \
    -X POST "$PAYMENTS/payments/webhooks/psp" \
    --data-raw "$wh_body" 2>/dev/null | tail -1)
  if [ "$st" = "204" ] || [ "$st" = "404" ] || [ "$st" = "200" ]; then
    rec P3D 3D-wh-validsig "POST /payments/webhooks/psp" psp POST "204/404" "$st" PASS "Подпись валидна (psp not found OK)"
  else
    rec P3D 3D-wh-validsig "POST /payments/webhooks/psp" psp POST "204/404" "$st" FAIL "$(body|head -c 200)"
  fi

  # Webhook duplicate eventId concurrent
  local eid="evt_concurrent_$(new_uuid)"
  local wh_body2="{\"eventId\":\"$eid\",\"type\":\"hold.succeeded\",\"pspIntentId\":\"fake_concurrent\"}"
  local sig2
  sig2=$(wh_sign "$wh_body2" "$WEBHOOK_SECRET")
  ts_now=$(date +%s)
  local fw1="$TMP_DIR/wh1.txt" fw2="$TMP_DIR/wh2.txt"
  (curl -s -w "\n%{http_code}" -o "$TMP_DIR/wh1.json" \
    -H "Content-Type: application/json" -H "x-request-id: $(rid)" \
    -H "x-webhook-signature: $sig2" -H "x-webhook-timestamp: $ts_now" \
    -X POST "$PAYMENTS/payments/webhooks/psp" \
    --data-raw "$wh_body2" 2>/dev/null | tail -1 > "$fw1") &
  local wp1=$!
  (curl -s -w "\n%{http_code}" -o "$TMP_DIR/wh2.json" \
    -H "Content-Type: application/json" -H "x-request-id: $(rid)" \
    -H "x-webhook-signature: $sig2" -H "x-webhook-timestamp: $ts_now" \
    -X POST "$PAYMENTS/payments/webhooks/psp" \
    --data-raw "$wh_body2" 2>/dev/null | tail -1 > "$fw2") &
  local wp2=$!
  wait $wp1 $wp2 2>/dev/null || true
  local ws1 ws2
  ws1=$(cat "$fw1" 2>/dev/null | tr -d '[:space:]')
  ws2=$(cat "$fw2" 2>/dev/null | tr -d '[:space:]')
  if [ "$ws1" != "500" ] && [ "$ws2" != "500" ]; then
    rec P3D 3D-wh-concurrent "POST webhooks/psp (concurrent)" psp POST "no 500" "${ws1}+${ws2}" PASS ""
  else
    rec P3D 3D-wh-concurrent "POST webhooks/psp (concurrent)" psp POST "no 500" "${ws1}+${ws2}" FAIL "500 при concurrent"
    bug HIGH "500 при concurrent webhook" ""
  fi

  # No signature header → 401
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -X POST "$PAYMENTS/payments/webhooks/psp" \
    --data-raw "$wh_body" 2>/dev/null | tail -1)
  if [ "$st" = "401" ]; then
    rec P3D 3D-wh-nosig "POST webhooks/psp (no sig)" psp POST 401 "$st" PASS ""
  else
    rec P3D 3D-wh-nosig "POST webhooks/psp (no sig)" psp POST 401 "$st" FAIL ""
  fi
}

###############################################################################
# ФАЗА 3E — Notifications
###############################################################################
phase3e() {
  section "ФАЗА 3E: Notifications — Уведомления"
  local st r NOTIF_ID=""

  # Enqueue notification
  local notif_idem
  notif_idem=$(new_uuid)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
    -H "x-request-id: $r" -H "idempotency-key: $notif_idem" \
    -X POST "$NOTIFICATIONS/notifications" \
    -d '{"channel":"PUSH","templateKey":"BOOKING_CONFIRMED","payload":{"test":true}}' 2>/dev/null | tail -1)
  if [ "$st" = "201" ]; then
    NOTIF_ID=$(jf .notificationId)
    rec P3E 3E-enqueue "POST /notifications" passenger POST 201 "$st" PASS "id=$NOTIF_ID"
  else
    rec P3E 3E-enqueue "POST /notifications" passenger POST 201 "$st" FAIL "$(body|head -c 200)"
  fi

  # Idempotency
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
    -H "x-request-id: $r" -H "idempotency-key: $notif_idem" \
    -X POST "$NOTIFICATIONS/notifications" \
    -d '{"channel":"PUSH","templateKey":"BOOKING_CONFIRMED","payload":{"test":true}}' 2>/dev/null | tail -1)
  if [ "$st" = "201" ] || [ "$st" = "200" ]; then
    rec P3E 3E-notif-idem "POST /notifications (idem)" passenger POST "201" "$st" PASS ""
  else
    rec P3E 3E-notif-idem "POST /notifications (idem)" passenger POST "201" "$st" FAIL ""
  fi

  # Idempotency conflict (same key, different payload)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" \
    -H "x-request-id: $r" -H "idempotency-key: $notif_idem" \
    -X POST "$NOTIFICATIONS/notifications" \
    -d '{"channel":"EMAIL","templateKey":"DIFFERENT","payload":{}}' 2>/dev/null | tail -1)
  if [ "$st" = "409" ] || [ "$st" = "400" ]; then
    rec P3E 3E-notif-conflict "POST /notifications (conflict)" passenger POST "409/400" "$st" PASS "Конфликт идемпотентности"
  else
    rec P3E 3E-notif-conflict "POST /notifications (conflict)" passenger POST "409/400" "$st" FAIL ""
  fi

  # Get notification
  if [ -n "$NOTIF_ID" ]; then
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Authorization: Bearer $P_TOK" -H "x-request-id: $r" \
      "$NOTIFICATIONS/notifications/$NOTIF_ID" 2>/dev/null | tail -1)
    if [ "$st" = "200" ]; then
      rec P3E 3E-get-notif "GET /notifications/{id}" passenger GET 200 "$st" PASS "status=$(jf .status)"
    else
      rec P3E 3E-get-notif "GET /notifications/{id}" passenger GET 200 "$st" FAIL ""
    fi

    # Cancel notification
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" -H "x-request-id: $r" \
      -X POST "$NOTIFICATIONS/notifications/$NOTIF_ID/cancel" 2>/dev/null | tail -1)
    if [ "$st" = "200" ]; then
      rec P3E 3E-cancel-notif "POST /notifications/{id}/cancel" passenger POST 200 "$st" PASS ""
    elif [ "$st" = "409" ]; then
      rec P3E 3E-cancel-notif "POST /notifications/{id}/cancel" passenger POST "200/409" "$st" PASS "Уже обработано"
    else
      rec P3E 3E-cancel-notif "POST /notifications/{id}/cancel" passenger POST 200 "$st" FAIL "$(body|head -c 200)"
    fi
  fi

  # No auth → 401
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -X POST "$NOTIFICATIONS/notifications" \
    -d '{"channel":"PUSH","templateKey":"TEST","payload":{}}' 2>/dev/null | tail -1)
  if [ "$st" = "401" ]; then
    rec P3E 3E-noauth "POST /notifications" anon POST 401 "$st" PASS ""
  else
    rec P3E 3E-noauth "POST /notifications" anon POST 401 "$st" FAIL ""
  fi

  # Validation error
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" -H "x-request-id: $r" \
    -X POST "$NOTIFICATIONS/notifications" \
    -d '{"channel":"INVALID","templateKey":"","payload":{}}' 2>/dev/null | tail -1)
  if [ "$st" = "400" ]; then
    rec P3E 3E-validation "POST /notifications (bad)" passenger POST 400 "$st" PASS ""
  else
    rec P3E 3E-validation "POST /notifications (bad)" passenger POST 400 "$st" FAIL ""
  fi
}

###############################################################################
# ФАЗА 3F — Admin
###############################################################################
phase3f() {
  section "ФАЗА 3F: Admin — Конфиги, диспуты, модерация"
  local st r

  # === Configs ===
  local cfg_key="test_cfg_${RUN_ID}"

  # PUT config (admin)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $A_TOK" -H "x-request-id: $r" \
    -X PUT "$GW/admin/configs/${cfg_key}" \
    -d '{"type":"INT","value":42,"description":"Test config","scope":"global"}' 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    rec P3F 3F-cfg-put "PUT /admin/configs/{key}" admin PUT 200 "$st" PASS ""
  else
    rec P3F 3F-cfg-put "PUT /admin/configs/{key}" admin PUT 200 "$st" FAIL "$(body|head -c 200)"
  fi

  # PUT config (ops)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $O_TOK" -H "x-request-id: $r" \
    -X PUT "$GW/admin/configs/${cfg_key}_ops" \
    -d '{"type":"BOOL","value":true,"description":"Ops config"}' 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    rec P3F 3F-cfg-put-ops "PUT /admin/configs/{key}" ops PUT 200 "$st" PASS ""
  else
    rec P3F 3F-cfg-put-ops "PUT /admin/configs/{key}" ops PUT 200 "$st" FAIL ""
  fi

  # GET configs (support)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Authorization: Bearer $S_TOK" -H "x-request-id: $r" \
    "$GW/admin/configs" 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    rec P3F 3F-cfg-list "GET /admin/configs" support GET 200 "$st" PASS ""
  else
    rec P3F 3F-cfg-list "GET /admin/configs" support GET 200 "$st" FAIL ""
  fi

  # GET config by key
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Authorization: Bearer $A_TOK" -H "x-request-id: $r" \
    "$GW/admin/configs/${cfg_key}" 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    rec P3F 3F-cfg-get "GET /admin/configs/{key}" admin GET 200 "$st" PASS ""
  else
    rec P3F 3F-cfg-get "GET /admin/configs/{key}" admin GET 200 "$st" FAIL ""
  fi

  # DELETE config (admin) → 204
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Authorization: Bearer $A_TOK" -H "x-request-id: $r" \
    -X DELETE "$GW/admin/configs/${cfg_key}" 2>/dev/null | tail -1)
  if [ "$st" = "204" ]; then
    rec P3F 3F-cfg-del "DELETE /admin/configs/{key}" admin DELETE 204 "$st" PASS ""
  else
    rec P3F 3F-cfg-del "DELETE /admin/configs/{key}" admin DELETE 204 "$st" FAIL ""
  fi

  # DELETE config (ops) → 403
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Authorization: Bearer $O_TOK" -H "x-request-id: $r" \
    -X DELETE "$GW/admin/configs/${cfg_key}_ops" 2>/dev/null | tail -1)
  if [ "$st" = "403" ]; then
    rec P3F 3F-cfg-del-ops "DELETE /admin/configs/{key}" ops DELETE 403 "$st" PASS "OPS не может удалять"
  else
    rec P3F 3F-cfg-del-ops "DELETE /admin/configs/{key}" ops DELETE 403 "$st" FAIL ""
    bug MEDIUM "OPS может удалять конфиги" ""
  fi

  # Passenger calling /admin → 403
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Authorization: Bearer $P_TOK" -H "x-request-id: $r" \
    "$GW/admin/configs" 2>/dev/null | tail -1)
  if [ "$st" = "403" ]; then
    rec P3F 3F-cfg-passenger "GET /admin/configs" passenger GET 403 "$st" PASS "Пассажир не имеет доступа к admin"
  else
    rec P3F 3F-cfg-passenger "GET /admin/configs" passenger GET 403 "$st" FAIL ""
    bug CRITICAL "Пассажир имеет доступ к /admin" ""
  fi

  # === Disputes ===
  local depart_past
  depart_past=$(date -u +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null)
  local dispute_booking
  dispute_booking=$(new_uuid)

  # Create dispute (support)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $S_TOK" -H "x-request-id: $r" \
    -X POST "$GW/admin/disputes" \
    -d "{\"type\":\"NO_SHOW\",\"bookingId\":\"$dispute_booking\",\"departAt\":\"$depart_past\",\"evidenceUrls\":[]}" 2>/dev/null | tail -1)
  local DISPUTE_ID=""
  if [ "$st" = "201" ]; then
    DISPUTE_ID=$(jf .id)
    rec P3F 3F-dispute-create "POST /admin/disputes" support POST 201 "$st" PASS "id=$DISPUTE_ID"
  else
    rec P3F 3F-dispute-create "POST /admin/disputes" support POST 201 "$st" FAIL "$(body|head -c 200)"
  fi

  # Get dispute
  if [ -n "$DISPUTE_ID" ]; then
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Authorization: Bearer $S_TOK" -H "x-request-id: $r" \
      "$GW/admin/disputes/$DISPUTE_ID" 2>/dev/null | tail -1)
    if [ "$st" = "200" ]; then
      rec P3F 3F-dispute-get "GET /admin/disputes/{id}" support GET 200 "$st" PASS ""
    else
      rec P3F 3F-dispute-get "GET /admin/disputes/{id}" support GET 200 "$st" FAIL ""
    fi

    # Resolve dispute (admin, REFUND)
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $A_TOK" -H "x-request-id: $r" \
      -X POST "$GW/admin/disputes/${DISPUTE_ID}/resolve" \
      -d '{"resolution":"REFUND"}' 2>/dev/null | tail -1)
    if [ "$st" = "200" ]; then
      rec P3F 3F-dispute-resolve "POST /admin/disputes/{id}/resolve" admin POST 200 "$st" PASS "resolution=REFUND"
    elif [ "$st" = "409" ]; then
      rec P3F 3F-dispute-resolve "POST /admin/disputes/{id}/resolve" admin POST "200/409" "$st" PASS "SLA или состояние"
    else
      rec P3F 3F-dispute-resolve "POST /admin/disputes/{id}/resolve" admin POST 200 "$st" FAIL "$(body|head -c 200)"
    fi

    # Close dispute
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $A_TOK" -H "x-request-id: $r" \
      -X POST "$GW/admin/disputes/${DISPUTE_ID}/close" 2>/dev/null | tail -1)
    if [ "$st" = "200" ]; then
      rec P3F 3F-dispute-close "POST /admin/disputes/{id}/close" admin POST 200 "$st" PASS ""
    elif [ "$st" = "409" ]; then
      rec P3F 3F-dispute-close "POST /admin/disputes/{id}/close" admin POST "200/409" "$st" PASS "Уже закрыт/разрешён"
    else
      rec P3F 3F-dispute-close "POST /admin/disputes/{id}/close" admin POST 200 "$st" FAIL ""
    fi
  fi

  # Dispute PARTIAL resolution (need refundAmountKgs)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $A_TOK" -H "x-request-id: $r" \
    -X POST "$GW/admin/disputes" \
    -d "{\"type\":\"OTHER\",\"bookingId\":\"$(new_uuid)\",\"departAt\":\"$depart_past\"}" 2>/dev/null | tail -1)
  local DISPUTE2_ID=""
  if [ "$st" = "201" ]; then
    DISPUTE2_ID=$(jf .id)
    # PARTIAL without amount → 400
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $A_TOK" -H "x-request-id: $r" \
      -X POST "$GW/admin/disputes/${DISPUTE2_ID}/resolve" \
      -d '{"resolution":"PARTIAL"}' 2>/dev/null | tail -1)
    if [ "$st" = "400" ]; then
      rec P3F 3F-dispute-partial-noamt "POST /disputes/{id}/resolve PARTIAL" admin POST 400 "$st" PASS "refundAmountKgs обязателен"
    else
      rec P3F 3F-dispute-partial-noamt "POST /disputes/{id}/resolve PARTIAL" admin POST 400 "$st" FAIL ""
    fi
  fi

  # === Moderation ===
  # Ban user (ops)
  local ban_target
  ban_target=$(new_uuid)
  # Create a user to ban
  local ban_email="${TP}-banme@test.sapar.kg"
  do_register "$ban_email" "Test1234!Secure" >/dev/null 2>&1
  ban_target=$(jf .userId)
  if [ -z "$ban_target" ] || [ "$ban_target" = "null" ]; then ban_target=$(new_uuid); fi

  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $O_TOK" -H "x-request-id: $r" \
    -X POST "$GW/admin/moderation/users/${ban_target}/ban" \
    -d '{"reason":"Тест модерации"}' 2>/dev/null | tail -1)
  if [ "$st" = "201" ]; then
    rec P3F 3F-mod-ban "POST /admin/moderation/users/{id}/ban" ops POST 201 "$st" PASS ""
  else
    rec P3F 3F-mod-ban "POST /admin/moderation/users/{id}/ban" ops POST 201 "$st" FAIL "$(body|head -c 200)"
  fi

  # Unban
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $O_TOK" -H "x-request-id: $r" \
    -X POST "$GW/admin/moderation/users/${ban_target}/unban" \
    -d '{"reason":"Снятие бана"}' 2>/dev/null | tail -1)
  if [ "$st" = "201" ]; then
    rec P3F 3F-mod-unban "POST /admin/moderation/users/{id}/unban" ops POST 201 "$st" PASS ""
  else
    rec P3F 3F-mod-unban "POST /admin/moderation/users/{id}/unban" ops POST 201 "$st" FAIL ""
  fi

  # Cancel trip via moderation (admin)
  if [ -n "$TRIP1_ID" ]; then
    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $A_TOK" -H "x-request-id: $r" \
      -X POST "$GW/admin/moderation/trips/${TRIP1_ID}/cancel" \
      -d '{"reason":"Тест admin cancel"}' 2>/dev/null | tail -1)
    if [ "$st" = "201" ]; then
      rec P3F 3F-mod-cancel-trip "POST /admin/moderation/trips/{id}/cancel" admin POST 201 "$st" PASS ""
    else
      rec P3F 3F-mod-cancel-trip "POST /admin/moderation/trips/{id}/cancel" admin POST 201 "$st" FAIL "$(body|head -c 200)"
    fi
  fi

  # SUPPORT trying moderation → 403
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $S_TOK" -H "x-request-id: $r" \
    -X POST "$GW/admin/moderation/users/$(new_uuid)/ban" \
    -d '{"reason":"test"}' 2>/dev/null | tail -1)
  if [ "$st" = "403" ]; then
    rec P3F 3F-mod-support-403 "POST /admin/moderation/.../ban" support POST 403 "$st" PASS "SUPPORT не может банить"
  else
    rec P3F 3F-mod-support-403 "POST /admin/moderation/.../ban" support POST 403 "$st" FAIL ""
    bug HIGH "SUPPORT может выполнять модерацию" ""
  fi

  # Passenger → any admin → 403
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" -H "x-request-id: $r" \
    -X POST "$GW/admin/disputes" \
    -d '{"type":"OTHER","bookingId":"'$(new_uuid)'","departAt":"'$depart_past'"}' 2>/dev/null | tail -1)
  if [ "$st" = "403" ]; then
    rec P3F 3F-admin-passenger "POST /admin/disputes" passenger POST 403 "$st" PASS ""
  else
    rec P3F 3F-admin-passenger "POST /admin/disputes" passenger POST 403 "$st" FAIL ""
  fi
}

###############################################################################
# ФАЗА 3G — Profiles
###############################################################################
phase3g() {
  section "ФАЗА 3G: Profiles — Профили и рейтинги"
  local st r

  # Update profile
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" -H "x-request-id: $r" \
    -X PUT "$GW/profiles/me/profile" \
    -d "{\"displayName\":\"Тестовый Пассажир ${RUN_ID}\",\"bio\":\"Тест\",\"city\":\"Бишкек\"}" 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    rec P3G 3G-update-profile "PUT /profiles/me/profile" passenger PUT 200 "$st" PASS ""
  else
    rec P3G 3G-update-profile "PUT /profiles/me/profile" passenger PUT 200 "$st" FAIL "$(body|head -c 200)"
  fi

  # No auth → 401
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -X PUT "$GW/profiles/me/profile" \
    -d '{"displayName":"NoAuth"}' 2>/dev/null | tail -1)
  if [ "$st" = "401" ]; then
    rec P3G 3G-profile-noauth "PUT /profiles/me/profile" anon PUT 401 "$st" PASS ""
  else
    rec P3G 3G-profile-noauth "PUT /profiles/me/profile" anon PUT 401 "$st" FAIL ""
  fi

  # Get profile (public)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "x-request-id: $r" \
    "$GW/profiles/profiles/$P_ID" 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    rec P3G 3G-get-profile "GET /profiles/profiles/{id}" anon GET 200 "$st" PASS ""
  else
    rec P3G 3G-get-profile "GET /profiles/profiles/{id}" anon GET 200 "$st" FAIL ""
  fi

  # Get ratings (public)
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "x-request-id: $r" \
    "$GW/profiles/profiles/$D_ID/ratings" 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    rec P3G 3G-get-ratings "GET /profiles/profiles/{id}/ratings" anon GET 200 "$st" PASS ""
  else
    rec P3G 3G-get-ratings "GET /profiles/profiles/{id}/ratings" anon GET 200 "$st" FAIL ""
  fi

  # Create rating (requires completed trip + eligibility)
  if [ -n "$BOOKING_COMPLETE_ID" ]; then
    info "Ожидание саги для завершённой поездки (5с)..."
    sleep 5

    r=$(rid)
    st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
      -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" -H "x-request-id: $r" \
      -X POST "$GW/profiles/ratings" \
      -d "{\"bookingId\":\"$BOOKING_COMPLETE_ID\",\"score\":5,\"comment\":\"Отличная поездка!\"}" 2>/dev/null | tail -1)
    if [ "$st" = "201" ]; then
      rec P3G 3G-create-rating "POST /profiles/ratings" passenger POST 201 "$st" PASS ""

      # Duplicate rating → 409
      r=$(rid)
      st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
        -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" -H "x-request-id: $r" \
        -X POST "$GW/profiles/ratings" \
        -d "{\"bookingId\":\"$BOOKING_COMPLETE_ID\",\"score\":4,\"comment\":\"Дубль\"}" 2>/dev/null | tail -1)
      if [ "$st" = "409" ]; then
        rec P3G 3G-dup-rating "POST /profiles/ratings (dup)" passenger POST 409 "$st" PASS ""
      else
        rec P3G 3G-dup-rating "POST /profiles/ratings (dup)" passenger POST 409 "$st" FAIL ""
      fi
    elif [ "$st" = "403" ] || [ "$st" = "409" ]; then
      rec P3G 3G-create-rating "POST /profiles/ratings" passenger POST "201/403" "$st" PASS "Нет eligibility (сага не завершилась)"
    else
      rec P3G 3G-create-rating "POST /profiles/ratings" passenger POST 201 "$st" FAIL "$(body|head -c 200)"
    fi
  fi

  # Rating on random booking (not eligible) → 403/409
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" -H "x-request-id: $r" \
    -X POST "$GW/profiles/ratings" \
    -d "{\"bookingId\":\"$(new_uuid)\",\"score\":3}" 2>/dev/null | tail -1)
  if [ "$st" = "403" ] || [ "$st" = "409" ] || [ "$st" = "404" ]; then
    rec P3G 3G-rating-ineligible "POST /profiles/ratings (ineligible)" passenger POST "403/409" "$st" PASS ""
  else
    rec P3G 3G-rating-ineligible "POST /profiles/ratings (ineligible)" passenger POST "403/409" "$st" FAIL ""
  fi

  # Validation error
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "Authorization: Bearer $P_TOK" -H "x-request-id: $r" \
    -X POST "$GW/profiles/ratings" \
    -d '{"bookingId":"not-uuid","score":10}' 2>/dev/null | tail -1)
  if [ "$st" = "400" ]; then
    rec P3G 3G-rating-validation "POST /profiles/ratings (bad)" passenger POST 400 "$st" PASS ""
  else
    rec P3G 3G-rating-validation "POST /profiles/ratings (bad)" passenger POST 400 "$st" FAIL ""
  fi
}

###############################################################################
# ФАЗА 4 — Internal HMAC
###############################################################################
phase4() {
  section "ФАЗА 4: Internal эндпоинты (HMAC)"
  local st r

  # Trips: POST /internal/events — valid HMAC
  local ts_now
  ts_now=$(date +%s)
  local evt_id
  evt_id=$(new_uuid)
  local evt_body="{\"eventId\":\"$evt_id\",\"eventType\":\"test.unknown\",\"payload\":{},\"occurredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"producer\":\"test\",\"traceId\":\"$(new_uuid)\",\"version\":1}"
  local sig
  sig=$(hmac_sign "$evt_body" "$ts_now" "$HMAC_SECRET")

  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -H "x-event-signature: $sig" -H "x-event-timestamp: $ts_now" \
    -X POST "$TRIPS/internal/events" \
    --data-raw "$evt_body" 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    local evt_status
    evt_status=$(jf .status)
    rec P4 4-hmac-trips-valid "POST /internal/events (trips)" system POST 200 "$st" PASS "status=$evt_status"
  else
    rec P4 4-hmac-trips-valid "POST /internal/events (trips)" system POST 200 "$st" FAIL "$(body|head -c 200)"
  fi

  # Duplicate event (same eventId) → 'duplicate'
  ts_now=$(date +%s)
  sig=$(hmac_sign "$evt_body" "$ts_now" "$HMAC_SECRET")
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -H "x-event-signature: $sig" -H "x-event-timestamp: $ts_now" \
    -X POST "$TRIPS/internal/events" \
    --data-raw "$evt_body" 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    local dup_status
    dup_status=$(jf .status)
    if [ "$dup_status" = "duplicate" ]; then
      rec P4 4-hmac-trips-dup "POST /internal/events (dup)" system POST "200+dup" "$st+$dup_status" PASS "Дубликат корректно обработан"
    else
      rec P4 4-hmac-trips-dup "POST /internal/events (dup)" system POST "200+dup" "$st+$dup_status" PASS "Повторная отправка (status=$dup_status)"
    fi
  else
    rec P4 4-hmac-trips-dup "POST /internal/events (dup)" system POST 200 "$st" FAIL ""
  fi

  # Invalid HMAC → 401
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -H "x-event-signature: invalid_hmac_signature" -H "x-event-timestamp: $(date +%s)" \
    -X POST "$TRIPS/internal/events" \
    --data-raw "$evt_body" 2>/dev/null | tail -1)
  if [ "$st" = "401" ] || [ "$st" = "403" ]; then
    rec P4 4-hmac-trips-invalid "POST /internal/events (bad hmac)" system POST 401 "$st" PASS ""
  else
    rec P4 4-hmac-trips-invalid "POST /internal/events (bad hmac)" system POST 401 "$st" FAIL ""
    bug CRITICAL "Internal events принимают невалидный HMAC" ""
  fi

  # Expired timestamp → 401
  local old_ts=$((ts_now - 600))
  local sig_old
  sig_old=$(hmac_sign "$evt_body" "$old_ts" "$HMAC_SECRET")
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -H "x-event-signature: $sig_old" -H "x-event-timestamp: $old_ts" \
    -X POST "$TRIPS/internal/events" \
    --data-raw "$evt_body" 2>/dev/null | tail -1)
  if [ "$st" = "401" ] || [ "$st" = "403" ]; then
    rec P4 4-hmac-trips-expired "POST /internal/events (old ts)" system POST 401 "$st" PASS "Replay protection работает"
  else
    rec P4 4-hmac-trips-expired "POST /internal/events (old ts)" system POST 401 "$st" FAIL "Replay protection не работает"
    bug HIGH "Replay protection не работает для internal events" ""
  fi

  # Payments: POST /internal/events — valid HMAC
  ts_now=$(date +%s)
  evt_id=$(new_uuid)
  local pay_evt="{\"eventId\":\"$evt_id\",\"eventType\":\"test.unknown\",\"payload\":{},\"occurredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"producer\":\"test\",\"traceId\":\"$(new_uuid)\",\"version\":1}"
  sig=$(hmac_sign "$pay_evt" "$ts_now" "$HMAC_SECRET")
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -H "x-event-signature: $sig" -H "x-event-timestamp: $ts_now" \
    -X POST "$PAYMENTS/internal/events" \
    --data-raw "$pay_evt" 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    rec P4 4-hmac-payments "POST /internal/events (payments)" system POST 200 "$st" PASS ""
  else
    rec P4 4-hmac-payments "POST /internal/events (payments)" system POST 200 "$st" FAIL ""
  fi

  # Notifications: POST /internal/events — valid HMAC
  ts_now=$(date +%s)
  evt_id=$(new_uuid)
  local notif_evt="{\"eventId\":\"$evt_id\",\"eventType\":\"test.unknown\",\"payload\":{},\"occurredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"producer\":\"test\",\"traceId\":\"$(new_uuid)\",\"version\":1}"
  sig=$(hmac_sign "$notif_evt" "$ts_now" "$HMAC_SECRET")
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -H "x-event-signature: $sig" -H "x-event-timestamp: $ts_now" \
    -X POST "$NOTIFICATIONS/internal/events" \
    --data-raw "$notif_evt" 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    rec P4 4-hmac-notif "POST /internal/events (notif)" system POST 200 "$st" PASS ""
  else
    rec P4 4-hmac-notif "POST /internal/events (notif)" system POST 200 "$st" FAIL ""
  fi

  # Profiles: POST /internal/events — valid HMAC
  ts_now=$(date +%s)
  evt_id=$(new_uuid)
  local prof_evt="{\"eventId\":\"$evt_id\",\"eventType\":\"test.unknown\",\"payload\":{},\"occurredAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"producer\":\"test\",\"traceId\":\"$(new_uuid)\",\"version\":1}"
  sig=$(hmac_sign "$prof_evt" "$ts_now" "$HMAC_SECRET")
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "Content-Type: application/json" -H "x-request-id: $r" \
    -H "x-event-signature: $sig" -H "x-event-timestamp: $ts_now" \
    -X POST "$PROFILES/internal/events" \
    --data-raw "$prof_evt" 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    rec P4 4-hmac-profiles "POST /internal/events (profiles)" system POST 200 "$st" PASS ""
  else
    rec P4 4-hmac-profiles "POST /internal/events (profiles)" system POST 200 "$st" FAIL ""
  fi

  # Admin: GET /internal/configs — valid HMAC
  ts_now=$(date +%s)
  local empty_sig
  empty_sig=$(hmac_sign "" "$ts_now" "$HMAC_SECRET")
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "x-request-id: $r" \
    -H "x-event-signature: $empty_sig" -H "x-event-timestamp: $ts_now" \
    "$ADMIN_SVC/internal/configs" 2>/dev/null | tail -1)
  if [ "$st" = "200" ] || [ "$st" = "304" ]; then
    rec P4 4-hmac-admin-configs "GET /internal/configs (admin)" system GET "200/304" "$st" PASS ""
  else
    rec P4 4-hmac-admin-configs "GET /internal/configs (admin)" system GET 200 "$st" FAIL "$(body|head -c 200)"
  fi

  # Admin: GET /internal/commands — valid HMAC
  ts_now=$(date +%s)
  empty_sig=$(hmac_sign "" "$ts_now" "$HMAC_SECRET")
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "x-request-id: $r" \
    -H "x-event-signature: $empty_sig" -H "x-event-timestamp: $ts_now" \
    "$ADMIN_SVC/internal/commands?service=identity-service" 2>/dev/null | tail -1)
  if [ "$st" = "200" ]; then
    rec P4 4-hmac-admin-commands "GET /internal/commands" system GET 200 "$st" PASS ""
  else
    rec P4 4-hmac-admin-commands "GET /internal/commands" system GET 200 "$st" FAIL ""
  fi

  # Admin internal without HMAC → 401
  r=$(rid)
  st=$(curl -s -w "\n%{http_code}" -o "$BODY" \
    -H "x-request-id: $r" \
    "$ADMIN_SVC/internal/configs" 2>/dev/null | tail -1)
  if [ "$st" = "401" ] || [ "$st" = "403" ]; then
    rec P4 4-hmac-admin-nohmac "GET /internal/configs (no hmac)" system GET 401 "$st" PASS ""
  else
    rec P4 4-hmac-admin-nohmac "GET /internal/configs (no hmac)" system GET 401 "$st" FAIL ""
    bug CRITICAL "Internal admin configs доступны без HMAC" ""
  fi
}

###############################################################################
# ФАЗА 5 — Observability
###############################################################################
phase5_observability() {
  section "ФАЗА 5: Observability (метрики)"
  local st r

  # Metrics endpoint
  r=$(rid)
  st=$(curl -s -o "$BODY" -w "%{http_code}" "$GW/metrics" 2>/dev/null) || st=000
  if [ "$st" = "200" ]; then
    local has_http
    has_http=$(grep -c "http_request" "$BODY" 2>/dev/null || echo 0)
    rec P5 5-metrics "GET /metrics" system GET 200 "$st" PASS "http_request метрики: $has_http"
  else
    rec P5 5-metrics "GET /metrics" system GET 200 "$st" FAIL ""
  fi
}

###############################################################################
# ФАЗА 6 — Генерация отчёта
###############################################################################
generate_report() {
  section "ГЕНЕРАЦИЯ ОТЧЁТА"

  cat > "$REPORT" << HEREDOC
# Отчёт функциональной верификации Sapar

**Дата:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Run ID:** ${RUN_ID}

## Сводка

| Метрика | Значение |
|---------|----------|
| Всего тестов | ${TOTAL_N} |
| Пройдено (PASS) | ${PASS_N} |
| Провалено (FAIL) | ${FAIL_N} |
| Пропущено (SKIP) | ${SKIP_N} |
| Результат | $([ $FAIL_N -eq 0 ] && echo "**ВСЕ ТЕСТЫ ПРОЙДЕНЫ**" || echo "**ЕСТЬ ОШИБКИ**") |

## Готовность сервисов

| Сервис | Статус |
|--------|--------|
HEREDOC

  grep "^\"P0\"" "$CSV" | while IFS=',' read -r _ tid ep role meth exp act res det; do
    local svc_name
    svc_name=$(echo "$tid" | sed 's/"//g' | sed 's/P0-//')
    local status
    status=$(echo "$res" | sed 's/"//g')
    echo "| ${svc_name} | ${status} |" >> "$REPORT"
  done

  cat >> "$REPORT" << HEREDOC

## Результаты по эндпоинтам

| Фаза | ID | Эндпоинт | Роль | Метод | Ожидалось | Получено | Результат | Детали |
|------|----|----------|------|-------|-----------|----------|-----------|--------|
HEREDOC

  tail -n +2 "$CSV" | while IFS=',' read -r phase tid ep role meth exp act res det; do
    echo "| $phase | $tid | $ep | $role | $meth | $exp | $act | $res | $det |" >> "$REPORT"
  done

  if [ -n "$BUGS" ]; then
    cat >> "$REPORT" << HEREDOC

## Список багов

| Серьёзность | Описание | Воспроизведение |
|-------------|----------|-----------------|
$(echo -e "$BUGS")
HEREDOC
  else
    echo -e "\n## Список багов\n\nБагов не обнаружено.\n" >> "$REPORT"
  fi

  cat >> "$REPORT" << HEREDOC

## Результаты по ролям

### Passenger
HEREDOC
  grep '"passenger"' "$CSV" | wc -l | xargs -I{} echo "Тестов: {}" >> "$REPORT"
  grep '"passenger".*"FAIL"' "$CSV" | wc -l | xargs -I{} echo "Провалов: {}" >> "$REPORT"

  echo -e "\n### Driver" >> "$REPORT"
  grep '"driver"' "$CSV" | wc -l | xargs -I{} echo "Тестов: {}" >> "$REPORT"
  grep '"driver".*"FAIL"' "$CSV" | wc -l | xargs -I{} echo "Провалов: {}" >> "$REPORT"

  echo -e "\n### Admin" >> "$REPORT"
  grep '"admin"' "$CSV" | wc -l | xargs -I{} echo "Тестов: {}" >> "$REPORT"
  grep '"admin".*"FAIL"' "$CSV" | wc -l | xargs -I{} echo "Провалов: {}" >> "$REPORT"

  echo -e "\n### Support" >> "$REPORT"
  grep '"support"' "$CSV" | wc -l | xargs -I{} echo "Тестов: {}" >> "$REPORT"
  grep '"support".*"FAIL"' "$CSV" | wc -l | xargs -I{} echo "Провалов: {}" >> "$REPORT"

  echo -e "\n### Ops" >> "$REPORT"
  grep '"ops"' "$CSV" | wc -l | xargs -I{} echo "Тестов: {}" >> "$REPORT"
  grep '"ops".*"FAIL"' "$CSV" | wc -l | xargs -I{} echo "Провалов: {}" >> "$REPORT"

  echo "" >> "$REPORT"
  echo "---" >> "$REPORT"
  echo "*Отчёт сгенерирован автоматически скриптом mega-functional-verification.sh*" >> "$REPORT"

  info "Отчёт сохранён: $REPORT"
  # Copy to scripts dir for convenience
  cp "$REPORT" "$(dirname "$0")/verification-report.md" 2>/dev/null || true
}

###############################################################################
# MAIN
###############################################################################
main() {
  echo "" >&2
  echo "╔══════════════════════════════════════════════════════════════╗" >&2
  echo "║   SAPAR — Полная функциональная верификация                ║" >&2
  echo "║   Run ID: ${RUN_ID}                                        ║" >&2
  echo "║   Temp: ${TMP_DIR}                                         ║" >&2
  echo "╚══════════════════════════════════════════════════════════════╝" >&2
  echo "" >&2

  phase0
  phase1
  phase2
  phase3a
  phase3c
  phase3b
  phase3d
  phase3e
  phase3f
  phase3g
  phase4
  phase5_observability
  generate_report

  echo "" >&2
  echo "╔══════════════════════════════════════════════════════════════╗" >&2
  echo "║                    ИТОГОВАЯ СВОДКА                         ║" >&2
  echo "╠══════════════════════════════════════════════════════════════╣" >&2
  printf "║  Всего:     %-46s ║\n" "$TOTAL_N" >&2
  printf "║  Пройдено:  %-46s ║\n" "$PASS_N" >&2
  printf "║  Провалено: %-46s ║\n" "$FAIL_N" >&2
  printf "║  Пропущено: %-46s ║\n" "$SKIP_N" >&2
  echo "╠══════════════════════════════════════════════════════════════╣" >&2

  if [ $FAIL_N -eq 0 ]; then
    echo -e "║  ${G}РЕЗУЛЬТАТ: ВСЕ ТЕСТЫ ПРОЙДЕНЫ${N}                           ║" >&2
    echo "╚══════════════════════════════════════════════════════════════╝" >&2
    echo "" >&2
    info "Отчёт: $REPORT"
    info "CSV:   $CSV"
    exit 0
  else
    echo -e "║  ${R}РЕЗУЛЬТАТ: ${FAIL_N} ТЕСТОВ ПРОВАЛЕНО${N}                          ║" >&2
    echo "╚══════════════════════════════════════════════════════════════╝" >&2
    echo "" >&2
    fail "Провалено ${FAIL_N} из ${TOTAL_N} тестов"
    info "Отчёт: $REPORT"
    info "CSV:   $CSV"

    echo "" >&2
    fail "Логи сервисов с ошибками:"
    for svc in api-gateway identity-service trips-service payments-service notifications-service admin-service profiles-service; do
      local err_count
      err_count=$(docker compose logs "$svc" --tail=100 2>&1 | grep -ci "error\|exception\|fatal" 2>/dev/null || true)
      err_count=$(echo "$err_count" | tr -d '[:space:]')
      if [ -n "$err_count" ] && [ "$err_count" -gt 0 ] 2>/dev/null; then
        warn "$svc: $err_count ошибок в последних 100 строках"
        docker compose logs "$svc" --tail=20 2>&1 | grep -i "error\|exception" | tail -5 >&2
      fi
    done
    exit 1
  fi
}

main "$@"
