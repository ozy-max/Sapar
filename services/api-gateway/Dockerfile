FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate

COPY . .
RUN npm run build

# ── production image ──
FROM node:20-alpine
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN chown -R node:node /app
USER node
EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
