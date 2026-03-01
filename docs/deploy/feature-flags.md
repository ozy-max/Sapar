# Feature Flags Strategy (MVP) — Sapar

## Подход

На этапе MVP feature flags реализуются через JSON-конфиги admin-service без внешних сервисов (LaunchDarkly, Unleash и т.д.).

## Архитектура

```
admin-service (хранит конфиги в Postgres)
     ↓ GET /internal/config/:namespace
  api-gateway / другие сервисы (кешируют конфиг на 60с)
```

### Формат конфига feature flags

Namespace: `feature-flags`

```json
{
  "flags": {
    "new_search_algorithm": {
      "enabled": true,
      "rollout_pct": 50,
      "description": "Новый алгоритм поиска с геоиндексом"
    },
    "receipt_v2": {
      "enabled": false,
      "rollout_pct": 0,
      "description": "Новый формат чеков OFD v2"
    },
    "push_notifications": {
      "enabled": true,
      "rollout_pct": 10,
      "description": "Push-уведомления через Firebase"
    }
  }
}
```

### Проверка флага в коде

```typescript
// В NestJS сервисе
const flags = await this.configClient.get('feature-flags');
const flag = flags?.flags?.['new_search_algorithm'];

if (flag?.enabled) {
  const rollout = flag.rollout_pct ?? 100;
  // Детерминистичный rollout по userId
  const bucket = parseInt(userId.slice(-2), 16) % 100;
  if (bucket < rollout) {
    return this.newSearchAlgorithm(params);
  }
}
return this.legacySearch(params);
```

## Жизненный цикл флага

```
CREATED → TESTING (rollout_pct: 0-10%)
       → ROLLOUT (rollout_pct: 10-100%)
       → GA (enabled: true, rollout_pct: 100)
       → CLEANUP (удалить флаг и старый код)
```

## Правила

1. **Каждая новая фича** получает флаг, если она затрагивает пользовательский flow
2. **Флаг по умолчанию выключен** (`enabled: false, rollout_pct: 0`)
3. **Rollout через проценты** (10% → 25% → 50% → 100%)
4. **Мониторинг при rollout**: следить за error rate и p95 на дашборде
5. **Cleanup**: после GA удалить флаг и ветки старого кода в течение 2 спринтов
6. **Emergency kill switch**: установить `enabled: false` для мгновенного отката

## Управление через admin-service

```bash
# Включить флаг
curl -X PUT http://localhost:3005/api/v1/config/feature-flags \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"flags":{"new_search_algorithm":{"enabled":true,"rollout_pct":25}}}'

# Выключить флаг (emergency)
curl -X PUT http://localhost:3005/api/v1/config/feature-flags \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"flags":{"new_search_algorithm":{"enabled":false,"rollout_pct":0}}}'
```

## Мониторинг feature flags

Рекомендуется добавить метрику:

```typescript
this.metrics.increment('feature_flag_evaluation', {
  flag: 'new_search_algorithm',
  result: 'enabled', // или 'disabled'
  service: 'trips-service',
});
```

Дашборд Grafana: группировка по `flag` + `result` покажет процент включений.

## Миграция к полноценному сервису

Когда количество флагов превысит 20 или потребуется:
- A/B тестирование с метриками
- Targeting по атрибутам пользователя
- Аудит изменений флагов

→ Мигрировать на Unleash (self-hosted) или аналог. JSON-конфиг формат совместим с миграцией.
