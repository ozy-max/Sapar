# ТЗ (SRS/PRD) v1.3 FULL — Аналог BlaBlaCar (Кыргызстан)

> **Версия:** v1.3  
> **Регион:** Кыргызстан, локали: `ru-KG`, `ky-KG`  
> **Валюта:** KGS (кыргызский сом)  
> **Модель:** Гибридная — `CARPOOL = OFFLINE`, `COMMERCIAL = IN_APP`

---

## Изменения v1.3 относительно v1.2

- OPEN QUESTIONS **закрыты** — финализированы конфиги, SLA no-show, реквизиты эмитента чека.
- Все остальные требования v1.2 FULL остаются в силе без изменений.

---

## 3.2 Функциональные требования — финальные конфиги

### FR-012 Фискальные чеки (ЭККМ) — Retry Policy

| Параметр | Значение |
|----------|----------|
| `receipt_retry_N` | 3 |
| Backoff | 5 с → 30 с → 5 мин |
| После 3-й неудачи | `FAILED_FINAL` + создать `FinanceOpsCase(RECEIPT_FAIL)` |

**Acceptance Criteria:**

| Сценарий | Ожидаемый результат |
|----------|---------------------|
| Статус `CAPTURED`, 1-я ошибка выдачи чека | Retry через 5 с |
| 2-я ошибка | Retry через 30 с |
| 3-я ошибка | Retry через 5 мин |
| 3-я ошибка повторяется | Статус `FAILED_FINAL` + `FinanceOpsCase` |

---

### FR-013 CancellationPolicy v1 — Финальные числа (KG)

#### 13.1 CARPOOL — Отмена пассажира

| Параметр | Значение |
|----------|----------|
| Бесплатное окно | ≤ 30 минут после `booking.created_at` |
| Штраф (фиксированный) | `KGS_PAX_CARPOOL_CANCEL_FEE = 100 KGS` |

**AC:**
- `now - created_at > 30m` → `penalty = 100 KGS` → запись в `PenaltyLedger(status=OPEN)`

---

#### 13.2 COMMERCIAL — Отмена пассажира

| Параметр | Значение |
|----------|----------|
| `COMM_PAX_FREE_MINUTES` | 5 мин |
| `COMM_PAX_CANCEL_MIN_FEE_KGS` | 100 KGS |
| `COMM_PAX_CANCEL_PERCENT` | 15% |
| Формула | `penalty = MAX(100 KGS, 0.15 × trip_fare)` |

**AC:**
| trip_fare | now - created_at | Штраф |
|-----------|-----------------|-------|
| 500 KGS | > 5 мин | `MAX(100, 75)` = **100 KGS** |
| 2000 KGS | > 5 мин | `MAX(100, 300)` = **300 KGS** |

---

#### 13.3 COMMERCIAL — Отмена водителя

| Параметр | Значение |
|----------|----------|
| `COMM_DRV_FREE_HOURS` | 12 часов до отправления |
| Позже 12 часов | `driver_late_cancel_count_30d++` |
| Влияние | Снижение `driver_priority_score` (конфигурируемо, напр. `−10`) |
| Порог поздних отмен | Cooldown публикации (см. правило R-011) |

---

#### 13.4 Tiered Penalties — Cooldown пассажира

| Параметр | Значение |
|----------|----------|
| `COOLDOWN_HOURS` | 4 часа |
| Применяется для | Tier2 пассажира (≥ 4 отмен/30 дней) |
| Для водителя (R-011) | Publish cooldown 4 часа |

---

### FR-019 Free-Period — Критерии ликвидности

Free-period отключается при выполнении **хотя бы одного** условия по городу:

| Условие | Значение |
|---------|----------|
| `LIQUIDITY_X_A` | ≥ 10 успешных поездок/день/город — **7 дней подряд** |
| `LIQUIDITY_X_B` | ≥ 3 активных водителя в час-пик — **7 дней подряд** |

**Час-пик** (`PEAK_HOURS`): `07:00–10:00` и `17:00–20:00` (локальное время)

**AC:**
- `completed_rides/day ≥ 10` × 7 дней подряд → Free-period автоматически отключается для города
- `active_drivers_peak ≥ 3` × 7 дней подряд → Free-period автоматически отключается для города

---

## 4. Anti-fraud / Risk — Финальные SLA и правила

### R-011 Driver Late Cancels

| Параметр | Значение |
|----------|----------|
| Условие | `late_cancel_count_30d >= 2` |
| Действие | `driver_priority_score -= 10` + `publish_cooldown = 4h` |

**AC:**
- При `late_cancel_count_30d = 2` → попытка публикации → **403 PUBLISH_COOLDOWN** + `cooldown_until` timestamp

---

## 5. Данные — Новые/уточнённые атрибуты (v1.3)

| Атрибут | Описание |
|---------|----------|
| `OfflineProof.no_show_resolution_deadline` | `depart_at + 12h` |
| `FiscalReceipt.retry_count` | Счётчик попыток |
| `FiscalReceipt.next_retry_at` | Следующая попытка (timestamp) |
| `FiscalReceipt.failed_final_at` | Дата окончательного провала |
| `LegalEntity.full_name` | Полное наименование юрлица |
| `LegalEntity.inn` | ИНН |
| `LegalEntity.legal_address` | Юридический адрес |
| `LegalEntity.agent_flag` | Признак агента |
| `LegalEntity.service_type_code` | Тип услуги |

---

## 6. API — Дополнения (v1.3)

### Offline flow

```
POST /v1/bookings/{id}/offline/confirm
Body: { "actor": "PASSENGER"|"DRIVER", "result": "COMPLETED"|"NO_SHOW"|"DISPUTE", "comment"? }

POST /v1/bookings/{id}/offline/dispute
Body: { "reason_code", "comment", "attachments"? }
```

### Receipts

```
GET /v1/payments/{id}/receipt
```

Response включает `issuer`:
```json
{
  "full_name": "...",
  "inn": "...",
  "legal_address": "...",
  "agent_flag": true,
  "service_type": "DIGITAL_PLATFORM_SERVICE"
}
```

---

## 9. Тестирование — Финальные чек-листы (v1.3)

### Offline No-Show SLA

| Сценарий | Ожидаемый результат |
|----------|---------------------|
| `depart_at + 12h` истекло, dispute не создан | Авто-решение `NO_SHOW_CONFIRMED` |
| Dispute создан до дедлайна | Тикет в поддержку, ручное решение |

### Receipt Retries

| Попытка | Задержка | Результат при провале |
|---------|----------|-----------------------|
| 1-я | — | Retry через 5 с |
| 2-я | 5 с | Retry через 30 с |
| 3-я | 30 с | Retry через 5 мин |
| После 3-й | 5 мин | `FAILED_FINAL` + `FinanceOpsCase` |

---

## 11. Open Questions — ЗАКРЫТО

*(Все вопросы закрыты в v1.3)*

---

## 12. Assumptions (обновление v1.3)

**Эмитент чека** — юридическое лицо платформы (агентская модель):

| Атрибут | Описание |
|---------|----------|
| Форма | ОсОО |
| Полное наименование | (заполняется при регистрации) |
| ИНН | (заполняется при регистрации) |
| Юридический адрес | (заполняется при регистрации) |
| Признак агента | `true` |
| Тип услуги | Цифровая платформа |
| Фискальные атрибуты | Из ЭККМ/провайдера |

---

## Backlog — Дельта v1.3

### Epic B. Payments & Compliance

#### B6 Legal Entity & Receipt Issuer

| Задача | Оценка |
|--------|--------|
| Модель `LegalEntity` | S |
| Admin: редактирование реквизитов | M |
| Проброс реквизитов в receipts | M |
| QA | S |

#### B7 Receipt Retry Scheduler

| Задача | Оценка |
|--------|--------|
| Retry worker + `next_retry_at` | M |
| Dead-letter / Finance case creation | M |
| Dashboards | S |
| QA | M |

### Epic E. Offline No-Show SLA

#### E2 No-Show Auto-Resolution

| Задача | Оценка |
|--------|--------|
| SLA timer job | M |
| State transitions + audit | M |
| Support escalation hook | S |
| QA | M |
