# Load Tests (k6)

Набор нагрузочных тестов для критических потоков Sapar.

## Предварительные требования

- [k6](https://k6.io/docs/get-started/installation/) установлен локально, **или** использование через Docker.
- Стек запущен через `docker-compose up -d` + `docker-compose -f docker-compose.observability.yml up -d`.

## Скрипты

| Файл | Описание | Target p95 |
|---|---|---|
| `trips-search.js` | Поиск поездок `/v1/trips/search` | < 500 мс |
| `booking-saga.js` | Полный цикл: поиск → бронирование → поллинг статуса | < 2000 мс (book) |
| `cancel-booking.js` | Бронирование → отмена | < 1000 мс (cancel) |
| `admin-config.js` | Чтение конфигов `/internal/configs` с HMAC | < 300 мс |

## Запуск локально

```bash
# Поиск поездок
k6 run --env BASE_URL=http://localhost:3000 trips-search.js

# Бронирование (нужен JWT-токен)
k6 run --env BASE_URL=http://localhost:3000 \
       --env AUTH_TOKEN=<jwt-token> \
       booking-saga.js

# Отмена бронирования
k6 run --env BASE_URL=http://localhost:3000 \
       --env AUTH_TOKEN=<jwt-token> \
       cancel-booking.js

# Чтение конфигов (напрямую к admin-service)
k6 run --env ADMIN_BASE_URL=http://localhost:3005 \
       --env HMAC_SECRET=hmac-secret-for-dev-at-least-32-chars!! \
       admin-config.js
```

## Запуск через Docker

```bash
docker run --rm -i --network=host \
  -v $(pwd)/load-tests:/scripts \
  grafana/k6:latest run /scripts/trips-search.js \
  --env BASE_URL=http://localhost:3000
```

## Настройка параметров

Каждый скрипт использует `constant-arrival-rate` executor. Для изменения нагрузки, отредактируйте секцию `options.scenarios` в соответствующем файле:

- `rate` — количество итераций в секунду
- `duration` — длительность теста
- `preAllocatedVUs` / `maxVUs` — пул виртуальных пользователей

## Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `BASE_URL` | `http://localhost:3000` | URL api-gateway |
| `ADMIN_BASE_URL` | `http://localhost:3005` | URL admin-service |
| `AUTH_TOKEN` | (пусто) | JWT access token |
| `HMAC_SECRET` | dev-default | HMAC секрет для internal endpoints |

## Интерпретация результатов

k6 выводит summary с метриками:

- **http_req_duration** — p50, p90, p95, p99 задержки
- **http_req_failed** — процент ошибок
- **iterations** — общее количество итераций

Thresholds определены в каждом скрипте. Тест помечается как FAIL если threshold нарушен.
