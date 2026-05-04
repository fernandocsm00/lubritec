# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Stage 1 — builder: install all deps, type-check, build frontend + server
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app

# Cache deps separately from source for faster rebuilds
COPY package.json package-lock.json ./
RUN npm ci

# Copy sources required by the build
COPY tsconfig.json tsconfig.server.json vite.config.ts tailwind.config.ts components.json index.html ./
COPY server ./server
COPY shared ./shared
COPY src ./src

# Vite → /app/dist; tsc → /app/dist-server
RUN npm run build

# Prune dev deps after build so we can copy a slim node_modules to runtime
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 2 — runtime: minimal image with only what's needed to run
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Production deps only
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server

# SQL migrations are read at runtime by migrate.js
COPY --from=builder /app/server/db/migrations ./server/db/migrations

# Uploads dir (multer writes here)
RUN mkdir -p uploads

EXPOSE 3000

# Migrate then start. Migrate is idempotent (checks _migrations table).
CMD ["npm", "run", "start:prod"]
