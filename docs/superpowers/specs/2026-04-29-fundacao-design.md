# Fundação LubriConnect — Design Spec

**Data:** 2026-04-29
**Autor:** Fernando (Orion Digital) + brainstorm com Claude
**Sub-projeto:** Fundação (1 de 6)
**Próximos sub-projetos:** Admin/RBAC → Cadastros → Inside Sales → WhatsApp+Filas → Dashboard de Funil

---

## 1. Contexto

LubriConnect é um SaaS desenvolvido pela Orion Digital para a **Lubritec** (rede de troca de óleo / lubrificantes). A versão atual entrega um módulo simples de campanhas WhatsApp em massa, com:

- `App.tsx` monolítico (1158 linhas)
- Backend Express + SQLite
- Auth fake (`admin@lubritec.com` / `admin123` hardcoded)
- 3 tabelas: `templates`, `campaigns`, `customers`

A nova fase do produto exige expandir para **5 módulos novos** (Dashboard de Funil, WhatsApp com filas, Inside Sales/CRM, Cadastros, Admin/RBAC). Como a base atual não suporta múltiplos usuários, RBAC, real-time ou crescimento de schema, este sub-projeto reescreve a **fundação** para tornar viáveis todos os módulos seguintes.

## 2. Escopo

### Inclui
- Reestruturação do projeto em camadas (frontend e backend)
- Migração de SQLite → Postgres com sistema de migrations versionadas
- Schema base: `users`, `auth_tokens`, `sessions`, `leads` (mínima)
- Auth real: login com email + senha, convite via link, reset via link
- Design system base (shadcn/ui + tokens Lubritec)
- Shell da aplicação (sidebar, topbar, rotas) com placeholders dos 5 módulos
- Importação dos `customers` legados para `leads`
- Documentação dev (README com como rodar)

### Não inclui (ficam para sub-projetos futuros)
- Lógica de qualquer dos 5 módulos (são especificados em seus próprios specs)
- Sistema de permissões granulares (vai no módulo Admin/RBAC; aqui usamos apenas o enum `role`)
- WebSocket / real-time (vai no módulo WhatsApp+Filas)
- Deploy de produção / CI/CD

## 3. Decisões de arquitetura

| Decisão | Escolha |
|---|---|
| Banco | PostgreSQL (self-hosted) |
| ORM | Drizzle ORM |
| Migrations | SQL puro versionado em `server/db/migrations/` + runner próprio |
| Auth | Email + senha (argon2) como primário; magic link via `auth_tokens` para convite e reset |
| Multi-tenant | Não. Single-tenant (apenas Lubritec) |
| Framework | Vite + React 19 + Express (refactor interno, não migra para Next.js) |
| UI | shadcn/ui (Radix + Tailwind) |
| Server state | TanStack Query |
| Client state | Zustand |
| Forms | React Hook Form + Zod |
| Routing | React Router v6 |
| Branding | Base neutra moderna + Lubritec blue (#1e3a5f) como `--primary` |
| IDs | UUID (`gen_random_uuid()`) |
| Tokens | JWT access (15 min) em memória; refresh em httpOnly cookie (30 dias) |
| E-mail | nodemailer com SMTP via `.env` (Mailtrap em dev) |

## 4. Estrutura de pastas

```
lubritec-main/
├── docker-compose.yml        # Postgres local
├── .env.example
├── package.json
├── drizzle.config.ts
├── docs/
│   └── superpowers/specs/
├── shared/                   # tipos compartilhados front/back
│   └── types.ts
├── server/                   # Backend
│   ├── index.ts              # entry point Express
│   ├── routes/               # auth.ts, users.ts, ...
│   ├── controllers/
│   ├── services/             # regras de negócio
│   ├── middleware/           # authGuard, errorHandler
│   ├── db/
│   │   ├── client.ts         # pool pg + drizzle
│   │   ├── schema.ts         # tabelas Drizzle
│   │   └── migrations/       # 001_init.sql, 002_*.sql, ...
│   ├── lib/                  # mailer, jwt, hash, tokens
│   └── scripts/              # migrate.ts, seed.ts, import-legacy-customers.ts
└── src/                      # Frontend
    ├── app/                  # bootstrap, router, providers
    │   ├── App.tsx           # router + QueryClient + Theme
    │   ├── routes.tsx
    │   └── providers.tsx
    ├── pages/                # 1 arquivo por rota (placeholders na Fundação)
    │   ├── login/
    │   ├── auth-setup/
    │   ├── auth-reset/
    │   ├── dashboard/
    │   ├── whatsapp/
    │   ├── inside-sales/
    │   ├── cadastros/
    │   ├── admin/
    │   └── settings/
    ├── features/             # lógica por módulo
    │   └── auth/
    │       ├── store.ts      # Zustand auth store
    │       ├── api.ts        # endpoints de auth (TanStack Query)
    │       └── ProtectedRoute.tsx
    ├── components/
    │   ├── ui/               # shadcn primitives
    │   └── layout/           # AppShell, Sidebar, Topbar
    ├── lib/                  # apiClient, utils
    ├── hooks/                # useAuth, useToast
    └── styles/               # globals.css, tokens
```

**Princípio:** cada `features/<modulo>/` é auto-contido. Isso evita o problema atual de uma única pasta com tudo dentro.

## 5. Schema do banco (Fundação)

### 5.1 `users`
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT,                  -- nullable: null até usuário definir senha
  role TEXT NOT NULL,                  -- 'admin' | 'comercial' | 'recepcao'
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_email ON users(email);
```

### 5.2 `auth_tokens`
Serve dois propósitos: convite de novo usuário e reset de senha.
```sql
CREATE TABLE auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,            -- só guardamos hash, não o raw
  purpose TEXT NOT NULL,               -- 'invite' | 'password_reset'
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id);
```

### 5.3 `sessions`
Refresh tokens revogáveis.
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
```

### 5.4 `leads`
Migração mínima dos `customers` legados. Campos de funil/CRM (status, etapa, owner, fonte) serão acrescentados via ALTER no módulo Cadastros — não tem retrabalho.
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

## 6. Fluxo de autenticação

### 6.1 Login com senha (caso normal)
```
1. /login → user digita email + senha → POST /api/auth/login
2. Backend:
   - Busca user por email
   - Verifica is_active
   - argon2.verify(password, user.password_hash)
   - Gera access JWT (15 min, payload: { user_id, role })
   - Gera refresh token random (32 bytes), salva hash em sessions, expira em 30 dias
   - Atualiza last_login_at
   - Retorna { accessToken, user } no body + refresh token em httpOnly cookie
3. Frontend guarda accessToken em Zustand (memória), redireciona para /dashboard
```

### 6.2 Convite (admin cria usuário)
```
1. Admin no painel → "Convidar usuário" → POST /api/users { email, name, role }
2. Backend:
   - Cria user com password_hash = NULL
   - Gera token, salva auth_tokens com purpose='invite', expires_at = now() + 7 dias
   - Envia email: "Configure sua conta: <APP_URL>/auth/setup?id=...&token=..."
3. User clica → /auth/setup → tela "Defina sua senha"
4. POST /api/auth/setup-password { id, token, password }
5. Backend:
   - Verifica token (purpose=invite, não expirou, não usado)
   - argon2.hash(password) → salva em users.password_hash
   - Marca auth_tokens.used_at
   - Faz login automático (mesma resposta do login normal)
```

### 6.3 Reset de senha (esqueci)
```
1. /login → "Esqueci minha senha" → POST /api/auth/request-reset { email }
2. Backend:
   - Se user existe e is_active: gera token, salva auth_tokens com purpose='password_reset', expires_at = now() + 1h
   - Sempre retorna 200 (mesmo se email não existe — não vaza info)
   - Envia email com link para /auth/reset?id=...&token=...
3. User abre link → tela "Defina nova senha"
4. POST /api/auth/reset-password { id, token, password }
5. Backend:
   - Verifica token (purpose=password_reset, válido, não usado)
   - Atualiza password_hash, marca used_at
   - Revoga todas as sessions existentes do user (revoked_at = now)
   - Login automático
```

### 6.4 Refresh
```
Frontend faz request → 401 → API client tenta POST /api/auth/refresh (cookie vai automaticamente)
Backend verifica refresh_token_hash em sessions, gera novo access JWT, retorna
Se falhar → frontend zera Zustand, redireciona /login
```

### 6.5 Logout
```
POST /api/auth/logout → marca sessions.revoked_at = now() para o refresh atual
Frontend zera Zustand, limpa cookie, redireciona /login
```

### 6.6 Segurança
- Senha hasheada com **argon2id** (parâmetros default da lib `argon2`)
- Tokens (auth_tokens, refresh) só armazenados como hash SHA-256
- Refresh em httpOnly cookie, Secure (em prod), SameSite=Lax
- Access JWT só em memória (Zustand) — nunca em localStorage
- Rate limit em `/api/auth/login` (5/min por IP) e `/api/auth/request-reset` (5/hora por email)
- TTLs curtos: access 15 min, invite 7 dias, reset 1h, refresh 30 dias

## 7. Frontend foundation

### 7.1 Roteamento
```
/                          → redirect (logado: /dashboard, deslogado: /login)
/login                     → público
/auth/setup?token=...      → público (tem token na URL)
/auth/reset?token=...      → público
/dashboard                 → placeholder (Dashboard de Funil)
/whatsapp                  → placeholder (WhatsApp+Filas)
/inside-sales              → placeholder (Inside Sales/CRM)
/cadastros                 → placeholder (Cadastros)
/admin                     → placeholder (RESTRITO a role=admin)
/settings                  → placeholder
*                          → 404
```

`<ProtectedRoute>` envolve as rotas autenticadas. `<AdminRoute>` adicionalmente verifica `role === 'admin'`.

### 7.2 Layout (`<AppShell>`)
- **Topbar:** logo Lubritec à esquerda, avatar/menu do usuário à direita (logout, settings)
- **Sidebar:** navegação dos 5 módulos + settings; colapsável; mobile vira drawer
- **Conteúdo:** `<Outlet />` da rota
- Item "Admin" só renderiza se `role === 'admin'`

### 7.3 Design tokens
```css
/* CSS variables em src/styles/globals.css */
:root {
  --background: #ffffff;
  --foreground: #0a0a0a;
  --muted: #f5f5f5;
  --muted-foreground: #737373;
  --border: #e5e5e5;
  --input: #e5e5e5;
  --ring: #1e3a5f;

  --primary: #1e3a5f;          /* Lubritec blue */
  --primary-foreground: #ffffff;

  --accent: #f0f4f8;
  --accent-foreground: #1e3a5f;

  --destructive: #dc2626;       /* Lubritec red — só erro/delete */
  --destructive-foreground: #ffffff;

  --success: #16a34a;
  --warning: #f59e0b;

  --radius: 0.5rem;
}
.dark { /* paleta dark equivalente */ }
```
Tipografia: Inter (sans), JetBrains Mono (mono).

### 7.4 Estado e dados
- **Zustand store `useAuthStore`:** `{ user, accessToken, login, logout, setAccessToken }`
- **TanStack Query:** todas as chamadas de API. QueryKey por feature: `['leads']`, `['users']`, etc. `staleTime` default 30s.
- **API client (`src/lib/api.ts`):** wrapper de fetch que (a) injeta `Authorization: Bearer ...`, (b) intercepta 401 e tenta refresh, (c) re-tenta a request original, (d) se refresh falhar, redireciona para /login.

### 7.5 Componentes shadcn/ui instalados na Fundação
Button, Input, Label, Form, Card, Dialog, DropdownMenu, Avatar, Sonner (toast), Skeleton. Outros componentes (Table, Tabs, Select, Command, etc.) vão sendo adicionados pelos módulos seguintes — shadcn é copy-paste, não há dependência runtime.

## 8. Plano de migração

Ordem linear. Cada passo só começa quando o anterior fecha.

1. **Setup de ambiente**
   - `git init` no projeto + `.gitignore`
   - Instalar deps: `pg`, `drizzle-orm`, `drizzle-kit`, `argon2`, `jsonwebtoken`, `cookie-parser`, `nodemailer`, `react-router-dom`, `@tanstack/react-query`, `zustand`, `react-hook-form`, `zod`, `@hookform/resolvers`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` (já existe)
   - shadcn/ui CLI (`npx shadcn@latest init`)
   - `docker-compose.yml` com Postgres 16
   - `.env.example` (DATABASE_URL, JWT_SECRET, SMTP_*, APP_URL)

2. **Backend novo, em paralelo ao antigo**
   - Criar `server/` completo
   - Migrations 001 (extensions: pgcrypto), 002 (users), 003 (auth_tokens), 004 (sessions), 005 (leads)
   - Drizzle schema em `server/db/schema.ts`
   - Endpoints de auth: `/api/auth/login`, `/request-reset`, `/reset-password`, `/setup-password`, `/refresh`, `/logout`, `/me`
   - Endpoint mínimo de users: `POST /api/users` (admin only) — o resto vem no módulo Admin
   - Middleware `authGuard` (verifica JWT, popula `req.user`)
   - Middleware `requireRole('admin')`
   - `server.ts` antigo continua rodando para não quebrar nada

3. **Importação dos customers legados**
   - `server/scripts/import-legacy-customers.ts`: lê `lubritec.db` SQLite → escreve em `leads` Postgres
   - Roda 1 vez. Idempotente (verifica por phone antes de inserir).

4. **Frontend: shell e auth**
   - `src/app/`, `<AppShell>`, `<Sidebar>`, `<Topbar>`
   - Páginas: `<Login>`, `<SetupPassword>`, `<ResetPassword>`
   - `useAuthStore`, `apiClient`, `<ProtectedRoute>`, `<AdminRoute>`
   - Theme provider (light/dark toggle)

5. **Páginas placeholder dos 5 módulos**
   - Cada uma é `<div>{nome do módulo} — em breve</div>` dentro do `<AppShell>`
   - Sidebar com navegação real entre rotas

6. **Cutover**
   - Deletar `App.tsx` antigo, `server.ts` antigo, `lubritec.db` (após confirmar import)
   - Renomear/mover arquivos novos para os locais finais
   - `npm run dev` deve subir tudo da estrutura nova

7. **Documentação**
   - `README.md`: pré-requisitos (Docker, Node 20+), `docker-compose up`, `npm run migrate`, `npm run seed`, `npm run dev`, fluxo de login para teste
   - `.env.example` documentado

### O que será deletado
- `src/App.tsx` (1158 linhas)
- `server.ts` (192 linhas)
- `lubritec.db` (após confirmação do import)
- Endpoints antigos: `/api/templates`, `/api/campaigns`, `/api/stats`, `/api/upload-customers` — modelo de "campanhas em massa" não é parte do produto novo

### O que será mantido
- Logo, paleta Lubritec
- Dados de `customers` (importados como `leads`)
- Vite + React 19 + Tailwind como base

## 9. Critério de "Fundação pronta"

- [ ] `docker-compose up -d` sobe Postgres
- [ ] `npm run migrate` aplica migrations 001–005
- [ ] `npm run seed` cria admin (`fernando@agenciaimperium.com.br`, role=admin) com senha temporária definida
- [ ] `npm run dev` sobe front + back (uma porta só, via vite middleware como hoje)
- [ ] Login com email + senha funciona
- [ ] "Esqueci minha senha" envia e-mail (Mailtrap em dev) e fluxo de reset funciona end-to-end
- [ ] Convite de novo usuário (POST /api/users autenticado como admin) gera link, fluxo de setup-password funciona
- [ ] Após login, sidebar mostra os 5 módulos (Admin só pra admin), navegação entre placeholders funciona
- [ ] Logout revoga sessão; access expirado disparou refresh transparente; refresh inválido redireciona /login
- [ ] /admin acessado por non-admin retorna 403
- [ ] Dark mode toggle funciona
- [ ] README permite que outro dev suba o projeto do zero em <10 min

## 10. Riscos e premissas

**Riscos:**
- Configurar SMTP em produção exige escolha de provedor (Resend, SES, SendGrid). Em dev usaremos Mailtrap. **Mitigação:** deixar tudo em `.env`; troca de provedor é só env.
- Migração do `lubritec.db` pode ter dados sujos (telefones em formatos diferentes, datas inválidas). **Mitigação:** script de import faz validação e loga linhas rejeitadas; admin decide o que fazer com elas.
- `git init` agora vai versionar `node_modules/`, `lubritec.db`, `.env` se o `.gitignore` não estiver pronto antes. **Mitigação:** `.gitignore` é o primeiro arquivo do passo 1.

**Premissas:**
- Postgres é viável para o ambiente final do cliente (já decidido como self-hosted; assume-se que existe uma VPS/servidor disponível).
- A Lubritec topa que `templates` e `campaigns` antigas sejam descartadas, e que o produto agora é CRM/funil/atendimento, não disparo em massa de WhatsApp.
- O dev vai rodar Docker localmente.

## 11. O que vem depois

Cada um destes vira seu próprio spec → plan → execução:

1. **Admin/RBAC** — gestão de usuários (criar/editar/desativar), papéis customizados, matriz de permissões por módulo
2. **Cadastros** — modelo completo de `leads` (status, etapa, owner, fonte, custom fields), formulário manual, importação CSV em lote, edição, exclusão
3. **Inside Sales (CRM)** — pipeline kanban, detalhe do lead com timeline, anotações, tarefas, atribuição
4. **WhatsApp + Filas** — integração WhatsApp Business API, conversas, distribuição por filas (Comercial/Recepção/IA), real-time via WebSocket, transferência entre atendentes
5. **Dashboard de Funil** — métricas de qualificação, conversão por etapa, performance por atendente/fila, ROI
