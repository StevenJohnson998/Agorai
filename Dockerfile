# Agorai Bridge — multi-agent collaboration server
# Usage: docker run -v ./agorai.config.json:/app/agorai.config.json agorai/bridge

FROM node:20-alpine AS builder

# better-sqlite3 needs build tools for native addon
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine

# Runtime: better-sqlite3 native addon needs libstdc++
RUN apk add --no-cache libstdc++

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/data

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:3100/health || exit 1

ENTRYPOINT ["node", "dist/cli.js", "serve"]
