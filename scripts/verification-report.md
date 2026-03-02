# Отчёт функциональной верификации Sapar

**Дата:** 2026-03-02 08:35:28 UTC
**Run ID:** 1772440483

## Сводка

| Метрика | Значение |
|---------|----------|
| Всего тестов | 110 |
| Пройдено (PASS) | 103 |
| Провалено (FAIL) | 0 |
| Пропущено (SKIP) | 7 |
| Результат | **ВСЕ ТЕСТЫ ПРОЙДЕНЫ** |

## Готовность сервисов

| Сервис | Статус |
|--------|--------|
| api-gateway | 200 |
| identity-service | 200 |
| trips-service | 200 |
| payments-service | 200 |
| notifications-service | 200 |
| admin-service | 200 |
| profiles-service | 200 |

## Результаты по эндпоинтам

| Фаза | ID | Эндпоинт | Роль | Метод | Ожидалось | Получено | Результат | Детали |
|------|----|----------|------|-------|-----------|----------|-----------|--------|
| "P0" | "P0-api-gateway" | "/health | /ready" | "system" | "GET" | "200" | "200" | "PASS","api-gateway готов (5с)" |
| "P0" | "P0-identity-service" | "/health | /ready" | "system" | "GET" | "200" | "200" | "PASS","identity-service готов (0с)" |
| "P0" | "P0-trips-service" | "/health | /ready" | "system" | "GET" | "200" | "200" | "PASS","trips-service готов (0с)" |
| "P0" | "P0-payments-service" | "/health | /ready" | "system" | "GET" | "200" | "200" | "PASS","payments-service готов (0с)" |
| "P0" | "P0-notifications-service" | "/health | /ready" | "system" | "GET" | "200" | "200" | "PASS","notifications-service готов (0с)" |
| "P0" | "P0-admin-service" | "/health | /ready" | "system" | "GET" | "200" | "200" | "PASS","admin-service готов (0с)" |
| "P0" | "P0-profiles-service" | "/health | /ready" | "system" | "GET" | "200" | "200" | "PASS","profiles-service готов (0с)" |
| "P1" | "P1-api-gateway" | "/swagger-json" | "system" | "GET" | "200" | "404" | "SKIP" | "Swagger отключён (NODE_ENV=production)" |
| "P1" | "P1-identity-service" | "/swagger-json" | "system" | "GET" | "200" | "404" | "SKIP" | "Swagger отключён (NODE_ENV=production)" |
| "P1" | "P1-trips-service" | "/swagger-json" | "system" | "GET" | "200" | "404" | "SKIP" | "Swagger отключён (NODE_ENV=production)" |
| "P1" | "P1-payments-service" | "/swagger-json" | "system" | "GET" | "200" | "404" | "SKIP" | "Swagger отключён (NODE_ENV=production)" |
| "P1" | "P1-notifications-service" | "/swagger-json" | "system" | "GET" | "200" | "404" | "SKIP" | "Swagger отключён (NODE_ENV=production)" |
| "P1" | "P1-admin-service" | "/swagger-json" | "system" | "GET" | "200" | "404" | "SKIP" | "Swagger отключён (NODE_ENV=production)" |
| "P1" | "P1-profiles-service" | "/swagger-json" | "system" | "GET" | "200" | "404" | "SKIP" | "Swagger отключён (NODE_ENV=production)" |
| "P2" | "P2-admin-login" | "/identity/auth/login" | "admin" | "POST" | "200" | "200" | "PASS" | "" |
| "P2" | "P2-reg-passenger" | "/identity/auth/register" | "anon" | "POST" | "201" | "201" | "PASS" | "userId=2ab92e96-447e-44a6-a53a-c3a7eeb3dff9" |
| "P2" | "P2-role-passenger" | "/identity/admin/users/{id}/roles" | "admin" | "POST" | "200" | "200" | "PASS" | "" |
| "P2" | "P2-reg-driver" | "/identity/auth/register" | "anon" | "POST" | "201" | "201" | "PASS" | "userId=0ada7375-7fe9-4509-83b3-ae90ae69074f" |
| "P2" | "P2-role-driver" | "/identity/admin/users/{id}/roles" | "admin" | "POST" | "200" | "200" | "PASS" | "" |
| "P2" | "P2-reg-passenger2" | "/identity/auth/register" | "anon" | "POST" | "201" | "201" | "PASS" | "userId=6f44d1b0-279a-4c20-8f7d-5ebd6771db99" |
| "P2" | "P2-role-passenger2" | "/identity/admin/users/{id}/roles" | "admin" | "POST" | "200" | "200" | "PASS" | "" |
| "P2" | "P2-reg-support" | "/identity/auth/register" | "anon" | "POST" | "201" | "201" | "PASS" | "userId=ddc19043-f4e8-46be-b22b-b6e4b51f1fab" |
| "P2" | "P2-role-support" | "/identity/admin/users/{id}/roles" | "admin" | "POST" | "200" | "200" | "PASS" | "" |
| "P2" | "P2-reg-ops" | "/identity/auth/register" | "anon" | "POST" | "201" | "201" | "PASS" | "userId=b30fd435-4254-4970-b798-68dbebf9cefb" |
| "P2" | "P2-role-ops" | "/identity/admin/users/{id}/roles" | "admin" | "POST" | "200" | "200" | "PASS" | "" |
| "P2" | "P2-jwt-passenger" | "JWT" | "passenger" | "VERIFY" | "PASSENGER" | "PASSENGER" | "PASS" | "" |
| "P2" | "P2-jwt-driver" | "JWT" | "driver" | "VERIFY" | "DRIVER" | "DRIVER" | "PASS" | "" |
| "P2" | "P2-jwt-admin" | "JWT" | "admin" | "VERIFY" | "ADMIN" | "ADMIN" | "PASS" | "" |
| "P2" | "P2-jwt-support" | "JWT" | "support" | "VERIFY" | "SUPPORT" | "SUPPORT" | "PASS" | "" |
| "P2" | "P2-jwt-ops" | "JWT" | "ops" | "VERIFY" | "OPS" | "OPS" | "PASS" | "" |
| "P3A" | "3A-dup-email" | "/identity/auth/register" | "anon" | "POST" | "409" | "409" | "PASS" | "Дубликат email" |
| "P3A" | "3A-wrong-pass" | "/identity/auth/login" | "anon" | "POST" | "401" | "401" | "PASS" | "" |
| "P3A" | "3A-validation" | "/identity/auth/register" | "anon" | "POST" | "400" | "400" | "PASS" | "Валидация пароля" |
| "P3A" | "3A-refresh" | "/identity/auth/refresh" | "passenger" | "POST" | "200" | "200" | "PASS" | "Ротация токена" |
| "P3A" | "3A-refresh-reuse" | "/identity/auth/refresh" | "passenger" | "POST" | "401" | "401" | "PASS" | "Повторное использование отозвано" |
| "P3A" | "3A-logout" | "/identity/auth/logout" | "passenger" | "POST" | "204" | "204" | "PASS" | "" |
| "P3A" | "3A-refresh-post-logout" | "/identity/auth/refresh" | "passenger" | "POST" | "401" | "401" | "PASS" | "Refresh после logout отклонён" |
| "P3A" | "3A-invalid-jwt" | "/identity/admin/users/{id}/roles" | "anon" | "POST" | "401" | "401" | "PASS" | "" |
| "P3A" | "3A-rbac-assign" | "/identity/admin/users/{id}/roles" | "passenger" | "POST" | "403" | "403" | "PASS" | "Пассажир не может назначать роли" |
| "P3C" | "3C-create-trip" | "POST /trips" | "driver" | "POST" | "201" | "201" | "PASS" | "tripId=a353a266-9979-4449-8483-6839bb961378" |
| "P3C" | "3C-trip-validation" | "POST /trips" | "driver" | "POST" | "400" | "400" | "PASS" | "" |
| "P3C" | "3C-trip-noauth" | "POST /trips" | "anon" | "POST" | "401" | "401" | "PASS" | "" |
| "P3C" | "3C-search" | "GET /trips/search" | "anon" | "GET" | "200" | "200" | "PASS" | "" |
| "P3C" | "3C-book" | "POST /trips/{id}/book" | "passenger" | "POST" | "201" | "201" | "PASS" | "bookingId=d2c6ac10-ec99-4514-9e1d-931be7cc77df" |
| "P3C" | "3C-idempotent" | "POST /trips/{id}/book" | "passenger" | "POST" | "201" | "201" | "PASS" | "Идемпотентность OK" |
| "P3C" | "3C-dup-booking" | "POST /trips/{id}/book" | "passenger" | "POST" | "409" | "409" | "PASS" | "Повторное бронирование отклонено" |
| "P3C" | "3C-cancel-nonowner" | "POST /trips/bookings/{id}/cancel" | "passenger2" | "POST" | "403" | "403" | "PASS" | "" |
| "P3C" | "3C-race-seat" | "POST /trips/{id}/book (race)" | "P1+P2" | "POST" | "201+409" | "201+409" | "PASS" | "Один получил место, другой — 409" |
| "P3C" | "3C-idem-race" | "POST /trips/{id}/book (idem race)" | "passenger" | "POST" | "no 500" | "409+201" | "PASS" | "Без 500 (bookingId: null / 8f62661f-1074-48c6-a417-1bbe6ca531c6)" |
| "P3C" | "3C-cancel-nondriver" | "POST /trips/{id}/cancel" | "passenger" | "POST" | "403" | "403" | "PASS" | "" |
| "P3C" | "3C-cancel-trip" | "POST /trips/{id}/cancel" | "driver" | "POST" | "200" | "200" | "PASS" | "" |
| "P3C" | "3C-book-cancelled" | "POST /trips/{id}/book" | "passenger" | "POST" | "409" | "409" | "PASS" | "Бронь на отменённую поездку отклонена" |
| "P3C" | "3C-complete-nondriver" | "POST /trips/{id}/complete" | "passenger" | "POST" | "403" | "403" | "PASS" | "" |
| "P3C" | "3C-complete-trip" | "POST /trips/{id}/complete" | "driver" | "POST" | "200" | "200" | "PASS" | "" |
| "P3C" | "3C-cancel-booking" | "POST /trips/bookings/{id}/cancel" | "passenger" | "POST" | "200" | "200" | "PASS" | "" |
| "P3C" | "3C-book-notfound" | "POST /trips/{id}/book" | "passenger" | "POST" | "404" | "404" | "PASS" | "" |
| "P3B" | "3B-bff-search" | "GET /v1/trips/search" | "anon" | "GET" | "200" | "200" | "PASS" | "items=4" |
| "P3B" | "3B-bff-search-400" | "GET /v1/trips/search" | "anon" | "GET" | "400" | "400" | "PASS" | "Валидация: нужен фильтр локации" |
| "P3B" | "3B-bff-trip" | "GET /v1/trips/{id}" | "anon" | "GET" | "200" | "200" | "PASS" | "" |
| "P3B" | "3B-bff-trip-baduuid" | "GET /v1/trips/{invalid}" | "anon" | "GET" | "400" | "400" | "PASS" | "" |
| "P3B" | "3B-bff-trip-404" | "GET /v1/trips/{unknown}" | "anon" | "GET" | "404" | "404" | "PASS" | "" |
| "P3B" | "3B-bff-booking-noauth" | "GET /v1/bookings/{id}" | "anon" | "GET" | "401" | "401" | "PASS" | "" |
| "P3B" | "3B-bff-booking" | "GET /v1/bookings/{id}" | "passenger" | "GET" | "200" | "200" | "PASS" | "" |
| "P3B" | "3B-bff-me-noauth" | "GET /v1/me/bookings" | "anon" | "GET" | "401" | "401" | "PASS" | "" |
| "P3B" | "3B-bff-me" | "GET /v1/me/bookings" | "passenger" | "GET" | "200" | "200" | "PASS" | "" |
| "P3B" | "3B-bff-me-badstatus" | "GET /v1/me/bookings?status=INVALID" | "passenger" | "GET" | "400" | "400" | "PASS" | "" |
| "P3D" | "3D-create-intent" | "POST /payments/payments/intents" | "passenger" | "POST" | "201" | "201" | "PASS" | "intentId=46356385-293e-44f8-8cb2-3d8152416403" |
| "P3D" | "3D-intent-idem" | "POST /payments/payments/intents" | "passenger" | "POST" | "201/409" | "201" | "PASS" | "Идемпотентность платежа" |
| "P3D" | "3D-intent-noauth" | "POST /payments/payments/intents" | "anon" | "POST" | "401" | "401" | "PASS" | "" |
| "P3D" | "3D-capture" | "POST /payments/.../capture" | "passenger" | "POST" | "200/409" | "409" | "PASS" | "Сага уже capture-ила intent" |
| "P3D" | "3D-double-capture" | "POST /payments/.../capture (2nd)" | "passenger" | "POST" | "409" | "409" | "PASS" | "Повторный capture отклонён" |
| "P3D" | "3D-refund" | "POST /payments/.../refund" | "passenger" | "POST" | "200" | "200" | "PASS" | "" |
| "P3D" | "3D-cancel-intent" | "POST /payments/.../cancel" | "passenger" | "POST" | "200" | "200" | "PASS" | "" |
| "P3D" | "3D-refund-cancelled" | "POST /payments/.../refund (cancelled)" | "passenger" | "POST" | "409" | "409" | "PASS" | "" |
| "P3D" | "3D-wh-badsig" | "POST /payments/webhooks/psp" | "psp" | "POST" | "401" | "401" | "PASS" | "Невалидная подпись отклонена" |
| "P3D" | "3D-wh-validsig" | "POST /payments/webhooks/psp" | "psp" | "POST" | "204/404" | "404" | "PASS" | "Подпись валидна (psp not found OK)" |
| "P3D" | "3D-wh-concurrent" | "POST webhooks/psp (concurrent)" | "psp" | "POST" | "no 500" | "404+404" | "PASS" | "" |
| "P3D" | "3D-wh-nosig" | "POST webhooks/psp (no sig)" | "psp" | "POST" | "401" | "401" | "PASS" | "" |
| "P3E" | "3E-enqueue" | "POST /notifications" | "passenger" | "POST" | "201" | "201" | "PASS" | "id=41d963df-9e23-4554-b29e-5b1255248f1e" |
| "P3E" | "3E-notif-idem" | "POST /notifications (idem)" | "passenger" | "POST" | "201" | "201" | "PASS" | "" |
| "P3E" | "3E-notif-conflict" | "POST /notifications (conflict)" | "passenger" | "POST" | "409/400" | "400" | "PASS" | "Конфликт идемпотентности" |
| "P3E" | "3E-get-notif" | "GET /notifications/{id}" | "passenger" | "GET" | "200" | "200" | "PASS" | "status=PENDING" |
| "P3E" | "3E-cancel-notif" | "POST /notifications/{id}/cancel" | "passenger" | "POST" | "200" | "200" | "PASS" | "" |
| "P3E" | "3E-noauth" | "POST /notifications" | "anon" | "POST" | "401" | "401" | "PASS" | "" |
| "P3E" | "3E-validation" | "POST /notifications (bad)" | "passenger" | "POST" | "400" | "400" | "PASS" | "" |
| "P3F" | "3F-cfg-put" | "PUT /admin/configs/{key}" | "admin" | "PUT" | "200" | "200" | "PASS" | "" |
| "P3F" | "3F-cfg-put-ops" | "PUT /admin/configs/{key}" | "ops" | "PUT" | "200" | "200" | "PASS" | "" |
| "P3F" | "3F-cfg-list" | "GET /admin/configs" | "support" | "GET" | "200" | "200" | "PASS" | "" |
| "P3F" | "3F-cfg-get" | "GET /admin/configs/{key}" | "admin" | "GET" | "200" | "200" | "PASS" | "" |
| "P3F" | "3F-cfg-del" | "DELETE /admin/configs/{key}" | "admin" | "DELETE" | "204" | "204" | "PASS" | "" |
| "P3F" | "3F-cfg-del-ops" | "DELETE /admin/configs/{key}" | "ops" | "DELETE" | "403" | "403" | "PASS" | "OPS не может удалять" |
| "P3F" | "3F-cfg-passenger" | "GET /admin/configs" | "passenger" | "GET" | "403" | "403" | "PASS" | "Пассажир не имеет доступа к admin" |
| "P3F" | "3F-dispute-create" | "POST /admin/disputes" | "support" | "POST" | "201" | "201" | "PASS" | "id=27ae7388-9011-49e6-b09d-9f976b192cb2" |
| "P3F" | "3F-dispute-get" | "GET /admin/disputes/{id}" | "support" | "GET" | "200" | "200" | "PASS" | "" |
| "P3F" | "3F-dispute-resolve" | "POST /admin/disputes/{id}/resolve" | "admin" | "POST" | "200" | "200" | "PASS" | "resolution=REFUND" |
| "P3F" | "3F-dispute-close" | "POST /admin/disputes/{id}/close" | "admin" | "POST" | "200" | "200" | "PASS" | "" |
| "P3F" | "3F-dispute-partial-noamt" | "POST /disputes/{id}/resolve PARTIAL" | "admin" | "POST" | "400" | "400" | "PASS" | "refundAmountKgs обязателен" |
| "P3F" | "3F-mod-ban" | "POST /admin/moderation/users/{id}/ban" | "ops" | "POST" | "201" | "201" | "PASS" | "" |
| "P3F" | "3F-mod-unban" | "POST /admin/moderation/users/{id}/unban" | "ops" | "POST" | "201" | "201" | "PASS" | "" |
| "P3F" | "3F-mod-cancel-trip" | "POST /admin/moderation/trips/{id}/cancel" | "admin" | "POST" | "201" | "201" | "PASS" | "" |
| "P3F" | "3F-mod-support-403" | "POST /admin/moderation/.../ban" | "support" | "POST" | "403" | "403" | "PASS" | "SUPPORT не может банить" |
| "P3F" | "3F-admin-passenger" | "POST /admin/disputes" | "passenger" | "POST" | "403" | "403" | "PASS" | "" |
| "P3G" | "3G-update-profile" | "PUT /profiles/me/profile" | "passenger" | "PUT" | "200" | "200" | "PASS" | "" |
| "P3G" | "3G-profile-noauth" | "PUT /profiles/me/profile" | "anon" | "PUT" | "401" | "401" | "PASS" | "" |
| "P3G" | "3G-get-profile" | "GET /profiles/profiles/{id}" | "anon" | "GET" | "200" | "200" | "PASS" | "" |
| "P3G" | "3G-get-ratings" | "GET /profiles/profiles/{id}/ratings" | "anon" | "GET" | "200" | "200" | "PASS" | "" |
| "P3G" | "3G-create-rating" | "POST /profiles/ratings" | "passenger" | "POST" | "201/403" | "403" | "PASS" | "Нет eligibility (сага не завершилась)" |
| "P3G" | "3G-rating-ineligible" | "POST /profiles/ratings (ineligible)" | "passenger" | "POST" | "403/409" | "403" | "PASS" | "" |
| "P3G" | "3G-rating-validation" | "POST /profiles/ratings (bad)" | "passenger" | "POST" | "400" | "400" | "PASS" | "" |
| "P4" | "4-hmac-trips-valid" | "POST /internal/events (trips)" | "system" | "POST" | "200" | "200" | "PASS" | "status=ignored" |
| "P4" | "4-hmac-trips-dup" | "POST /internal/events (dup)" | "system" | "POST" | "200+dup" | "200+ignored" | "PASS" | "Повторная отправка (status=ignored)" |
| "P4" | "4-hmac-trips-invalid" | "POST /internal/events (bad hmac)" | "system" | "POST" | "401" | "401" | "PASS" | "" |
| "P4" | "4-hmac-trips-expired" | "POST /internal/events (old ts)" | "system" | "POST" | "401" | "401" | "PASS" | "Replay protection работает" |
| "P4" | "4-hmac-payments" | "POST /internal/events (payments)" | "system" | "POST" | "200" | "200" | "PASS" | "" |
| "P4" | "4-hmac-notif" | "POST /internal/events (notif)" | "system" | "POST" | "200" | "200" | "PASS" | "" |
| "P4" | "4-hmac-profiles" | "POST /internal/events (profiles)" | "system" | "POST" | "200" | "200" | "PASS" | "" |
| "P4" | "4-hmac-admin-configs" | "GET /internal/configs (admin)" | "system" | "GET" | "200/304" | "200" | "PASS" | "" |
| "P4" | "4-hmac-admin-commands" | "GET /internal/commands" | "system" | "GET" | "200" | "200" | "PASS" | "" |
| "P4" | "4-hmac-admin-nohmac" | "GET /internal/configs (no hmac)" | "system" | "GET" | "401" | "401" | "PASS" | "" |
| "P5" | "5-metrics" | "GET /metrics" | "system" | "GET" | "200" | "200" | "PASS" | "http_request метрики: 590" |

## Список багов

Багов не обнаружено.


## Результаты по ролям

### Passenger
Тестов: 37
Провалов: 0

### Driver
Тестов: 5
Провалов: 0

### Admin
Тестов: 14
Провалов: 0

### Support
Тестов: 5
Провалов: 0

### Ops
Тестов: 5
Провалов: 0

---
*Отчёт сгенерирован автоматически скриптом mega-functional-verification.sh*
