# Fundação LubriConnect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refatorar a base do LubriConnect para suportar os 5 módulos novos (Admin/RBAC, Cadastros, CRM, WhatsApp+Filas, Dashboard de Funil) — substituindo SQLite por Postgres, App.tsx monolítico por arquitetura em camadas com shadcn/ui, e auth fake por sistema real (senha + magic link para convite/reset).

**Architecture:** Vite + React 19 + Express (refactor interno, sem migrar para Next.js). Backend em camadas (routes → controllers → services → db). Frontend com features auto-contidas (`features/<modulo>/`), shadcn/ui, TanStack Query, Zustand, React Router v6.

**Tech Stack:** TypeScript, PostgreSQL 16, Drizzle ORM, Express, argon2, jsonwebtoken, nodemailer, vitest + supertest (testes), React 19, Vite, Tailwind CSS, shadcn/ui, TanStack Query, Zustand, React Hook Form, Zod.

**Spec:** [`docs/superpowers/specs/2026-04-29-fundacao-design.md`](../specs/2026-04-29-fundacao-design.md)

---

## File Structure

### Created
```
.env.example                            # Template de variáveis de ambiente
.gitignore                              # Padrão Node + .env + lubritec.db
docker-compose.yml                      # Postgres 16 local
drizzle.config.ts                       # Config do drizzle-kit
tsconfig.server.json                    # tsconfig específico para o backend
README.md                               # Como subir o projeto
shared/types.ts                         # Tipos compartilhados front/back
server/
  index.ts                              # Entry point Express
  routes/auth.ts                        # Rotas de auth (login, refresh, etc.)
  routes/users.ts                       # POST /api/users (invite)
  controllers/authController.ts         # Handlers HTTP para auth
  controllers/usersController.ts        # Handler para invite
  services/authService.ts               # Regra de negócio de auth
  services/usersService.ts              # Regra de negócio de usuários
  middleware/authGuard.ts               # Verifica JWT, popula req.user
  middleware/requireRole.ts             # Checa role
  middleware/errorHandler.ts            # Captura erros, formata JSON
  middleware/rateLimit.ts               # Rate limiting básico em memória
  lib/jwt.ts                            # Sign/verify access JWT
  lib/hash.ts                           # argon2 + SHA-256
  lib/tokens.ts                         # Geração/verificação de auth_tokens
  lib/mailer.ts                         # nodemailer + templates
  db/client.ts                          # pg pool + drizzle
  db/schema.ts                          # Schema Drizzle (users, auth_tokens, sessions, leads)
  db/migrations/001_extensions.sql      # CREATE EXTENSION pgcrypto
  db/migrations/002_users.sql           # users table
  db/migrations/003_auth_tokens.sql     # auth_tokens table
  db/migrations/004_sessions.sql        # sessions table
  db/migrations/005_leads.sql           # leads table
  scripts/migrate.ts                    # Runner de migrations
  scripts/seed.ts                       # Cria admin inicial
  scripts/import-legacy-customers.ts    # SQLite → Postgres
  tests/setup.ts                        # Setup de testes (DB de teste)
  tests/helpers.ts                      # Factories e helpers
  tests/auth.test.ts                    # Integration tests dos endpoints de auth
src/
  app/App.tsx                           # Root component (Router + Providers)
  app/routes.tsx                        # Definição de rotas
  app/providers.tsx                     # QueryClient, Theme provider
  pages/login/Login.tsx
  pages/auth-setup/SetupPassword.tsx
  pages/auth-reset/ResetPassword.tsx
  pages/dashboard/DashboardPage.tsx     # Placeholder
  pages/whatsapp/WhatsappPage.tsx       # Placeholder
  pages/inside-sales/InsideSalesPage.tsx# Placeholder
  pages/cadastros/CadastrosPage.tsx     # Placeholder
  pages/admin/AdminPage.tsx             # Placeholder
  pages/settings/SettingsPage.tsx       # Placeholder
  pages/NotFound.tsx
  features/auth/store.ts                # Zustand auth store
  features/auth/api.ts                  # TanStack hooks de auth
  features/auth/ProtectedRoute.tsx
  features/auth/AdminRoute.tsx
  components/layout/AppShell.tsx
  components/layout/Sidebar.tsx
  components/layout/Topbar.tsx
  components/ui/                        # shadcn primitives (gerados)
  lib/apiClient.ts                      # fetch wrapper + refresh handler
  lib/utils.ts                          # cn() helper do shadcn
  styles/globals.css                    # CSS vars + tokens
  hooks/useAuth.ts                      # Hook que expõe o auth store
```

### Modified
- `package.json` — novas deps e scripts
- `tsconfig.json` — paths, includes
- `vite.config.ts` — alias `@`
- `tailwind.config.ts` — tokens shadcn
- `src/main.tsx` — passa a importar `./app/App`
- `index.html` — pequenas tweaks (font Inter)

### Deleted (no Task 25, no final)
- `src/App.tsx` (1158 linhas, código antigo)
- `src/index.css` (substituído por `src/styles/globals.css`)
- `server.ts` (192 linhas, código antigo)
- `lubritec.db` (após confirmação do import)

---

## Tasks

### Task 1: Inicializar git e arquivos de hygiene

**Files:**
- Create: `.gitignore`
- Create: `README.md` (versão inicial mínima — atualizada na Task 25)

- [ ] **Step 1: Inicializar git e fazer commit do estado atual como baseline**

```bash
cd C:/Saas_lubritec/lubritec-main
git init
git add -A
git status
```

- [ ] **Step 2: Criar `.gitignore`**

Crie `lubritec-main/.gitignore`:

```gitignore
# deps
node_modules/

# build
dist/
build/

# env
.env
.env.local
.env.*.local

# dbs
*.db
*.db-journal
*.sqlite
*.sqlite3

# logs
logs/
*.log
npm-debug.log*

# editor
.vscode/
.idea/
.DS_Store

# coverage
coverage/
.nyc_output/

# test
*.tsbuildinfo
```

- [ ] **Step 3: Criar README mínimo (atualizado depois)**

Crie `lubritec-main/README.md`:

```markdown
# LubriConnect

SaaS de qualificação de leads e atendimento WhatsApp para a Lubritec.

## Fundação

Em desenvolvimento. Veja `docs/superpowers/specs/2026-04-29-fundacao-design.md`.

Setup completo será documentado aqui na Task 25 do plano.
```

- [ ] **Step 4: Commit baseline + hygiene**

```bash
git add .gitignore README.md
git commit -m "chore: init git, add gitignore and stub readme"
```

Expected: 1 commit on `main` (ou `master`, depende do default git).

---

### Task 2: Instalar dependências e iniciar shadcn/ui

**Files:**
- Modify: `package.json`
- Create: `components.json` (gerado pelo shadcn CLI)
- Modify: `tsconfig.json`
- Modify: `vite.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`

- [ ] **Step 1: Instalar dependências de runtime do backend**

```bash
npm install pg drizzle-orm argon2 jsonwebtoken nodemailer cookie-parser
```

- [ ] **Step 2: Instalar dependências de runtime do frontend**

```bash
npm install react-router-dom @tanstack/react-query zustand react-hook-form zod @hookform/resolvers class-variance-authority clsx tailwind-merge tailwindcss-animate
```

- [ ] **Step 3: Instalar dependências de dev**

```bash
npm install -D drizzle-kit @types/pg @types/jsonwebtoken @types/nodemailer @types/cookie-parser @types/better-sqlite3 vitest supertest @types/supertest tsx
```

(`tsx` e `better-sqlite3` já estavam, mas reforçando).

- [ ] **Step 4: Configurar paths em `tsconfig.json`**

Substitua o conteúdo de `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@shared/*": ["shared/*"]
    }
  },
  "include": ["src", "shared"],
  "references": [{ "path": "./tsconfig.server.json" }]
}
```

- [ ] **Step 5: Criar `tsconfig.server.json`**

Crie `tsconfig.server.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "./dist-server",
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["shared/*"]
    }
  },
  "include": ["server", "shared"]
}
```

- [ ] **Step 6: Configurar Vite com alias**

Substitua `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
```

- [ ] **Step 7: Criar `tailwind.config.ts`**

Crie `tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
```

- [ ] **Step 8: Atualizar scripts em `package.json`**

Edite a seção `"scripts"` em `package.json` para:

```json
"scripts": {
  "dev": "tsx server/index.ts",
  "build": "vite build && tsc -p tsconfig.server.json --noEmit false --outDir dist-server",
  "preview": "vite preview",
  "lint": "tsc --noEmit && tsc -p tsconfig.server.json --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "migrate": "tsx server/scripts/migrate.ts",
  "seed": "tsx server/scripts/seed.ts",
  "import:legacy": "tsx server/scripts/import-legacy-customers.ts",
  "db:up": "docker-compose up -d",
  "db:down": "docker-compose down"
}
```

- [ ] **Step 9: Inicializar shadcn/ui**

```bash
npx shadcn@latest init -d
```

Quando perguntar, escolha:
- Style: New York
- Base color: Slate
- CSS variables: yes
- Path para componentes: `src/components/ui`
- Path para utils: `src/lib/utils`

(O CLI vai criar `components.json`, `src/lib/utils.ts`, e atualizar globals.css — vamos sobrescrever globals.css na Task 17.)

- [ ] **Step 10: Verificar instalação e commitar**

```bash
npm run lint
git add -A
git commit -m "chore: install deps, configure tsconfig/vite/tailwind, init shadcn"
```

Expected: lint passa sem erros (pode ter warnings sobre unused, OK).

---

### Task 3: Postgres local + .env

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `.env`

- [ ] **Step 1: Criar `docker-compose.yml`**

Crie `lubritec-main/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: lubritec-pg
    restart: unless-stopped
    environment:
      POSTGRES_USER: lubritec
      POSTGRES_PASSWORD: lubritec_dev
      POSTGRES_DB: lubritec
    ports:
      - '5432:5432'
    volumes:
      - lubritec-pg-data:/var/lib/postgresql/data

volumes:
  lubritec-pg-data:
```

- [ ] **Step 2: Criar `.env.example`**

Crie `lubritec-main/.env.example`:

```env
# Banco
DATABASE_URL=postgresql://lubritec:lubritec_dev@localhost:5432/lubritec
TEST_DATABASE_URL=postgresql://lubritec:lubritec_dev@localhost:5432/lubritec_test

# JWT
JWT_SECRET=change-me-to-a-long-random-string-min-32-chars
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL_DAYS=30

# Magic link / reset TTLs
INVITE_TTL_DAYS=7
RESET_TTL_HOURS=1

# SMTP (Mailtrap em dev)
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=changeme
SMTP_PASS=changeme
SMTP_FROM="LubriConnect <no-reply@lubritec.local>"

# App
APP_URL=http://localhost:5173
PORT=3000
NODE_ENV=development
```

- [ ] **Step 3: Criar `.env` real (copiando .env.example)**

```bash
cp .env.example .env
```

Edite o `.env` e gere um JWT_SECRET real:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Cole o valor em `JWT_SECRET=`.

- [ ] **Step 4: Subir Postgres e criar database de teste**

```bash
docker-compose up -d
```

Aguarde ~5s para subir, depois:

```bash
docker exec -it lubritec-pg psql -U lubritec -c "CREATE DATABASE lubritec_test;"
```

- [ ] **Step 5: Verificar conexão**

```bash
docker exec -it lubritec-pg psql -U lubritec -l
```

Expected: lista mostra `lubritec` e `lubritec_test`.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: add docker postgres + env template"
```

(`.env` está no .gitignore, não vai pro repo.)

---

### Task 4: DB client e migration runner

**Files:**
- Create: `server/db/client.ts`
- Create: `server/db/schema.ts` (vazio por enquanto, preenchido na Task 6)
- Create: `server/scripts/migrate.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Criar `server/db/schema.ts` vazio**

Crie `server/db/schema.ts`:

```typescript
// Drizzle schema. Tabelas adicionadas na Task 6.
export {};
```

- [ ] **Step 2: Criar `server/db/client.ts`**

Crie `server/db/client.ts`:

```typescript
import 'dotenv/config';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const { Pool } = pg;

const connectionString =
  process.env.NODE_ENV === 'test'
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL not set');
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });
```

- [ ] **Step 3: Criar `server/scripts/migrate.ts`**

Crie `server/scripts/migrate.ts`:

```typescript
import 'dotenv/config';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function appliedSet(): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>(
    'SELECT filename FROM _migrations',
  );
  return new Set(rows.map((r) => r.filename));
}

async function run() {
  await ensureMigrationsTable();
  const applied = await appliedSet();
  const all = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const filename of all) {
    if (applied.has(filename)) {
      console.log(`✓ ${filename} (already applied)`);
      continue;
    }
    const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [
        filename,
      ]);
      await client.query('COMMIT');
      console.log(`→ ${filename} (applied)`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`✗ ${filename} (failed):`, err);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log('Migrations done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Criar `drizzle.config.ts`** (para gerar tipos / introspect futuros)

Crie `drizzle.config.ts`:

```typescript
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 5: Criar diretório de migrations vazio**

```bash
mkdir -p server/db/migrations
touch server/db/migrations/.gitkeep
```

- [ ] **Step 6: Commit**

```bash
git add server/ drizzle.config.ts
git commit -m "feat(db): add postgres client and migration runner"
```

---

### Task 5: Migrations SQL (001-005)

**Files:**
- Create: `server/db/migrations/001_extensions.sql`
- Create: `server/db/migrations/002_users.sql`
- Create: `server/db/migrations/003_auth_tokens.sql`
- Create: `server/db/migrations/004_sessions.sql`
- Create: `server/db/migrations/005_leads.sql`

- [ ] **Step 1: 001_extensions.sql**

Crie `server/db/migrations/001_extensions.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

- [ ] **Step 2: 002_users.sql**

Crie `server/db/migrations/002_users.sql`:

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'comercial', 'recepcao')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
```

- [ ] **Step 3: 003_auth_tokens.sql**

Crie `server/db/migrations/003_auth_tokens.sql`:

```sql
CREATE TABLE auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('invite', 'password_reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id);
```

- [ ] **Step 4: 004_sessions.sql**

Crie `server/db/migrations/004_sessions.sql`:

```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip_address INET,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_refresh_hash ON sessions(refresh_token_hash);
```

- [ ] **Step 5: 005_leads.sql**

Crie `server/db/migrations/005_leads.sql`:

```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle_plate TEXT,
  vehicle_model TEXT,
  last_purchase_date DATE,
  avg_mileage_per_day INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_leads_phone ON leads(phone);
```

- [ ] **Step 6: Rodar migrations**

```bash
npm run migrate
```

Expected output:
```
→ 001_extensions.sql (applied)
→ 002_users.sql (applied)
→ 003_auth_tokens.sql (applied)
→ 004_sessions.sql (applied)
→ 005_leads.sql (applied)
Migrations done.
```

- [ ] **Step 7: Verificar tabelas criadas**

```bash
docker exec -it lubritec-pg psql -U lubritec -d lubritec -c "\dt"
```

Expected: lista mostra `users`, `auth_tokens`, `sessions`, `leads`, `_migrations`.

- [ ] **Step 8: Aplicar migrations no DB de teste**

```bash
NODE_ENV=test npm run migrate
```

(Bash for Windows: `NODE_ENV=test npx tsx server/scripts/migrate.ts`)

- [ ] **Step 9: Commit**

```bash
git add server/db/migrations/
git commit -m "feat(db): add migrations for users, auth_tokens, sessions, leads"
```

---

### Task 6: Drizzle schema TypeScript

**Files:**
- Modify: `server/db/schema.ts`
- Create: `shared/types.ts`

- [ ] **Step 1: Definir schema Drizzle**

Substitua o conteúdo de `server/db/schema.ts`:

```typescript
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  date,
  integer,
  inet,
  index,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    role: text('role', { enum: ['admin', 'comercial', 'recepcao'] }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('idx_users_email').on(t.email),
  }),
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    purpose: text('purpose', { enum: ['invite', 'password_reset'] }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_auth_tokens_user').on(t.userId),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ipAddress: inet('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_sessions_user').on(t.userId),
    refreshIdx: index('idx_sessions_refresh_hash').on(t.refreshTokenHash),
  }),
);

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    vehiclePlate: text('vehicle_plate'),
    vehicleModel: text('vehicle_model'),
    lastPurchaseDate: date('last_purchase_date'),
    avgMileagePerDay: integer('avg_mileage_per_day').default(50),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    phoneIdx: index('idx_leads_phone').on(t.phone),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuthToken = typeof authTokens.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Role = 'admin' | 'comercial' | 'recepcao';
export type AuthTokenPurpose = 'invite' | 'password_reset';
```

- [ ] **Step 2: Criar `shared/types.ts` com tipos compartilhados front/back**

Crie `shared/types.ts`:

```typescript
export type Role = 'admin' | 'comercial' | 'recepcao';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface LoginResponse {
  accessToken: string;
  user: PublicUser;
}

export interface ApiError {
  error: string;
  code?: string;
}
```

- [ ] **Step 3: Verificar tipo**

```bash
npm run lint
```

Expected: passa sem erros.

- [ ] **Step 4: Commit**

```bash
git add server/db/schema.ts shared/types.ts
git commit -m "feat(db): add drizzle schema and shared types"
```

---

### Task 7: Helpers de hash e tokens (TDD)

**Files:**
- Create: `server/lib/hash.ts`
- Create: `server/lib/tokens.ts`
- Create: `server/lib/jwt.ts`
- Create: `server/tests/setup.ts`
- Create: `server/tests/helpers.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Criar `vitest.config.ts`**

Crie `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./server/tests/setup.ts'],
    include: ['server/tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});
```

- [ ] **Step 2: Criar `server/tests/setup.ts`**

Crie `server/tests/setup.ts`:

```typescript
import 'dotenv/config';
import { beforeEach, afterAll } from 'vitest';
import { pool } from '../db/client';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL not set');
}
process.env.NODE_ENV = 'test';

beforeEach(async () => {
  // Limpa tabelas em cada teste para isolamento.
  await pool.query(
    'TRUNCATE leads, sessions, auth_tokens, users RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await pool.end();
});
```

- [ ] **Step 3: Escrever testes de hash (FAILING)**

Crie `server/tests/lib-hash.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, sha256 } from '../lib/hash';

describe('hash', () => {
  it('hashes and verifies a password with argon2', async () => {
    const hash = await hashPassword('hunter2');
    expect(hash).not.toBe('hunter2');
    expect(hash.length).toBeGreaterThan(20);
    expect(await verifyPassword('hunter2', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces stable SHA-256 hex digest', () => {
    const a = sha256('abc');
    expect(a).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abc')).toBe(a);
    expect(sha256('different')).not.toBe(a);
  });
});
```

- [ ] **Step 4: Rodar e verificar que falha**

```bash
npm run test -- lib-hash
```

Expected: FAIL — `Cannot find module '../lib/hash'`.

- [ ] **Step 5: Implementar `server/lib/hash.ts`**

Crie `server/lib/hash.ts`:

```typescript
import argon2 from 'argon2';
import { createHash } from 'crypto';

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
```

- [ ] **Step 6: Rodar e verificar que passa**

```bash
npm run test -- lib-hash
```

Expected: 2 passing.

- [ ] **Step 7: Escrever testes para JWT (FAILING)**

Crie `server/tests/lib-jwt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../lib/jwt';

describe('jwt', () => {
  it('signs and verifies an access token', () => {
    const token = signAccessToken({ userId: '11111111-1111-1111-1111-111111111111', role: 'admin' });
    const payload = verifyAccessToken(token);
    expect(payload.userId).toBe('11111111-1111-1111-1111-111111111111');
    expect(payload.role).toBe('admin');
  });

  it('rejects an invalid token', () => {
    expect(() => verifyAccessToken('garbage')).toThrow();
  });
});
```

- [ ] **Step 8: Rodar e verificar que falha**

```bash
npm run test -- lib-jwt
```

Expected: FAIL — `Cannot find module '../lib/jwt'`.

- [ ] **Step 9: Implementar `server/lib/jwt.ts`**

Crie `server/lib/jwt.ts`:

```typescript
import jwt from 'jsonwebtoken';
import type { Role } from '@shared/types';

const SECRET = process.env.JWT_SECRET!;
const TTL = process.env.JWT_ACCESS_TTL || '15m';

if (!SECRET) {
  throw new Error('JWT_SECRET not set');
}

export interface AccessTokenPayload {
  userId: string;
  role: Role;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: TTL } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, SECRET) as AccessTokenPayload & { iat?: number; exp?: number };
  return { userId: decoded.userId, role: decoded.role };
}
```

- [ ] **Step 10: Rodar e verificar que passa**

```bash
npm run test -- lib-jwt
```

Expected: 2 passing.

- [ ] **Step 11: Escrever testes para tokens (FAILING)**

Crie `server/tests/lib-tokens.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateRawToken, hashToken, isExpired } from '../lib/tokens';

describe('tokens', () => {
  it('generates a 64-char hex random token', () => {
    const t = generateRawToken();
    expect(t).toMatch(/^[a-f0-9]{64}$/);
    expect(generateRawToken()).not.toBe(t); // entropy
  });

  it('hashes deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('def'));
  });

  it('isExpired returns true for past dates', () => {
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000))).toBe(false);
  });
});
```

- [ ] **Step 12: Rodar e verificar que falha**

```bash
npm run test -- lib-tokens
```

Expected: FAIL.

- [ ] **Step 13: Implementar `server/lib/tokens.ts`**

Crie `server/lib/tokens.ts`:

```typescript
import { randomBytes } from 'crypto';
import { sha256 } from './hash';

export function generateRawToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(raw: string): string {
  return sha256(raw);
}

export function isExpired(date: Date): boolean {
  return date.getTime() <= Date.now();
}
```

- [ ] **Step 14: Rodar e verificar que passa**

```bash
npm run test
```

Expected: todos os testes passando (3 suítes, ~7 testes).

- [ ] **Step 15: Commit**

```bash
git add vitest.config.ts server/tests/ server/lib/
git commit -m "feat(server): add hash, jwt, tokens helpers with tests"
```

---

### Task 8: Mailer com nodemailer

**Files:**
- Create: `server/lib/mailer.ts`

- [ ] **Step 1: Criar `server/lib/mailer.ts`**

Crie `server/lib/mailer.ts`:

```typescript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 2525),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = process.env.SMTP_FROM || 'LubriConnect <no-reply@lubritec.local>';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

export async function sendInviteEmail(to: string, name: string, tokenId: string, rawToken: string) {
  const url = `${APP_URL}/auth/setup?id=${tokenId}&token=${rawToken}`;
  await transporter.sendMail({
    from: FROM,
    to,
    subject: 'Configure seu acesso ao LubriConnect',
    text: `Olá ${name},\n\nVocê foi convidado para o LubriConnect. Configure sua senha em:\n\n${url}\n\nO link expira em 7 dias.`,
    html: `<p>Olá <strong>${name}</strong>,</p><p>Você foi convidado para o LubriConnect.</p><p><a href="${url}">Configurar minha senha</a></p><p style="color:#666">O link expira em 7 dias.</p>`,
  });
}

export async function sendResetEmail(to: string, name: string, tokenId: string, rawToken: string) {
  const url = `${APP_URL}/auth/reset?id=${tokenId}&token=${rawToken}`;
  await transporter.sendMail({
    from: FROM,
    to,
    subject: 'Redefina sua senha — LubriConnect',
    text: `Olá ${name},\n\nVocê pediu redefinição de senha. Acesse:\n\n${url}\n\nO link expira em 1 hora. Se não foi você, ignore.`,
    html: `<p>Olá <strong>${name}</strong>,</p><p>Você pediu redefinição de senha.</p><p><a href="${url}">Redefinir senha</a></p><p style="color:#666">O link expira em 1 hora. Se não foi você, ignore este e-mail.</p>`,
  });
}
```

- [ ] **Step 2: Verificar tipos**

```bash
npm run lint
```

Expected: passa.

- [ ] **Step 3: Commit**

```bash
git add server/lib/mailer.ts
git commit -m "feat(server): add nodemailer with invite/reset templates"
```

---

### Task 9: Middlewares (authGuard, requireRole, errorHandler, rateLimit)

**Files:**
- Create: `server/middleware/authGuard.ts`
- Create: `server/middleware/requireRole.ts`
- Create: `server/middleware/errorHandler.ts`
- Create: `server/middleware/rateLimit.ts`

- [ ] **Step 1: Criar `server/middleware/authGuard.ts`**

Crie `server/middleware/authGuard.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt';
import type { Role } from '@shared/types';

declare global {
  namespace Express {
    interface Request {
      user?: { userId: string; role: Role };
    }
  }
}

export function authGuard(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing access token' });
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
```

- [ ] **Step 2: Criar `server/middleware/requireRole.ts`**

Crie `server/middleware/requireRole.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@shared/types';

export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
```

- [ ] **Step 3: Criar `server/middleware/errorHandler.ts`**

Crie `server/middleware/errorHandler.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation error', issues: err.issues });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}
```

- [ ] **Step 4: Criar `server/middleware/rateLimit.ts`**

Crie `server/middleware/rateLimit.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(opts: { windowMs: number; max: number; keyFn?: (req: Request) => string }) {
  const keyFn = opts.keyFn ?? ((req: Request) => req.ip || 'unknown');
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.path}:${keyFn(req)}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    if (bucket.count >= opts.max) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    bucket.count++;
    next();
  };
}
```

- [ ] **Step 5: Verificar tipos**

```bash
npm run lint
```

Expected: passa.

- [ ] **Step 6: Commit**

```bash
git add server/middleware/
git commit -m "feat(server): add auth/role/error/ratelimit middleware"
```

---

### Task 10: Auth service (login, refresh, logout) com testes

**Files:**
- Create: `server/services/authService.ts`
- Create: `server/tests/helpers.ts`
- Create: `server/tests/auth-service.test.ts`

- [ ] **Step 1: Criar helpers de teste**

Crie `server/tests/helpers.ts`:

```typescript
import { db } from '../db/client';
import { users } from '../db/schema';
import { hashPassword } from '../lib/hash';
import type { Role } from '@shared/types';

export async function createUser(opts: {
  email?: string;
  name?: string;
  password?: string;
  role?: Role;
  isActive?: boolean;
}) {
  const passwordHash = opts.password ? await hashPassword(opts.password) : null;
  const [u] = await db
    .insert(users)
    .values({
      email: opts.email ?? `user-${Date.now()}@test.com`,
      name: opts.name ?? 'Test User',
      role: opts.role ?? 'comercial',
      isActive: opts.isActive ?? true,
      passwordHash,
    })
    .returning();
  return u;
}
```

- [ ] **Step 2: Escrever testes do authService (FAILING)**

Crie `server/tests/auth-service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { login, refreshAccess, logout } from '../services/authService';
import { createUser } from './helpers';
import { db } from '../db/client';
import { sessions } from '../db/schema';
import { eq } from 'drizzle-orm';

describe('authService.login', () => {
  it('returns access token and user when credentials are valid', async () => {
    await createUser({ email: 'a@b.com', password: 'pw12345', role: 'admin' });
    const result = await login({ email: 'a@b.com', password: 'pw12345', userAgent: 'jest', ip: '127.0.0.1' });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.user.email).toBe('a@b.com');
    expect(result.user.role).toBe('admin');
  });

  it('throws on wrong password', async () => {
    await createUser({ email: 'a@b.com', password: 'pw12345' });
    await expect(login({ email: 'a@b.com', password: 'wrong', userAgent: '', ip: '' })).rejects.toThrow();
  });

  it('throws on inactive user', async () => {
    await createUser({ email: 'a@b.com', password: 'pw12345', isActive: false });
    await expect(login({ email: 'a@b.com', password: 'pw12345', userAgent: '', ip: '' })).rejects.toThrow();
  });

  it('throws on missing user', async () => {
    await expect(login({ email: 'nope@b.com', password: 'pw12345', userAgent: '', ip: '' })).rejects.toThrow();
  });

  it('throws if password not yet set (invite pending)', async () => {
    await createUser({ email: 'a@b.com' }); // no password
    await expect(login({ email: 'a@b.com', password: 'pw12345', userAgent: '', ip: '' })).rejects.toThrow();
  });
});

describe('authService.refreshAccess', () => {
  it('returns new access token for valid refresh', async () => {
    const user = await createUser({ email: 'a@b.com', password: 'pw' });
    const { refreshToken } = await login({ email: 'a@b.com', password: 'pw', userAgent: '', ip: '' });
    const result = await refreshAccess(refreshToken);
    expect(result.accessToken).toBeTruthy();
    expect(result.user.id).toBe(user.id);
  });

  it('throws if refresh is revoked', async () => {
    await createUser({ email: 'a@b.com', password: 'pw' });
    const { refreshToken } = await login({ email: 'a@b.com', password: 'pw', userAgent: '', ip: '' });
    await logout(refreshToken);
    await expect(refreshAccess(refreshToken)).rejects.toThrow();
  });

  it('throws if refresh is bogus', async () => {
    await expect(refreshAccess('bogus')).rejects.toThrow();
  });
});

describe('authService.logout', () => {
  it('marks session as revoked', async () => {
    const user = await createUser({ email: 'a@b.com', password: 'pw' });
    const { refreshToken } = await login({ email: 'a@b.com', password: 'pw', userAgent: '', ip: '' });
    await logout(refreshToken);
    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows[0]?.revokedAt).not.toBeNull();
  });
});
```

- [ ] **Step 3: Rodar e verificar que falha**

```bash
npm run test -- auth-service
```

Expected: FAIL — `Cannot find module '../services/authService'`.

- [ ] **Step 4: Implementar `server/services/authService.ts`**

Crie `server/services/authService.ts`:

```typescript
import { db } from '../db/client';
import { users, sessions } from '../db/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { verifyPassword } from '../lib/hash';
import { signAccessToken } from '../lib/jwt';
import { generateRawToken, hashToken, isExpired } from '../lib/tokens';
import { HttpError } from '../middleware/errorHandler';
import type { PublicUser } from '@shared/types';

const REFRESH_TTL_DAYS = Number(process.env.JWT_REFRESH_TTL_DAYS || 30);

function toPublic(u: typeof users.$inferSelect): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

export async function login(input: {
  email: string;
  password: string;
  userAgent: string;
  ip: string;
}) {
  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (!user || !user.isActive || !user.passwordHash) {
    throw new HttpError(401, 'Invalid credentials');
  }
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    throw new HttpError(401, 'Invalid credentials');
  }

  const refreshToken = generateRawToken();
  const refreshHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    userId: user.id,
    refreshTokenHash: refreshHash,
    userAgent: input.userAgent,
    ipAddress: input.ip || null,
    expiresAt,
  });

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const accessToken = signAccessToken({ userId: user.id, role: user.role });
  return { accessToken, refreshToken, user: toPublic(user) };
}

export async function refreshAccess(rawRefresh: string) {
  const hash = hashToken(rawRefresh);
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.refreshTokenHash, hash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!session) {
    throw new HttpError(401, 'Invalid refresh token');
  }
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || !user.isActive) {
    throw new HttpError(401, 'User no longer valid');
  }
  const accessToken = signAccessToken({ userId: user.id, role: user.role });
  return { accessToken, user: toPublic(user) };
}

export async function logout(rawRefresh: string) {
  const hash = hashToken(rawRefresh);
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.refreshTokenHash, hash));
}

export async function getMe(userId: string): Promise<PublicUser> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new HttpError(404, 'User not found');
  return toPublic(user);
}
```

- [ ] **Step 5: Rodar e verificar que passa**

```bash
npm run test -- auth-service
```

Expected: 9 passing.

- [ ] **Step 6: Commit**

```bash
git add server/services/authService.ts server/tests/helpers.ts server/tests/auth-service.test.ts
git commit -m "feat(server): add authService with login/refresh/logout (TDD)"
```

---

### Task 11: Auth service (invite, setup-password, request-reset, reset-password)

**Files:**
- Modify: `server/services/authService.ts`
- Create: `server/services/usersService.ts`
- Create: `server/tests/users-service.test.ts`

- [ ] **Step 1: Escrever testes para invite/setup/reset (FAILING)**

Crie `server/tests/users-service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { inviteUser } from '../services/usersService';
import { setupPassword, requestReset, resetPassword, login } from '../services/authService';
import { createUser } from './helpers';
import { db } from '../db/client';
import { authTokens, users } from '../db/schema';
import { eq } from 'drizzle-orm';

describe('usersService.inviteUser', () => {
  it('creates user without password and returns invite token', async () => {
    const result = await inviteUser({ email: 'novo@b.com', name: 'Novo', role: 'comercial' });
    expect(result.tokenId).toBeTruthy();
    expect(result.rawToken).toMatch(/^[a-f0-9]{64}$/);
    const [u] = await db.select().from(users).where(eq(users.email, 'novo@b.com'));
    expect(u.passwordHash).toBeNull();
    expect(u.role).toBe('comercial');
  });

  it('rejects duplicate email', async () => {
    await createUser({ email: 'dup@b.com' });
    await expect(inviteUser({ email: 'dup@b.com', name: 'X', role: 'comercial' })).rejects.toThrow();
  });
});

describe('authService.setupPassword', () => {
  it('sets password using valid invite token and logs user in', async () => {
    const inv = await inviteUser({ email: 'novo@b.com', name: 'Novo', role: 'comercial' });
    const result = await setupPassword({
      tokenId: inv.tokenId,
      rawToken: inv.rawToken,
      password: 'newpass123',
      userAgent: '',
      ip: '',
    });
    expect(result.accessToken).toBeTruthy();
    expect(result.user.email).toBe('novo@b.com');

    // Pode logar com a senha nova
    const lr = await login({ email: 'novo@b.com', password: 'newpass123', userAgent: '', ip: '' });
    expect(lr.accessToken).toBeTruthy();
  });

  it('rejects already-used token', async () => {
    const inv = await inviteUser({ email: 'novo@b.com', name: 'Novo', role: 'comercial' });
    await setupPassword({ tokenId: inv.tokenId, rawToken: inv.rawToken, password: 'pw1234567', userAgent: '', ip: '' });
    await expect(
      setupPassword({ tokenId: inv.tokenId, rawToken: inv.rawToken, password: 'pw1234567', userAgent: '', ip: '' }),
    ).rejects.toThrow();
  });

  it('rejects wrong token', async () => {
    const inv = await inviteUser({ email: 'novo@b.com', name: 'Novo', role: 'comercial' });
    await expect(
      setupPassword({ tokenId: inv.tokenId, rawToken: 'wrong'.padEnd(64, '0'), password: 'pw1234567', userAgent: '', ip: '' }),
    ).rejects.toThrow();
  });
});

describe('authService.requestReset + resetPassword', () => {
  it('issues a reset token and allows password change', async () => {
    await createUser({ email: 'a@b.com', password: 'oldpass' });
    const reset = await requestReset('a@b.com');
    expect(reset).not.toBeNull();
    const result = await resetPassword({
      tokenId: reset!.tokenId,
      rawToken: reset!.rawToken,
      password: 'newpass1',
      userAgent: '',
      ip: '',
    });
    expect(result.accessToken).toBeTruthy();
    // Login com nova senha funciona
    const lr = await login({ email: 'a@b.com', password: 'newpass1', userAgent: '', ip: '' });
    expect(lr.accessToken).toBeTruthy();
  });

  it('returns null when email does not exist (no leak)', async () => {
    const r = await requestReset('nope@b.com');
    expect(r).toBeNull();
  });

  it('rejects expired reset token', async () => {
    const user = await createUser({ email: 'a@b.com', password: 'pw' });
    const reset = await requestReset('a@b.com');
    // Forca expiracao
    await db.update(authTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authTokens.userId, user.id));
    await expect(
      resetPassword({ tokenId: reset!.tokenId, rawToken: reset!.rawToken, password: 'pw9', userAgent: '', ip: '' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
npm run test -- users-service
```

Expected: FAIL — `Cannot find module '../services/usersService'`.

- [ ] **Step 3: Criar `server/services/usersService.ts`**

Crie `server/services/usersService.ts`:

```typescript
import { db } from '../db/client';
import { users, authTokens } from '../db/schema';
import { eq } from 'drizzle-orm';
import { generateRawToken, hashToken } from '../lib/tokens';
import { HttpError } from '../middleware/errorHandler';
import type { Role } from '@shared/types';

const INVITE_TTL_DAYS = Number(process.env.INVITE_TTL_DAYS || 7);

export async function inviteUser(input: { email: string; name: string; role: Role }) {
  const [existing] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (existing) {
    throw new HttpError(409, 'Email already in use');
  }
  const [user] = await db
    .insert(users)
    .values({
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash: null,
    })
    .returning();

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [t] = await db
    .insert(authTokens)
    .values({
      userId: user.id,
      tokenHash,
      purpose: 'invite',
      expiresAt,
    })
    .returning();

  return { tokenId: t.id, rawToken, user };
}
```

- [ ] **Step 4: Estender `server/services/authService.ts` com setupPassword/requestReset/resetPassword**

Adicione no final de `server/services/authService.ts`:

```typescript
import { authTokens } from '../db/schema';
import { hashPassword } from '../lib/hash';

const RESET_TTL_HOURS = Number(process.env.RESET_TTL_HOURS || 1);

async function consumeToken(tokenId: string, rawToken: string, expectedPurpose: 'invite' | 'password_reset') {
  const [t] = await db.select().from(authTokens).where(eq(authTokens.id, tokenId)).limit(1);
  if (!t || t.purpose !== expectedPurpose) {
    throw new HttpError(400, 'Invalid token');
  }
  if (t.usedAt) throw new HttpError(400, 'Token already used');
  if (isExpired(t.expiresAt)) throw new HttpError(400, 'Token expired');
  if (hashToken(rawToken) !== t.tokenHash) throw new HttpError(400, 'Invalid token');
  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, tokenId));
  return t.userId;
}

export async function setupPassword(input: {
  tokenId: string;
  rawToken: string;
  password: string;
  userAgent: string;
  ip: string;
}) {
  const userId = await consumeToken(input.tokenId, input.rawToken, 'invite');
  const passwordHash = await hashPassword(input.password);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return doLoginForUser(user, input.userAgent, input.ip);
}

export async function requestReset(email: string): Promise<{ tokenId: string; rawToken: string; userName: string } | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.isActive) return null;
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000);
  const [t] = await db
    .insert(authTokens)
    .values({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      purpose: 'password_reset',
      expiresAt,
    })
    .returning();
  return { tokenId: t.id, rawToken, userName: user.name };
}

export async function resetPassword(input: {
  tokenId: string;
  rawToken: string;
  password: string;
  userAgent: string;
  ip: string;
}) {
  const userId = await consumeToken(input.tokenId, input.rawToken, 'password_reset');
  const passwordHash = await hashPassword(input.password);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  // Revoga sessions antigas
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return doLoginForUser(user, input.userAgent, input.ip);
}

async function doLoginForUser(user: typeof users.$inferSelect, userAgent: string, ip: string) {
  const refreshToken = generateRawToken();
  const refreshHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({
    userId: user.id,
    refreshTokenHash: refreshHash,
    userAgent,
    ipAddress: ip || null,
    expiresAt,
  });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const accessToken = signAccessToken({ userId: user.id, role: user.role });
  return { accessToken, refreshToken, user: toPublic(user) };
}
```

- [ ] **Step 5: Rodar e verificar que passa**

```bash
npm run test
```

Expected: todos os testes passando (~16 testes).

- [ ] **Step 6: Commit**

```bash
git add server/services/usersService.ts server/services/authService.ts server/tests/users-service.test.ts
git commit -m "feat(server): add invite/setup/reset password services (TDD)"
```

---

### Task 12: Controllers e routes de auth + users

**Files:**
- Create: `server/controllers/authController.ts`
- Create: `server/controllers/usersController.ts`
- Create: `server/routes/auth.ts`
- Create: `server/routes/users.ts`

- [ ] **Step 1: Criar `server/controllers/authController.ts`**

Crie `server/controllers/authController.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  login,
  refreshAccess,
  logout,
  getMe,
  setupPassword,
  requestReset,
  resetPassword,
} from '../services/authService';
import { sendResetEmail } from '../lib/mailer';

const REFRESH_COOKIE = 'lubritec_refresh';
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: Number(process.env.JWT_REFRESH_TTL_DAYS || 30) * 24 * 60 * 60 * 1000,
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = loginSchema.parse(req.body);
    const result = await login({
      email: body.email,
      password: body.password,
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip || '',
    });
    res.cookie(REFRESH_COOKIE, result.refreshToken, REFRESH_COOKIE_OPTS);
    res.json({ accessToken: result.accessToken, user: result.user });
  } catch (e) {
    next(e);
  }
}

export async function refreshHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) return res.status(401).json({ error: 'No refresh cookie' });
    const result = await refreshAccess(refreshToken);
    res.json({ accessToken: result.accessToken, user: result.user });
  } catch (e) {
    next(e);
  }
}

export async function logoutHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (refreshToken) await logout(refreshToken);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

export async function meHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const me = await getMe(req.user!.userId);
    res.json(me);
  } catch (e) {
    next(e);
  }
}

const setupSchema = z.object({
  tokenId: z.string().uuid(),
  rawToken: z.string().min(1),
  password: z.string().min(8),
});

export async function setupPasswordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = setupSchema.parse(req.body);
    const result = await setupPassword({
      ...body,
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip || '',
    });
    res.cookie(REFRESH_COOKIE, result.refreshToken, REFRESH_COOKIE_OPTS);
    res.json({ accessToken: result.accessToken, user: result.user });
  } catch (e) {
    next(e);
  }
}

const requestResetSchema = z.object({ email: z.string().email() });

export async function requestResetHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = requestResetSchema.parse(req.body);
    const result = await requestReset(body.email);
    if (result) {
      await sendResetEmail(body.email, result.userName, result.tokenId, result.rawToken);
    }
    res.json({ ok: true }); // sempre 200
  } catch (e) {
    next(e);
  }
}

const resetSchema = z.object({
  tokenId: z.string().uuid(),
  rawToken: z.string().min(1),
  password: z.string().min(8),
});

export async function resetPasswordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = resetSchema.parse(req.body);
    const result = await resetPassword({
      ...body,
      userAgent: req.headers['user-agent'] || '',
      ip: req.ip || '',
    });
    res.cookie(REFRESH_COOKIE, result.refreshToken, REFRESH_COOKIE_OPTS);
    res.json({ accessToken: result.accessToken, user: result.user });
  } catch (e) {
    next(e);
  }
}
```

- [ ] **Step 2: Criar `server/controllers/usersController.ts`**

Crie `server/controllers/usersController.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { inviteUser } from '../services/usersService';
import { sendInviteEmail } from '../lib/mailer';

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'comercial', 'recepcao']),
});

export async function inviteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = inviteSchema.parse(req.body);
    const result = await inviteUser(body);
    await sendInviteEmail(body.email, body.name, result.tokenId, result.rawToken);
    res.status(201).json({
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role,
    });
  } catch (e) {
    next(e);
  }
}
```

- [ ] **Step 3: Criar `server/routes/auth.ts`**

Crie `server/routes/auth.ts`:

```typescript
import { Router } from 'express';
import {
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  setupPasswordHandler,
  requestResetHandler,
  resetPasswordHandler,
} from '../controllers/authController';
import { authGuard } from '../middleware/authGuard';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

router.post('/login', rateLimit({ windowMs: 60_000, max: 5 }), loginHandler);
router.post('/refresh', refreshHandler);
router.post('/logout', logoutHandler);
router.get('/me', authGuard, meHandler);

router.post('/setup-password', setupPasswordHandler);
router.post(
  '/request-reset',
  rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    keyFn: (req) => req.body?.email || req.ip || 'anon',
  }),
  requestResetHandler,
);
router.post('/reset-password', resetPasswordHandler);

export default router;
```

- [ ] **Step 4: Criar `server/routes/users.ts`**

Crie `server/routes/users.ts`:

```typescript
import { Router } from 'express';
import { inviteHandler } from '../controllers/usersController';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';

const router = Router();

router.post('/', authGuard, requireRole('admin'), inviteHandler);

export default router;
```

- [ ] **Step 5: Verificar tipos**

```bash
npm run lint
```

Expected: passa.

- [ ] **Step 6: Commit**

```bash
git add server/controllers/ server/routes/
git commit -m "feat(server): add auth and users HTTP routes/controllers"
```

---

### Task 13: Express bootstrap e integration tests

**Files:**
- Create: `server/index.ts`
- Create: `server/app.ts`
- Create: `server/tests/auth.test.ts`

- [ ] **Step 1: Criar `server/app.ts` (factory para testes)**

Crie `server/app.ts`:

```typescript
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({ origin: process.env.APP_URL, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 2: Criar `server/index.ts`**

Crie `server/index.ts`:

```typescript
import 'dotenv/config';
import { createApp } from './app';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function start() {
  const app = createApp();
  const PORT = Number(process.env.PORT || 3000);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
      root: path.resolve(__dirname, '..'),
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, '../dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, '../dist/index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`LubriConnect server on http://localhost:${PORT}`);
  });
}

start();
```

- [ ] **Step 3: Escrever integration tests para fluxo completo (FAILING)**

Crie `server/tests/auth.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser } from './helpers';

const app = createApp();

describe('POST /api/auth/login', () => {
  it('returns access token and sets refresh cookie on valid credentials', async () => {
    await createUser({ email: 'a@b.com', password: 'pw12345' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'pw12345' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBe('a@b.com');
    expect(res.headers['set-cookie']?.[0]).toMatch(/lubritec_refresh=/);
  });

  it('returns 401 on invalid credentials', async () => {
    await createUser({ email: 'a@b.com', password: 'pw12345' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('returns 400 on validation error', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/refresh', () => {
  it('returns new access token using cookie', async () => {
    await createUser({ email: 'a@b.com', password: 'pw' });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'a@b.com', password: 'pw' });
    const res = await agent.post('/api/auth/refresh');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('returns 401 without cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns current user with valid bearer', async () => {
    await createUser({ email: 'a@b.com', password: 'pw' });
    const login = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'pw' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('a@b.com');
  });

  it('returns 401 without bearer', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/users (invite)', () => {
  it('admin can invite a new user', async () => {
    await createUser({ email: 'admin@b.com', password: 'pw', role: 'admin' });
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@b.com', password: 'pw' });
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ email: 'novo@b.com', name: 'Novo', role: 'comercial' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('novo@b.com');
  });

  it('non-admin gets 403', async () => {
    await createUser({ email: 'com@b.com', password: 'pw', role: 'comercial' });
    const login = await request(app).post('/api/auth/login').send({ email: 'com@b.com', password: 'pw' });
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ email: 'x@b.com', name: 'X', role: 'comercial' });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 4: Mockar mailer para testes**

Antes do test rodar, precisamos garantir que `nodemailer` não tente enviar e-mail real. Crie `server/tests/__mocks__/mailer.ts` ou ajuste setup para usar variáveis fake. Adicione no topo de `server/tests/setup.ts`:

```typescript
// Bloqueia envio real de e-mail nos testes
import { vi } from 'vitest';
vi.mock('../lib/mailer', () => ({
  sendInviteEmail: vi.fn(async () => {}),
  sendResetEmail: vi.fn(async () => {}),
}));
```

- [ ] **Step 5: Rodar e verificar que passa**

```bash
npm run test
```

Expected: ~25 testes passando.

- [ ] **Step 6: Commit**

```bash
git add server/index.ts server/app.ts server/tests/auth.test.ts server/tests/setup.ts
git commit -m "feat(server): wire express app + integration tests"
```

---

### Task 14: Seed script (admin inicial)

**Files:**
- Create: `server/scripts/seed.ts`

- [ ] **Step 1: Criar `server/scripts/seed.ts`**

Crie `server/scripts/seed.ts`:

```typescript
import 'dotenv/config';
import readline from 'readline';
import { db, pool } from '../db/client';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../lib/hash';

const ADMIN_EMAIL = 'fernando@agenciaimperium.com.br';
const ADMIN_NAME = 'Fernando (Admin)';

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (a) => { rl.close(); resolve(a); }));
}

async function run() {
  const [existing] = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  if (existing) {
    console.log(`Admin '${ADMIN_EMAIL}' já existe. Nada a fazer.`);
    await pool.end();
    return;
  }

  const password = (await ask(`Defina senha temporária para o admin '${ADMIN_EMAIL}': `)).trim();
  if (password.length < 8) {
    console.error('Senha precisa ter ao menos 8 caracteres.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  await db.insert(users).values({
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    role: 'admin',
    passwordHash,
  });
  console.log(`✓ Admin criado. Faça login em ${process.env.APP_URL}/login`);
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Rodar seed (dev)**

```bash
npm run seed
```

Quando perguntar a senha, digite uma de pelo menos 8 caracteres (ex: `temp1234`).

Expected:
```
Defina senha temporária para o admin 'fernando@agenciaimperium.com.br': ********
✓ Admin criado. Faça login em http://localhost:5173/login
```

- [ ] **Step 3: Verificar admin no banco**

```bash
docker exec -it lubritec-pg psql -U lubritec -d lubritec -c "SELECT email, role, is_active FROM users;"
```

Expected: 1 linha com `fernando@agenciaimperium.com.br | admin | t`.

- [ ] **Step 4: Commit**

```bash
git add server/scripts/seed.ts
git commit -m "feat(server): add seed script for initial admin"
```

---

### Task 15: Import legacy customers

**Files:**
- Create: `server/scripts/import-legacy-customers.ts`

- [ ] **Step 1: Criar script de import**

Crie `server/scripts/import-legacy-customers.ts`:

```typescript
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';
import { db, pool } from '../db/client';
import { leads } from '../db/schema';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SQLITE_PATH = path.resolve(__dirname, '../..', 'lubritec.db');

interface LegacyCustomer {
  id: number;
  name: string;
  phone: string;
  last_purchase_date: string | null;
  vehicle_plate: string | null;
  vehicle_model: string | null;
  avg_mileage_per_day: number | null;
}

async function run() {
  if (!existsSync(SQLITE_PATH)) {
    console.log(`Nenhum arquivo SQLite em ${SQLITE_PATH} — nada a importar.`);
    await pool.end();
    return;
  }

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const rows = sqlite.prepare('SELECT * FROM customers').all() as LegacyCustomer[];
  console.log(`Encontrados ${rows.length} customers no SQLite.`);

  let inserted = 0;
  let skipped = 0;
  let rejected = 0;

  for (const r of rows) {
    if (!r.name?.trim() || !r.phone?.trim()) {
      console.warn(`✗ Linha rejeitada (name/phone vazio): id=${r.id}`);
      rejected++;
      continue;
    }
    const phone = r.phone.replace(/\D/g, ''); // só dígitos
    if (!phone) {
      rejected++;
      continue;
    }
    const [existing] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1);
    if (existing) {
      skipped++;
      continue;
    }
    await db.insert(leads).values({
      name: r.name.trim(),
      phone,
      vehiclePlate: r.vehicle_plate?.trim() || null,
      vehicleModel: r.vehicle_model?.trim() || null,
      lastPurchaseDate: r.last_purchase_date || null,
      avgMileagePerDay: r.avg_mileage_per_day ?? 50,
    });
    inserted++;
  }

  console.log(`✓ Inseridos: ${inserted}, ignorados (já existiam): ${skipped}, rejeitados: ${rejected}.`);
  sqlite.close();
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Rodar import**

```bash
npm run import:legacy
```

Expected (caso `lubritec.db` exista): mostra contagem de inseridos/ignorados/rejeitados. Caso não exista: mensagem informativa.

- [ ] **Step 3: Verificar inserção**

```bash
docker exec -it lubritec-pg psql -U lubritec -d lubritec -c "SELECT COUNT(*) FROM leads;"
```

Expected: contagem batendo com o que foi reportado.

- [ ] **Step 4: Commit**

```bash
git add server/scripts/import-legacy-customers.ts
git commit -m "feat(server): import legacy customers from sqlite to leads"
```

---

### Task 16: Subir backend e testar manualmente

**Files:** (nenhum — só execução)

- [ ] **Step 1: Subir o servidor**

```bash
npm run dev
```

Expected: `LubriConnect server on http://localhost:3000`. Pode dar erro porque `index.html` ainda usa o `App.tsx` antigo — tudo bem, vamos consertar isso nas Tasks 17-23.

Pare o servidor (Ctrl+C) por enquanto se quiser focar no frontend.

- [ ] **Step 2: Testar endpoint de health via curl**

(Em outro terminal, com o `npm run dev` rodando.)

```bash
curl http://localhost:3000/api/health
```

Expected: `{"ok":true}`.

- [ ] **Step 3: Testar login do admin**

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"fernando@agenciaimperium.com.br","password":"temp1234"}'
```

Expected: `{"accessToken":"eyJ...","user":{...}}`.

- [ ] **Step 4: Sem commit** (nada mudou).

---

### Task 17: Frontend tokens e globals.css

**Files:**
- Create: `src/styles/globals.css`
- Modify: `src/main.tsx`
- Delete: `src/index.css` (na Task 25)
- Modify: `index.html`

- [ ] **Step 1: Criar `src/styles/globals.css`**

Crie `src/styles/globals.css`:

```css
@import 'tailwindcss';

@theme {
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 4%;

    --card: 0 0% 100%;
    --card-foreground: 0 0% 4%;

    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 4%;

    --primary: 213 51% 25%;             /* Lubritec blue #1e3a5f */
    --primary-foreground: 0 0% 100%;

    --secondary: 210 17% 95%;
    --secondary-foreground: 213 51% 25%;

    --muted: 0 0% 96%;
    --muted-foreground: 0 0% 45%;

    --accent: 210 33% 95%;              /* azul muito claro */
    --accent-foreground: 213 51% 25%;

    --destructive: 0 72% 51%;           /* Lubritec red #dc2626 */
    --destructive-foreground: 0 0% 100%;

    --success: 142 76% 36%;
    --warning: 38 92% 50%;

    --border: 0 0% 90%;
    --input: 0 0% 90%;
    --ring: 213 51% 25%;

    --radius: 0.5rem;
  }

  .dark {
    --background: 0 0% 4%;
    --foreground: 0 0% 98%;

    --card: 0 0% 7%;
    --card-foreground: 0 0% 98%;

    --popover: 0 0% 7%;
    --popover-foreground: 0 0% 98%;

    --primary: 213 51% 60%;
    --primary-foreground: 0 0% 4%;

    --secondary: 0 0% 15%;
    --secondary-foreground: 0 0% 98%;

    --muted: 0 0% 15%;
    --muted-foreground: 0 0% 65%;

    --accent: 0 0% 15%;
    --accent-foreground: 0 0% 98%;

    --destructive: 0 63% 50%;
    --destructive-foreground: 0 0% 98%;

    --success: 142 71% 45%;
    --warning: 38 92% 50%;

    --border: 0 0% 18%;
    --input: 0 0% 18%;
    --ring: 213 51% 60%;
  }

  * {
    border-color: hsl(var(--border));
  }
  body {
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }
}
```

- [ ] **Step 2: Atualizar `index.html` para puxar Inter do Google Fonts**

Edite `index.html`, no `<head>` adicione:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet" />
```

- [ ] **Step 3: Atualizar `src/main.tsx` para usar globals.css**

Substitua `src/main.tsx` por:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

(O `App` ainda não existe. Vamos criar nas próximas tasks. Ignore o erro de TS por enquanto.)

- [ ] **Step 4: Commit (parcial — sem rodar lint que vai falhar)**

```bash
git add src/styles/globals.css src/main.tsx index.html
git commit -m "feat(ui): add design tokens, fonts, switch main.tsx to new app"
```

---

### Task 18: shadcn/ui components core

**Files:** (gerados pelo CLI)
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/label.tsx`
- Create: `src/components/ui/card.tsx`
- Create: `src/components/ui/form.tsx`
- Create: `src/components/ui/dropdown-menu.tsx`
- Create: `src/components/ui/avatar.tsx`
- Create: `src/components/ui/sonner.tsx`
- Create: `src/components/ui/skeleton.tsx`
- Create: `src/components/ui/dialog.tsx`

- [ ] **Step 1: Adicionar componentes shadcn**

```bash
npx shadcn@latest add button input label card form dropdown-menu avatar sonner skeleton dialog
```

Aceite "Yes" para sobrescrever `lib/utils.ts` se perguntar. Os componentes vão aparecer em `src/components/ui/`.

- [ ] **Step 2: Verificar que `src/lib/utils.ts` tem o `cn()` helper**

Conteúdo esperado de `src/lib/utils.ts`:

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/ src/lib/utils.ts components.json
git commit -m "feat(ui): add shadcn components (button, input, form, dialog, etc.)"
```

---

### Task 19: API client + auth store + auth API hooks

**Files:**
- Create: `src/lib/apiClient.ts`
- Create: `src/features/auth/store.ts`
- Create: `src/features/auth/api.ts`
- Create: `src/hooks/useAuth.ts`

- [ ] **Step 1: Criar `src/features/auth/store.ts`**

Crie `src/features/auth/store.ts`:

```typescript
import { create } from 'zustand';
import type { PublicUser } from '@shared/types';

interface AuthState {
  user: PublicUser | null;
  accessToken: string | null;
  status: 'idle' | 'authenticating' | 'authenticated' | 'unauthenticated';
  setAuth: (user: PublicUser, accessToken: string) => void;
  setAccessToken: (token: string) => void;
  setUser: (user: PublicUser) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: 'idle',
  setAuth: (user, accessToken) => set({ user, accessToken, status: 'authenticated' }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setUser: (user) => set({ user }),
  clear: () => set({ user: null, accessToken: null, status: 'unauthenticated' }),
}));
```

- [ ] **Step 2: Criar `src/lib/apiClient.ts`**

Crie `src/lib/apiClient.ts`:

```typescript
import { useAuthStore } from '@/features/auth/store';

const BASE = '/api';

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await res.json();
      useAuthStore.getState().setAuth(data.user, data.accessToken);
      return data.accessToken as string;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const doFetch = async (token: string | null): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  };

  let token = useAuthStore.getState().accessToken;
  let res = await doFetch(token);

  if (res.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (!newToken) {
      useAuthStore.getState().clear();
      throw new ApiError(401, 'Unauthenticated');
    }
    res = await doFetch(newToken);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || 'Request failed', body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}
```

- [ ] **Step 3: Criar `src/features/auth/api.ts`**

Crie `src/features/auth/api.ts`:

```typescript
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { useAuthStore } from './store';
import type { LoginResponse, PublicUser } from '@shared/types';

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (data) => setAuth(data.user, data.accessToken),
  });
}

export function useLogout() {
  const clear = useAuthStore((s) => s.clear);
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => clear(),
  });
}

export function useMe(enabled: boolean) {
  const setUser = useAuthStore((s) => s.setUser);
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = await api<PublicUser>('/auth/me');
      setUser(me);
      return me;
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useRequestReset() {
  return useMutation({
    mutationFn: (email: string) =>
      api<void>('/auth/request-reset', { method: 'POST', body: JSON.stringify({ email }) }),
  });
}

export function useResetPassword() {
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (input: { tokenId: string; rawToken: string; password: string }) =>
      api<LoginResponse>('/auth/reset-password', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (data) => setAuth(data.user, data.accessToken),
  });
}

export function useSetupPassword() {
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (input: { tokenId: string; rawToken: string; password: string }) =>
      api<LoginResponse>('/auth/setup-password', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (data) => setAuth(data.user, data.accessToken),
  });
}
```

- [ ] **Step 4: Criar `src/hooks/useAuth.ts`** (alias semântico)

Crie `src/hooks/useAuth.ts`:

```typescript
import { useAuthStore } from '@/features/auth/store';
export const useAuth = () => useAuthStore();
```

- [ ] **Step 5: Verificar tipos**

```bash
npm run lint
```

Expected: passa (talvez alguns erros porque `app/App.tsx` ainda não existe — OK).

- [ ] **Step 6: Commit**

```bash
git add src/lib/apiClient.ts src/features/auth/ src/hooks/useAuth.ts
git commit -m "feat(ui): add api client, auth store, auth hooks"
```

---

### Task 20: ProtectedRoute, AdminRoute, e providers

**Files:**
- Create: `src/features/auth/ProtectedRoute.tsx`
- Create: `src/features/auth/AdminRoute.tsx`
- Create: `src/app/providers.tsx`

- [ ] **Step 1: Criar `src/features/auth/ProtectedRoute.tsx`**

Crie `src/features/auth/ProtectedRoute.tsx`:

```tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './store';
import { useMe } from './api';

export function ProtectedRoute() {
  const { status, accessToken } = useAuthStore();
  const location = useLocation();

  // Tenta hidratar via cookie de refresh na primeira render
  useEffect(() => {
    if (status === 'idle') {
      useAuthStore.setState({ status: 'authenticating' });
      fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) useAuthStore.getState().setAuth(data.user, data.accessToken);
          else useAuthStore.getState().clear();
        })
        .catch(() => useAuthStore.getState().clear());
    }
  }, [status]);

  // Re-fetch /me quando autenticado para garantir dados atualizados
  useMe(status === 'authenticated' && !!accessToken);

  if (status === 'idle' || status === 'authenticating') {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Carregando…</div>;
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}
```

- [ ] **Step 2: Criar `src/features/auth/AdminRoute.tsx`**

Crie `src/features/auth/AdminRoute.tsx`:

```tsx
import { Outlet } from 'react-router-dom';
import { useAuthStore } from './store';

export function AdminRoute() {
  const { user } = useAuthStore();
  if (user?.role !== 'admin') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2">
        <h1 className="text-2xl font-semibold">403 — Acesso negado</h1>
        <p className="text-muted-foreground">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }
  return <Outlet />;
}
```

- [ ] **Step 3: Criar `src/app/providers.tsx`**

Crie `src/app/providers.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import type { ReactNode } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/features/auth/ProtectedRoute.tsx src/features/auth/AdminRoute.tsx src/app/providers.tsx
git commit -m "feat(ui): add protected/admin routes and providers"
```

---

### Task 21: AppShell, Sidebar, Topbar

**Files:**
- Create: `src/components/layout/AppShell.tsx`
- Create: `src/components/layout/Sidebar.tsx`
- Create: `src/components/layout/Topbar.tsx`

- [ ] **Step 1: Criar `src/components/layout/Sidebar.tsx`**

Crie `src/components/layout/Sidebar.tsx`:

```tsx
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  Briefcase,
  Users,
  ShieldCheck,
  Settings as SettingsIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/features/auth/store';

const items = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { to: '/inside-sales', label: 'Inside Sales', icon: Briefcase },
  { to: '/cadastros', label: 'Cadastros', icon: Users },
  { to: '/admin', label: 'Admin', icon: ShieldCheck, adminOnly: true },
  { to: '/settings', label: 'Configurações', icon: SettingsIcon },
];

export function Sidebar() {
  const role = useAuthStore((s) => s.user?.role);
  const visible = items.filter((i) => !i.adminOnly || role === 'admin');

  return (
    <aside className="hidden w-60 border-r bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center px-5 font-semibold text-primary">
        LubriConnect
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {visible.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Criar `src/components/layout/Topbar.tsx`**

Crie `src/components/layout/Topbar.tsx`:

```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuthStore } from '@/features/auth/store';
import { useLogout } from '@/features/auth/api';
import { useNavigate } from 'react-router-dom';

export function Topbar() {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const navigate = useNavigate();

  const initials = user?.name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm sm:inline">{user?.name}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate('/settings')}>
            Configurações
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={async () => {
              await logout.mutateAsync();
              navigate('/login');
            }}
          >
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
```

- [ ] **Step 3: Criar `src/components/layout/AppShell.tsx`**

Crie `src/components/layout/AppShell.tsx`:

```tsx
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Topbar />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/
git commit -m "feat(ui): add AppShell with Sidebar and Topbar"
```

---

### Task 22: Páginas placeholder e auth (Login, Setup, Reset)

**Files:**
- Create: `src/pages/login/Login.tsx`
- Create: `src/pages/auth-setup/SetupPassword.tsx`
- Create: `src/pages/auth-reset/ResetPassword.tsx`
- Create: `src/pages/dashboard/DashboardPage.tsx`
- Create: `src/pages/whatsapp/WhatsappPage.tsx`
- Create: `src/pages/inside-sales/InsideSalesPage.tsx`
- Create: `src/pages/cadastros/CadastrosPage.tsx`
- Create: `src/pages/admin/AdminPage.tsx`
- Create: `src/pages/settings/SettingsPage.tsx`
- Create: `src/pages/NotFound.tsx`

- [ ] **Step 1: Criar `src/pages/login/Login.tsx`**

Crie `src/pages/login/Login.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { useLogin, useRequestReset } from '@/features/auth/api';
import { toast } from 'sonner';

const schema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});
type FormData = z.infer<typeof schema>;

export default function Login() {
  const navigate = useNavigate();
  const login = useLogin();
  const requestReset = useRequestReset();
  const [forgot, setForgot] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      await login.mutateAsync(data);
      navigate('/dashboard');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro';
      toast.error(msg === 'Invalid credentials' ? 'Credenciais inválidas' : msg);
    }
  };

  const onForgot = async (email: string) => {
    if (!email || !z.string().email().safeParse(email).success) {
      toast.error('Informe um e-mail válido');
      return;
    }
    await requestReset.mutateAsync(email);
    toast.success('Se o e-mail existir, enviamos um link de redefinição.');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-primary">LubriConnect</h1>
          <p className="text-sm text-muted-foreground">Entre com seu e-mail e senha.</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
        {!forgot ? (
          <button
            onClick={() => setForgot(true)}
            className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Esqueci minha senha
          </button>
        ) : (
          <ForgotForm onSubmit={onForgot} pending={requestReset.isPending} />
        )}
      </Card>
    </div>
  );
}

function ForgotForm({ onSubmit, pending }: { onSubmit: (email: string) => void; pending: boolean }) {
  const [email, setEmail] = useState('');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(email); }}
      className="mt-4 space-y-2 border-t pt-4"
    >
      <Label htmlFor="forgot-email" className="text-xs">Digite seu e-mail</Label>
      <Input
        id="forgot-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button type="submit" variant="outline" className="w-full" disabled={pending}>
        {pending ? 'Enviando…' : 'Enviar link de redefinição'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Criar `src/pages/auth-setup/SetupPassword.tsx`**

Crie `src/pages/auth-setup/SetupPassword.tsx`:

```tsx
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { useSetupPassword } from '@/features/auth/api';
import { toast } from 'sonner';

const schema = z
  .object({
    password: z.string().min(8, 'Senha precisa ter pelo menos 8 caracteres'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Senhas não conferem' });
type FormData = z.infer<typeof schema>;

export default function SetupPassword() {
  const [params] = useSearchParams();
  const id = params.get('id') || '';
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const mutation = useSetupPassword();

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      await mutation.mutateAsync({ tokenId: id, rawToken: token, password: data.password });
      toast.success('Senha definida! Bem-vindo.');
      navigate('/dashboard');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao definir senha');
    }
  };

  if (!id || !token) {
    return <div className="p-6">Link inválido.</div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-xl font-semibold text-primary">Configure sua senha</h1>
        <p className="mb-4 text-sm text-muted-foreground">Defina a senha para acessar o LubriConnect.</p>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Nova senha</Label>
            <Input id="password" type="password" {...register('password')} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirmar senha</Label>
            <Input id="confirm" type="password" {...register('confirm')} />
            {errors.confirm && <p className="text-xs text-destructive">{errors.confirm.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando…' : 'Definir senha'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Criar `src/pages/auth-reset/ResetPassword.tsx`**

Crie `src/pages/auth-reset/ResetPassword.tsx`:

```tsx
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { useResetPassword } from '@/features/auth/api';
import { toast } from 'sonner';

const schema = z
  .object({
    password: z.string().min(8, 'Senha precisa ter pelo menos 8 caracteres'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Senhas não conferem' });
type FormData = z.infer<typeof schema>;

export default function ResetPassword() {
  const [params] = useSearchParams();
  const id = params.get('id') || '';
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const mutation = useResetPassword();

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      await mutation.mutateAsync({ tokenId: id, rawToken: token, password: data.password });
      toast.success('Senha redefinida.');
      navigate('/dashboard');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    }
  };

  if (!id || !token) return <div className="p-6">Link inválido.</div>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-xl font-semibold text-primary">Redefinir senha</h1>
        <p className="mb-4 text-sm text-muted-foreground">Escolha uma nova senha de acesso.</p>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Nova senha</Label>
            <Input id="password" type="password" {...register('password')} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirmar senha</Label>
            <Input id="confirm" type="password" {...register('confirm')} />
            {errors.confirm && <p className="text-xs text-destructive">{errors.confirm.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando…' : 'Redefinir'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Criar páginas placeholder dos 5 módulos**

Para cada um dos arquivos abaixo, use o template:

`src/pages/dashboard/DashboardPage.tsx`:
```tsx
import { Placeholder } from '@/components/layout/Placeholder';
export default function DashboardPage() {
  return <Placeholder title="Dashboard de Funil" description="Métricas de qualificação. Em breve." />;
}
```

`src/pages/whatsapp/WhatsappPage.tsx`:
```tsx
import { Placeholder } from '@/components/layout/Placeholder';
export default function WhatsappPage() {
  return <Placeholder title="WhatsApp" description="Conversas com filas Comercial / Recepção / IA. Em breve." />;
}
```

`src/pages/inside-sales/InsideSalesPage.tsx`:
```tsx
import { Placeholder } from '@/components/layout/Placeholder';
export default function InsideSalesPage() {
  return <Placeholder title="Inside Sales" description="CRM de leads em pipeline. Em breve." />;
}
```

`src/pages/cadastros/CadastrosPage.tsx`:
```tsx
import { Placeholder } from '@/components/layout/Placeholder';
export default function CadastrosPage() {
  return <Placeholder title="Cadastros" description="Cadastro manual e importação em lote de leads. Em breve." />;
}
```

`src/pages/admin/AdminPage.tsx`:
```tsx
import { Placeholder } from '@/components/layout/Placeholder';
export default function AdminPage() {
  return <Placeholder title="Admin" description="Gestão de usuários e permissões. Em breve." />;
}
```

`src/pages/settings/SettingsPage.tsx`:
```tsx
import { Placeholder } from '@/components/layout/Placeholder';
export default function SettingsPage() {
  return <Placeholder title="Configurações" description="Preferências do usuário. Em breve." />;
}
```

`src/pages/NotFound.tsx`:
```tsx
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2">
      <h1 className="text-2xl font-semibold">404 — Página não encontrada</h1>
    </div>
  );
}
```

- [ ] **Step 5: Criar `src/components/layout/Placeholder.tsx`**

Crie `src/components/layout/Placeholder.tsx`:

```tsx
export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/ src/components/layout/Placeholder.tsx
git commit -m "feat(ui): add login/setup/reset pages and module placeholders"
```

---

### Task 23: Router e App.tsx novo

**Files:**
- Create: `src/app/App.tsx`
- Create: `src/app/routes.tsx`

- [ ] **Step 1: Criar `src/app/routes.tsx`**

Crie `src/app/routes.tsx`:

```tsx
import { Navigate, type RouteObject } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { AdminRoute } from '@/features/auth/AdminRoute';
import { AppShell } from '@/components/layout/AppShell';

const Login = lazy(() => import('@/pages/login/Login'));
const SetupPassword = lazy(() => import('@/pages/auth-setup/SetupPassword'));
const ResetPassword = lazy(() => import('@/pages/auth-reset/ResetPassword'));
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));
const WhatsappPage = lazy(() => import('@/pages/whatsapp/WhatsappPage'));
const InsideSalesPage = lazy(() => import('@/pages/inside-sales/InsideSalesPage'));
const CadastrosPage = lazy(() => import('@/pages/cadastros/CadastrosPage'));
const AdminPage = lazy(() => import('@/pages/admin/AdminPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const NotFound = lazy(() => import('@/pages/NotFound'));

const Loader = () => <div className="p-6 text-muted-foreground">Carregando…</div>;
const wrap = (el: JSX.Element) => <Suspense fallback={<Loader />}>{el}</Suspense>;

export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  { path: '/login', element: wrap(<Login />) },
  { path: '/auth/setup', element: wrap(<SetupPassword />) },
  { path: '/auth/reset', element: wrap(<ResetPassword />) },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/dashboard', element: wrap(<DashboardPage />) },
          { path: '/whatsapp', element: wrap(<WhatsappPage />) },
          { path: '/inside-sales', element: wrap(<InsideSalesPage />) },
          { path: '/cadastros', element: wrap(<CadastrosPage />) },
          { path: '/settings', element: wrap(<SettingsPage />) },
          {
            element: <AdminRoute />,
            children: [{ path: '/admin', element: wrap(<AdminPage />) }],
          },
        ],
      },
    ],
  },
  { path: '*', element: wrap(<NotFound />) },
];
```

- [ ] **Step 2: Criar `src/app/App.tsx`**

Crie `src/app/App.tsx`:

```tsx
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { AppProviders } from './providers';
import { routes } from './routes';

const router = createBrowserRouter(routes);

export default function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
```

- [ ] **Step 3: Verificar tipos**

```bash
npm run lint
```

Expected: passa.

- [ ] **Step 4: Subir o servidor e testar manualmente**

```bash
npm run dev
```

Abra `http://localhost:3000` no browser:

- [ ] É redirecionado para `/login`
- [ ] Login com email do admin e senha do seed funciona
- [ ] Após login, é redirecionado para `/dashboard`
- [ ] Sidebar mostra os 5 módulos + Settings; Admin aparece (porque é admin)
- [ ] Navegar entre placeholders funciona
- [ ] Logout pelo dropdown funciona, volta pra `/login`
- [ ] `/admin` é acessível como admin

Pare o servidor.

- [ ] **Step 5: Commit**

```bash
git add src/app/
git commit -m "feat(ui): wire router with protected/admin guards"
```

---

### Task 24: Cutover — apagar código antigo

**Files:**
- Delete: `src/App.tsx`
- Delete: `src/index.css`
- Delete: `server.ts`
- Delete: `lubritec.db`

- [ ] **Step 1: Verificar que nada importa o `App.tsx` antigo**

```bash
grep -r "from './App'" src/ || echo "OK"
grep -r "from '@/App'" src/ || echo "OK"
```

Expected: `OK` (sem matches).

- [ ] **Step 2: Apagar arquivos antigos**

```bash
rm src/App.tsx
rm src/index.css
rm server.ts
rm lubritec.db
rm metadata.json
```

- [ ] **Step 3: Subir o servidor e validar tudo de novo**

```bash
npm run dev
```

Faça novamente o checklist da Task 23 Step 4.

Em outro terminal:

```bash
npm run test
```

Expected: testes passam.

```bash
npm run lint
```

Expected: passa.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove legacy App.tsx, server.ts, sqlite db"
```

---

### Task 25: README final + critério de pronto

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Substituir `README.md` pelo conteúdo final**

Substitua `README.md`:

````markdown
# LubriConnect

SaaS de qualificação de leads e atendimento WhatsApp da Lubritec.

## Stack
- React 19 + Vite + Tailwind + shadcn/ui (frontend)
- Express + TypeScript (backend)
- PostgreSQL 16 + Drizzle ORM (banco)
- argon2 + JWT + magic link (auth)
- TanStack Query, Zustand, React Hook Form, Zod (frontend state/forms)
- Vitest + Supertest (testes)

## Pré-requisitos
- Node 20+
- Docker (para Postgres local)

## Setup

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Edite .env e gere um JWT_SECRET:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. Subir Postgres local
npm run db:up

# 4. Criar database de teste (apenas na 1a vez)
docker exec -it lubritec-pg psql -U lubritec -c "CREATE DATABASE lubritec_test;"

# 5. Rodar migrations (dev e teste)
npm run migrate
NODE_ENV=test npm run migrate

# 6. Criar admin inicial (vai pedir senha temporária)
npm run seed

# 7. (Opcional) Importar customers do SQLite legado
# Coloque lubritec.db na raiz do projeto antes de rodar:
npm run import:legacy

# 8. Subir o servidor
npm run dev
```

Acesse http://localhost:3000 e faça login com `fernando@agenciaimperium.com.br` + a senha definida no seed.

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Sobe servidor (Express + Vite middleware) em http://localhost:3000 |
| `npm run build` | Build de produção |
| `npm run lint` | Type-check de frontend e backend |
| `npm run test` | Roda testes (vitest) |
| `npm run test:watch` | Testes em modo watch |
| `npm run migrate` | Aplica migrations pendentes |
| `npm run seed` | Cria admin inicial |
| `npm run import:legacy` | Importa `customers` do `lubritec.db` antigo para `leads` |
| `npm run db:up` | Sobe Postgres via docker-compose |
| `npm run db:down` | Para o Postgres |

## Estrutura

Veja `docs/superpowers/specs/2026-04-29-fundacao-design.md`.

## Próximos sub-projetos
1. Admin/RBAC — gestão de usuários e permissões
2. Cadastros — leads completos + import CSV
3. Inside Sales — pipeline kanban / CRM
4. WhatsApp + Filas — atendimento multi-fila
5. Dashboard de Funil — métricas e conversão
````

- [ ] **Step 2: Validar fluxo completo da Fundação (critério de pronto do spec §9)**

Execute na ordem e marque cada um:

- [ ] `docker-compose up -d` sobe Postgres → ✓
- [ ] `npm run migrate` aplica migrations 001–005 → ✓
- [ ] `npm run seed` cria admin → ✓
- [ ] `npm run dev` sobe front + back → ✓
- [ ] Login com email + senha funciona → ✓
- [ ] "Esqueci minha senha" envia e-mail (Mailtrap) e fluxo de reset funciona → ✓ (testar com email configurado)
- [ ] Convite POST /api/users autenticado como admin envia e-mail e fluxo de setup-password funciona → ✓ (testar com curl + Mailtrap)
- [ ] Sidebar mostra os 5 módulos (Admin só pra admin) → ✓
- [ ] Navegação entre placeholders funciona → ✓
- [ ] Logout revoga sessão; refresh transparente; refresh inválido redireciona /login → ✓
- [ ] /admin acessado por non-admin retorna 403 → ✓ (criar user comercial via curl, logar, tentar acessar /admin)
- [ ] Dark mode toggle (deixado para módulo Settings; tokens já prontos) → adiado para Settings
- [ ] README permite que outro dev suba do zero → ✓ (release checklist)

- [ ] **Step 3: Commit final**

```bash
git add README.md
git commit -m "docs: final readme with setup instructions"
```

- [ ] **Step 4: Verificação final**

```bash
git log --oneline | head -30
```

Expected: ~25 commits, um por task.

```bash
npm run test
npm run lint
```

Expected: tudo verde.

---

## Self-Review

✓ **Spec coverage:**
- §2 Escopo (incluído/não incluído) → coberto pelas tasks 1–25; o que não está incluído explicitamente não foi implementado.
- §3 Decisões de arquitetura → todas refletidas nas tasks (Postgres T3+T4+T5; Drizzle T6; auth+argon2+JWT T7+T10; Vite+shadcn T2+T17+T18; etc.).
- §4 Estrutura de pastas → criada nas tasks 4, 9, 10, 12, 13, 19, 20, 21, 22, 23.
- §5 Schema → migrations T5, drizzle T6.
- §6 Fluxo auth (6.1–6.6) → services T10+T11, controllers T12, integration tests T13.
- §7 Frontend (7.1 router, 7.2 layout, 7.3 tokens, 7.4 estado, 7.5 shadcn) → T17, T18, T19, T20, T21, T22, T23.
- §8 Plano de migração (passos 1-7) → mapeado direto em T1-T16, T17-T23, T24, T25.
- §9 Critério de pronto → T25 step 2 valida cada item.
- §10 Riscos → README documenta SMTP via env (mitigação 1); script de import loga rejeitados (mitigação 2); .gitignore criado primeiro (mitigação 3).

✓ **Placeholder scan:** sem TBDs/TODOs.

✓ **Type consistency:** Role = `'admin'|'comercial'|'recepcao'` consistente em schema + shared/types + middleware. PublicUser idem. authTokens.purpose = `'invite'|'password_reset'` consistente.

✓ **Frequent commits:** cada task termina em commit; ~25 commits no total.

---
