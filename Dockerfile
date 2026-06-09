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
COPY public ./public

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

# wget is used by the HEALTHCHECK and is not in node:alpine by default.
RUN apk add --no-cache wget

# Production deps only (includes tsx)
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json

# Frontend build
COPY --from=builder --chown=node:node /app/dist ./dist

# Server source (executed by tsx at runtime — same as dev)
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/shared ./shared
COPY --from=builder --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=node:node /app/tsconfig.server.json ./tsconfig.server.json

# Uploads dir for multer. Declared as a VOLUME so EasyPanel (or any host) can
# bind-mount persistent storage here — without it, uploaded media is lost
# on every redeploy.
RUN mkdir -p uploads && chown -R node:node uploads
VOLUME ["/app/uploads"]

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Migrate (idempotent) then start the server.
CMD ["npm", "run", "start:prod"]
