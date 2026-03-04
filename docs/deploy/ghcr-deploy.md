# Развертывание Sapar через Docker-образы из GHCR

> **Не клонируйте репозиторий на серверы.** На серверах находятся только Docker-образы, `docker-compose.deploy.yml` и `.env`.

## Предварительные требования

- Yandex Cloud VM с Ubuntu 22.04+
- Docker Engine 24+ и плагин Docker Compose v2
- Доступ к GHCR (GitHub Container Registry)

## 1. Установка Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
```

После этого перелогиньтесь (или выполните `newgrp docker`), чтобы группа docker применилась.

## 2. Создание рабочей директории

```bash
sudo mkdir -p /opt/sapar
sudo chown $USER:$USER /opt/sapar
```

## 3. Размещение файлов

Скопируйте на сервер два файла:

| Файл | Назначение |
|------|-----------|
| `/opt/sapar/docker-compose.deploy.yml` | Описание стека (только `image:`, без `build:`) |
| `/opt/sapar/.env` | Секреты и переменные окружения |

Пример копирования через scp:

```bash
scp docker-compose.deploy.yml user@server:/opt/sapar/
scp .env user@server:/opt/sapar/
```

### Минимальный `.env`

```dotenv
GHCR_USER=your-github-username
POSTGRES_PASSWORD=<strong-password>
JWT_ACCESS_SECRET=<jwt-secret>
JWT_ACCESS_TTL_SEC=900
REFRESH_TOKEN_TTL_SEC=2592000
EVENTS_HMAC_SECRET=<hmac-secret>
PAYMENTS_WEBHOOK_SECRET=<webhook-secret>
SEED_ADMIN_EMAIL=admin@sapar.kg
SEED_ADMIN_PASSWORD=<admin-password>
ALLOWED_ORIGINS=https://your-domain.com
```

## 4. Авторизация в GHCR

Выполните однократно на каждом сервере:

```bash
echo "<GHCR_TOKEN>" | docker login ghcr.io -u <GHCR_USER> --password-stdin
```

Учетные данные сохранятся в `~/.docker/config.json`.

## 5. Первый запуск (staging)

```bash
cd /opt/sapar
IMAGE_TAG=dev docker compose -f docker-compose.deploy.yml pull
IMAGE_TAG=dev docker compose -f docker-compose.deploy.yml up -d
```

Проверка:

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/ready
```

## 6. Первый запуск (production)

```bash
cd /opt/sapar
IMAGE_TAG=prod docker compose -f docker-compose.deploy.yml pull
IMAGE_TAG=prod docker compose -f docker-compose.deploy.yml up -d
```

Проверка:

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/ready
```

## 7. Обновление

Последующие обновления выполняются автоматически через GitHub Actions. При пуше в ветку `dev` — staging, при ручном запуске workflow — production.

Ручное обновление при необходимости:

```bash
cd /opt/sapar
IMAGE_TAG=dev docker compose -f docker-compose.deploy.yml pull
IMAGE_TAG=dev docker compose -f docker-compose.deploy.yml up -d
```

## 8. Просмотр логов

```bash
cd /opt/sapar
IMAGE_TAG=dev docker compose -f docker-compose.deploy.yml logs -f api-gateway
IMAGE_TAG=dev docker compose -f docker-compose.deploy.yml logs -f --tail 100
```

## Важно

- **Не клонируйте репозиторий на серверы** — на серверах pull-ятся только Docker-образы.
- Все `.md` файлы, исходный код и прочее содержимое репозитория никогда не попадает на серверы.
- Образы собираются в GitHub Actions и пушатся в `ghcr.io/<GHCR_USER>/sapar-<service>:<tag>`.
