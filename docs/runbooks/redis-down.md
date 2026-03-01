# Runbook: Redis Down

## Алерты
- `RedisErrorsHigh` — Redis ошибки на gateway растут

## Симптомы
- Gateway readiness probe возвращает 503 (Redis unreachable)
- Rate limiting не работает (failStrategy=open: трафик проходит без лимитов)
- Рост `redis_errors_total` в метриках
- Логи: `rate_limiter_unavailable_open` или `rate_limiter_unavailable_closed`

## Дашборды
1. **Gateway** — Redis Latency, Redis Errors
2. **Sapar Overview** — RPS (может расти без rate limiting)

## Немедленные действия

### 1. Проверить состояние Redis
```bash
# Пинг Redis
docker exec sapar-redis-1 redis-cli ping

# Проверить использование памяти
docker exec sapar-redis-1 redis-cli info memory | grep used_memory_human

# Проверить количество подключений
docker exec sapar-redis-1 redis-cli info clients | grep connected_clients
```

### 2. Рестарт Redis
```bash
docker restart sapar-redis-1

# Подождать 5 секунд и проверить
sleep 5
docker exec sapar-redis-1 redis-cli ping
```

### 3. Проверить конфигурацию
```bash
# REDIS_URL в .env
grep REDIS_URL .env.docker

# Проверить доступность из gateway контейнера
docker exec sapar-api-gateway-1 curl -s telnet://redis:6379
```

### 4. Временные меры
- При `failStrategy: 'open'` (identity, trips, BFF) — трафик проходит БЕЗ rate limiting. Мониторить нагрузку.
- При `failStrategy: 'closed'` (payments, admin) — запросы блокируются с 503. Срочный рестарт Redis.

## Откат
- Redis stateless для rate limiting — рестарт безопасен, данные rate limit окон потеряются (допустимо)
- Если Redis полностью недоступен и рестарт не помогает:
  1. Проверить `docker logs sapar-redis-1`
  2. Проверить диск: `docker exec sapar-redis-1 df -h`
  3. При необходимости пересоздать: `docker-compose up -d --force-recreate redis`

## Эскалация
- Если Redis не восстановить за 10 минут — рассмотреть временное отключение REDIS_URL (gateway работает без rate limiting)
