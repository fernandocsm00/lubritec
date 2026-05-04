# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Stage 1 — builder: install all deps, type-check, build frontend
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app

# Cache deps separately from source for faster rebuilds
COPY package.json package-lock.json ./
RUN npm ci

# Copy sources required by the build (vite + tsc type-check)
COPY tsconfig.json tsconfig.server.json vite.config.ts tailwind.config.ts components.json index.html ./
COPY server ./server
COPY shared ./shared
COPY src ./src

# Type-check (both client and server) + Vite build → /app/dist.
# Server is NOT compiled to dist-server: we run TypeScript directly via tsx in prod.
RUN npm run build

# Drop dev deps (tsx stays — it's a runtime dep)
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 2 — runtime: minimal image with only what's needed to run
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Production deps only (includes tsx)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Frontend build
COPY --from=builder /app/dist ./dist

# Server source (executed by tsx at runtime — same as dev)
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/tsconfig.server.json ./tsconfig.server.json

# Uploads dir (multer writes here — mount as volume in prod for persistence)
RUN mkdir -p uploads

EXPOSE 3000

# Migrate (idempotent) then start the server.
CMD ["npm", "run", "start:prod"]
