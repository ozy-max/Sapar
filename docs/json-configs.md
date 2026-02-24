# JSON-конфиги платформы — BlaBlaCar аналог (KG)

> Готовые конфиги для хранения в `config-service` / admin-панели.  
> Страна: `KG`, Валюта: `KGS`

---

## Содержание

1. [CancellationPolicy v1 (KG)](#1-cancellationpolicy-v1-kg)
2. [RiskRules v1 (KG)](#2-riskrules-v1-kg)
3. [Receipts Policy (KG)](#3-receipts-policy-kg)
4. [Offline No-Show SLA (KG)](#4-offline-no-show-sla-kg)
5. [PostgreSQL DDL](#5-postgresql-ddl)
6. [Мини-алгоритмы](#6-мини-алгоритмы)

---

## 1. CancellationPolicy v1 (KG)

```json
{
  "policy_id": "cancel_kg_v1",
  "country": "KG",
  "currency": "KGS",
  "version": 1,
  "carpool": {
    "passenger": {
      "free_minutes_after_booking": 30,
      "cancel_fee_kgs_fixed": 100,
      "fee_application": {
        "offline": "PENALTY_LEDGER",
        "in_app_service_fee": "DEDUCT_UP_TO_FEE"
      }
    },
    "driver": {
      "free_hours_before_departure": 2,
      "late_cancel": {
        "money_penalty": "NONE_MVP",
        "quality_impact": {
          "late_cancel_counter_30d_inc": 1
        }
      }
    },
    "no_show": {
      "service_fee_non_refundable": true,
      "no_show_counter_90d_inc": 1
    }
  },
  "commercial": {
    "passenger": {
      "free_minutes_after_booking": 5,
      "penalty": {
        "min_fee_kgs": 100,
        "percent_of_trip_fare": 0.15,
        "formula": "MAX(min_fee, percent * trip_fare)"
      }
    },
    "driver": {
      "free_hours_before_departure": 12,
      "late_cancel": {
        "money_penalty": "NONE_MVP",
        "quality_impact": {
          "late_cancel_counter_30d_inc": 1,
          "priority_score_delta": -10
        }
      }
    }
  },
  "tiers": {
    "window_days": 30,
    "tier0": {
      "cancel_count_range": [0, 1],
      "cancel_fee_multiplier": 1.0,
      "booking_active_limit_delta": 0,
      "cooldown_hours": 0
    },
    "tier1": {
      "cancel_count_range": [2, 3],
      "cancel_fee_multiplier": 1.5,
      "booking_active_limit_delta": -1,
      "cooldown_hours": 0
    },
    "tier2": {
      "cancel_count_range": [4, 999],
      "cancel_fee_multiplier": 2.0,
      "booking_active_limit_delta": -999,
      "cooldown_hours": 4
    }
  }
}
```

### Расшифровка Tiers

| Tier | Отмены / 30 дней | Множитель штрафа | Лимит активных броней | Cooldown |
|------|:---:|:---:|:---:|:---:|
| tier0 | 0–1 | ×1.0 | без изменений | 0 ч |
| tier1 | 2–3 | ×1.5 | −1 | 0 ч |
| tier2 | 4+ | ×2.0 | заблокировано | **4 ч** |

---

## 2. RiskRules v1 (KG)

```json
{
  "policy_id": "risk_kg_v1",
  "country": "KG",
  "version": 1,
  "thresholds": {
    "low_max": 39,
    "med_max": 69,
    "high_max": 84,
    "critical_max": 100
  },
  "decisions": {
    "low": "ALLOW",
    "med": "STEP_UP",
    "high": "BLOCK_AND_REVIEW",
    "critical": "BLOCK_USER_AND_HOLD_PAYOUTS"
  },
  "rules": [...]
}
```

### Risk Score → Decision

| Диапазон | Уровень | Решение |
|----------|---------|---------|
| 0–39 | low | `ALLOW` |
| 40–69 | med | `STEP_UP` |
| 70–84 | high | `BLOCK_AND_REVIEW` |
| 85–100 | critical | `BLOCK_USER_AND_HOLD_PAYOUTS` |

### Таблица правил

| Rule ID | Название | Условие | Действие |
|---------|----------|---------|---------|
| R-001 | OTP spam | `otp_send_count(ip, 10m) > 20` | `OTP_COOLDOWN` (30 мин) |
| R-002 | Новое устройство + платёж | `new_device == true AND payment_attempt == true` | `STEP_UP_OTP` |
| R-003 | Card testing | `payment_fail_count(card_hash, 30m) >= 5` | `BLOCK_CARD` (24 ч) |
| R-005 | Driver cancel spike | `driver_cancel_count(7d) >= 3` | `SUSPEND_PUBLISH` (7 дней) |
| R-006 | Commercial masking | `driver_type == 'CARPOOL' AND rides_per_week > 10 AND route_repeat_ratio > 0.6` | `REQUIRE_COMMERCIAL_LICENSE_OR_RECLASSIFY` |
| R-007 | Doc reuse | `doc_hash_reused_across_drivers == true` | `BLOCK_AND_REVIEW` |
| R-008 | Offline mismatch abuse | `offline_mismatch_rate(user, 30d) > 0.20` | `RESTRICT_OFFLINE_BOOKINGS` (30 дней) |
| R-009 | Passenger cancel tier | `passenger_cancel_count_30d >= 4` | `BOOKING_COOLDOWN` (4 ч) |
| R-011 | Driver late cancels | `driver_late_cancel_count_30d >= 2` | `PUBLISH_COOLDOWN_AND_PRIORITY_DOWN` (4 ч, −10 pts) |

### Полный JSON правил

```json
{
  "rules": [
    {
      "rule_id": "R-001",
      "name": "OTP spam",
      "condition": "otp_send_count(ip,10m) > 20",
      "action": "OTP_COOLDOWN",
      "params": { "cooldown_minutes": 30 },
      "log": true
    },
    {
      "rule_id": "R-002",
      "name": "New device + payment attempt",
      "condition": "new_device == true AND payment_attempt == true",
      "action": "STEP_UP_OTP",
      "params": {},
      "log": true
    },
    {
      "rule_id": "R-003",
      "name": "Card testing",
      "condition": "payment_fail_count(card_hash,30m) >= 5",
      "action": "BLOCK_CARD",
      "params": { "duration_hours": 24 },
      "log": true
    },
    {
      "rule_id": "R-005",
      "name": "Driver cancel spike",
      "condition": "driver_cancel_count(7d) >= 3",
      "action": "SUSPEND_PUBLISH",
      "params": { "duration_days": 7 },
      "log": true
    },
    {
      "rule_id": "R-006",
      "name": "Commercial masking suspected",
      "condition": "driver_type == 'CARPOOL' AND rides_per_week > X AND route_repeat_ratio > Y",
      "action": "REQUIRE_COMMERCIAL_LICENSE_OR_RECLASSIFY",
      "params": { "X": 10, "Y": 0.6 },
      "log": true
    },
    {
      "rule_id": "R-007",
      "name": "Doc reuse",
      "condition": "doc_hash_reused_across_drivers == true",
      "action": "BLOCK_AND_REVIEW",
      "params": {},
      "log": true
    },
    {
      "rule_id": "R-008",
      "name": "Offline mismatch abuse",
      "condition": "offline_mismatch_rate(user,30d) > 0.20",
      "action": "RESTRICT_OFFLINE_BOOKINGS",
      "params": { "duration_days": 30 },
      "log": true
    },
    {
      "rule_id": "R-009",
      "name": "Passenger cancel tier",
      "condition": "passenger_cancel_count_30d >= 4",
      "action": "BOOKING_COOLDOWN",
      "params": { "cooldown_hours": 4 },
      "log": true
    },
    {
      "rule_id": "R-011",
      "name": "Driver late cancels",
      "condition": "driver_late_cancel_count_30d >= 2",
      "action": "PUBLISH_COOLDOWN_AND_PRIORITY_DOWN",
      "params": { "publish_cooldown_hours": 4, "priority_score_delta": -10 },
      "log": true
    }
  ]
}
```

---

## 3. Receipts Policy (KG)

```json
{
  "policy_id": "receipts_kg_v1",
  "country": "KG",
  "version": 1,
  "issuer": {
    "legal_form": "ОсОО",
    "full_name": "PLATFORM_LEGAL_NAME_PLACEHOLDER",
    "inn": "PLATFORM_INN_PLACEHOLDER",
    "legal_address": "PLATFORM_LEGAL_ADDRESS_PLACEHOLDER",
    "agent_flag": true,
    "service_type": "DIGITAL_PLATFORM_SERVICE"
  },
  "retry": {
    "max_attempts": 3,
    "backoff_seconds": [5, 30, 300],
    "final_state": "FAILED_FINAL"
  }
}
```

### Retry Schedule

| Попытка | Задержка | Действие при провале |
|:-------:|:--------:|---------------------|
| 1 | — | retry через 5 с |
| 2 | 5 с | retry через 30 с |
| 3 | 30 с | retry через 5 мин (300 с) |
| — | 5 мин | `FAILED_FINAL` + `FinanceOpsCase` |

---

## 4. Offline No-Show SLA (KG)

```json
{
  "policy_id": "offline_sla_kg_v1",
  "country": "KG",
  "version": 1,
  "no_show": {
    "resolution_deadline_hours_after_departure": 12,
    "auto_resolve_if_no_dispute": true,
    "auto_resolution_result": "NO_SHOW_CONFIRMED",
    "escalate_to_support_on_dispute": true
  }
}
```

### Логика авто-разрешения

| Условие | Результат |
|---------|-----------|
| `now >= depart_at + 12h` И `dispute_created = false` | `AUTO_RESOLVED` → `NO_SHOW_CONFIRMED` |
| `dispute_created = true` до дедлайна | Эскалация в Support (ручное решение) |

---

## 5. PostgreSQL DDL

> Схема: `public`. UUID через `gen_random_uuid()` (расширение `pgcrypto`).

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','BLOCKED')),
  locale TEXT NOT NULL DEFAULT 'ru-KG',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  risk_score INT NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100)
);

CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  photo_url TEXT,
  bio TEXT,
  completeness INT NOT NULL DEFAULT 0 CHECK (completeness BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Driver profile
CREATE TABLE driver_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  driver_type TEXT NOT NULL CHECK (driver_type IN ('CARPOOL','COMMERCIAL')),
  priority_score INT NOT NULL DEFAULT 100 CHECK (priority_score BETWEEN 0 AND 100),
  late_cancel_count_30d INT NOT NULL DEFAULT 0,
  publish_cooldown_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Documents
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('DRIVER_LICENSE','VEHICLE_REGISTRATION','COMMERCIAL_LICENSE','ID')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','VERIFIED','FAILED','EXPIRED')),
  expiry_at DATE,
  doc_hash TEXT,
  reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX documents_user_idx ON documents(user_id);
CREATE INDEX documents_hash_idx ON documents(doc_hash);

-- Rides
CREATE TABLE rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES users(id),
  ride_type TEXT NOT NULL CHECK (ride_type IN ('CARPOOL','COMMERCIAL')),
  from_point JSONB NOT NULL,
  to_point JSONB NOT NULL,
  stops JSONB NOT NULL DEFAULT '[]'::jsonb,
  depart_at TIMESTAMPTZ NOT NULL,
  seats_total INT NOT NULL CHECK (seats_total BETWEEN 1 AND 8),
  seats_available INT NOT NULL CHECK (seats_available BETWEEN 0 AND 8),
  price_kgs INT NOT NULL CHECK (price_kgs >= 0),
  booking_mode TEXT NOT NULL CHECK (booking_mode IN ('INSTANT','REQUEST')),
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('OFFLINE','IN_APP')),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','CANCELLED','COMPLETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rides_search_idx ON rides(status, depart_at);
CREATE INDEX rides_driver_idx ON rides(driver_id);

-- Bookings
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  passenger_id UUID NOT NULL REFERENCES users(id),
  seats INT NOT NULL CHECK (seats BETWEEN 1 AND 8),
  fare_kgs INT NOT NULL CHECK (fare_kgs >= 0),
  service_fee_kgs INT NOT NULL DEFAULT 0 CHECK (service_fee_kgs >= 0),
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('OFFLINE','IN_APP')),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','ACCEPTED','PAID','RESERVED_OFFLINE','CANCELLED','COMPLETED','REFUNDED')),
  cancellation_policy_id TEXT NOT NULL,
  cancellation_policy_version INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bookings_ride_idx ON bookings(ride_id);
CREATE INDEX bookings_passenger_idx ON bookings(passenger_id);
CREATE INDEX bookings_status_idx ON bookings(status);

-- Payments
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('INITIATED','AUTHORIZED','CAPTURED','FAILED','REFUNDED')),
  card_hash TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, idempotency_key)
);

-- Refunds
CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount_kgs INT NOT NULL CHECK (amount_kgs >= 0),
  status TEXT NOT NULL CHECK (status IN ('INITIATED','SUCCEEDED','FAILED')),
  reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Legal entity (эмитент чека)
CREATE TABLE legal_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country TEXT NOT NULL,
  legal_form TEXT NOT NULL,
  full_name TEXT NOT NULL,
  inn TEXT NOT NULL,
  legal_address TEXT NOT NULL,
  agent_flag BOOLEAN NOT NULL DEFAULT true,
  service_type TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX legal_entities_active_one ON legal_entities(country) WHERE is_active = true;

-- Fiscal receipts
CREATE TABLE fiscal_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
  status TEXT NOT NULL CHECK (status IN ('ISSUED','FAILED','RETRYING','FAILED_FINAL')),
  retry_count INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  provider_payload JSONB,
  issued_at TIMESTAMPTZ,
  failed_final_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fiscal_receipts_status_idx ON fiscal_receipts(status, next_retry_at);

-- Penalty ledger
CREATE TABLE penalty_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  amount_kgs INT NOT NULL CHECK (amount_kgs > 0),
  status TEXT NOT NULL CHECK (status IN ('OPEN','PAID','WAIVED')),
  reason_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX penalty_ledger_user_idx ON penalty_ledger(user_id, status);

-- Offline proof / no-show SLA
CREATE TABLE offline_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  passenger_result TEXT CHECK (passenger_result IN ('COMPLETED','NO_SHOW','DISPUTE')),
  driver_result TEXT CHECK (driver_result IN ('COMPLETED','NO_SHOW','DISPUTE')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','MATCHED','MISMATCHED','AUTO_RESOLVED')),
  no_show_resolution_deadline TIMESTAMPTZ NOT NULL,
  dispute_created BOOLEAN NOT NULL DEFAULT false,
  auto_resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Risk events / audit log
CREATE TABLE risk_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  score INT NOT NULL CHECK (score BETWEEN 0 AND 100),
  decision TEXT NOT NULL,
  rule_hits TEXT[] NOT NULL DEFAULT '{}',
  signals JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX risk_events_user_idx ON risk_events(user_id, created_at);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  diff_masked JSONB,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log(entity_type, entity_id, created_at);
```

---

## 6. Мини-алгоритмы

### 6.1 Расчёт COMMERCIAL штрафа

```python
penalty = max(100, round(trip_fare * 0.15))
refund = max(0, paid_amount - penalty)
```

### 6.2 Receipt Retry Worker

```python
if status in (FAILED, RETRYING) and retry_count < 3 and now >= next_retry_at:
    attempt issue receipt
    if ok:
        status = ISSUED
    else:
        retry_count += 1
        next_retry_at = now + backoff[retry_count - 1]  # [5, 30, 300]

if retry_count == 3 and attempt fails:
    status = FAILED_FINAL
    create FinanceOpsCase(RECEIPT_FAIL)
```

### 6.3 Offline No-Show Auto-Resolution

```python
deadline = depart_at + timedelta(hours=12)

if now >= deadline and not dispute_created:
    if driver_result == 'NO_SHOW' and passenger_result is None:
        status = AUTO_RESOLVED  # NO_SHOW_CONFIRMED
    elif mismatch:
        create support ticket
```
