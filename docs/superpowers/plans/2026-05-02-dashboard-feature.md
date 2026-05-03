# Dashboard LubriConnect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/dashboard` page with a role-aware "Visão da operação ↔ Meu pipeline" toggle, period selector with auto-comparison, and live operational alerts. Replace the current `Placeholder`.

**Architecture:** Postgres-backed singleton table `org_settings` (monthly sales goal). Three new REST endpoints (`/api/dashboard/summary|attention|whatsapp`) backed by a new `dashboardService`. Frontend page composed of focused widgets; React Query for refetch with per-endpoint `staleTime` (60s/30s/15s).

**Tech Stack:** Express + Drizzle (Postgres) on the backend. React + TypeScript + Tailwind + React Query + Zustand on the frontend. Vitest for backend tests (real Postgres test DB, see `server/tests/setup.ts`). No frontend unit tests (project convention — UI tested manually).

**Spec:** [`docs/superpowers/specs/2026-05-02-dashboard-design.md`](../specs/2026-05-02-dashboard-design.md)

---

## Status (atualizado 2026-05-03)

| Task | Status | Commit |
|---|---|---|
| 1 | ✅ Done — SQL + Drizzle schema | `c0f9903` |
| **PREP** | ✅ Done — `shared/types.ts` (workaround pelo bloqueio de DB) | `f39bb5e` |
| 2 | ⛔ Blocked — backend `/api/org-settings` (precisa DB) | — |
| 3 | ✅ Done — Settings → Organização tab | `69e6050` + `11a9d36` (catch fix) |
| 4-9 | ⛔ Blocked — backend dashboard service/period (precisa DB) | — |
| 10 | ⛔ Blocked — controller/route/RBAC (precisa DB) | — |
| 11 | ✅ Done — API client + React Query hooks | `54beffa` |
| 12 | ✅ Done — ViewToggle / PeriodPicker / BlockSkeleton / BlockError | `fbae98e` |
| 13 | ✅ Done — KpiCard + KpiRow | `0e89425` + `c59c262` (a11y/period prop fix) |
| 14 | ✅ Done — AttentionList | `f7980fa` |
| 15 | ✅ Done — FunnelChart + PipelineOpen | `c7f0e31` |
| 16 | ✅ Done — WhatsappStats + Leaderboard + RecentActivities | `d8b8255` |
| 17 | ✅ Done — DashboardPage assembly | `c816e4b` + `7561a9e` (review fixes) |
| 18 | ⛔ Blocked — manual smoke (precisa backend rodando) | — |

**Bloqueio de DB:** O Postgres remoto da Supabase não é acessível desta máquina (timeout IPv6). Pra destravar: trocar `DATABASE_URL` pelo Connection Pooler da Supabase (porta 6543, IPv4-friendly) ou subir o `lubritec-pg` local com Docker (`docker-compose.yml` na raiz, `npm run db:up`).

---

## Phase 0 — Schema, settings tab

### Task 1: Add `org_settings` migration + Drizzle schema ✅

Files:
- `server/db/migrations/013_org_settings.sql` (singleton com `monthly_sales_goal numeric(12,2)`, segue padrão de `011_whatsapp_instance.sql`)
- `server/db/schema.ts` — adiciona `orgSettings` table + types `OrgSettings`, `NewOrgSettings`

A migração foi escrita e o schema declarado, mas `npm run migrate` não rodou (DB inacessível). Quando DB voltar: `npm run migrate` aplica e seed da única linha (`singleton=true, monthly_sales_goal=NULL`).

### PREP: Shared types ✅

Antecipado pra desbloquear frontend enquanto backend espera DB:
- `shared/types.ts` ganhou `PublicOrgSettings`, `DashboardView`, `DashboardPeriod`, `DashboardKpiNumber`, `DashboardKpis`, `DashboardGoal`, `DashboardFunnelOrg | DashboardFunnelMe` (union discriminado por `kind`), `DashboardPipelineOpen`, `DashboardLeader`, `DashboardRecentActivity`, `DashboardSummary`, `DashboardAttentionItem`, `DashboardAttentionResponse`, `DashboardWhatsappStats` (incluindo `instanceConnected: boolean`).

### Task 2: orgSettingsService + REST endpoints ⛔

Quando DB voltar, criar:
- `server/services/orgSettingsService.ts` — `getOrgSettings()`, `updateOrgSettings({ monthlySalesGoal })` operando no singleton.
- `server/controllers/orgSettingsController.ts` — Zod-validated GET/PUT.
- `server/routes/orgSettings.ts` — GET autenticado, PUT só admin.
- Mount em `server/app.ts`: `app.use('/api/org-settings', orgSettingsRoutes)`.
- Tests `server/tests/org-settings.test.ts` — service-level (defaults, update, clear, reject negative) + HTTP-level (RBAC).

### Task 3: Org tab in Settings page ✅

- `src/pages/settings/api.ts` — `getOrgSettings()` / `updateOrgSettings()` chamando `/org-settings`.
- `src/pages/settings/OrganizationTab.tsx` — formulário com input "Meta de vendas mensal", validação `>= 0`, parse comma→dot, estado loading/saving/error/saved.
- `src/pages/settings/SettingsPage.tsx` — adiciona tab "Organização" lazy-loaded ao lado de "Conexão WhatsApp".
- Catches tipados como `unknown` com guard `instanceof Error` (review fix).

---

## Phase 1 — Backend dashboard endpoints (BLOQUEADO)

### Task 4: Period helpers ⛔

`server/lib/period.ts` — `resolvePeriod(key, now?)` calcula `{ start, end, prevStart, prevEnd, label }` em `America/Sao_Paulo` para `today | 7d | month | 30d | quarter`. Comparativo do mesmo tamanho do período. Tests `server/tests/period.test.ts` cobrindo cada chave.

### Task 5: dashboardService.summary KPIs (org) ⛔

`server/services/dashboardService.ts` — função `summary({ view, period, userId, now? })`:
- `salesKpi(start, end, owner?)` — `SUM(proposalValue), COUNT(*)` em deals stage='ganho' no período.
- `lostCount(start, end, owner?)` — para win-rate.
- `proposalsCount(start, end, actor?)` — count de `deal_activities WHERE kind='created'`.
- Roda 2x (atual + anterior) e calcula `deltaPct` (% change) e `ppDiff` (para win-rate).
- Helpers: `pctChange(value, prev)` retorna 0/100/round, `ppDiff(value, prev)` round.
- Tests `server/tests/dashboard-summary-org.test.ts` — assertions sobre KPIs e deltas com fixtures de deals via `createUser/createLead/createDeal` em `helpers.ts`.

### Task 6: summary funnel + pipelineOpen + leaderboard + goal (org) ⛔

Adicionar em `dashboardService.ts`:
- `funnelOrg(start, end)` — count de leads/conversations (DISTINCT leadId)/deals criados no período + count de wons. Conversões em %.
- `pipelineOpen(owner?)` — `GROUP BY stage WHERE stage IN ('proposta_enviada','em_negociacao')`. Calcula `avgAgeDays` ponderado pelo count.
- `leaderboard(start, end)` — `JOIN users ON deals.owner_user_id`, top 5 por `wonValue` desc.
- `goal(view, periodKey, currentMonthSales)` — só retorna não-null quando `view='org' && period='month'` E há `monthlySalesGoal` cadastrado. Cap em 200%.
- Tests cobrindo cada bloco.

### Task 7: summary me view (funnel + recentActivities) ⛔

- `funnelMe(start, end, userId)` — `respondedConversations` (count distinct `conversation_id` em `messages WHERE sentByUserId=me`), `myProposals` (deals owner=me criados), `myWon` (deals owner=me ganhos no período).
- `recentActivitiesMe(userId)` — JOIN deal_activities → deals → leads, filtra `actorUserId=me`, top 10 ordem desc por `createdAt`.
- Em `summary`, branch o `funnel` por `args.view`. Para `view='me'`, `leaderboard=null` e `recentActivities` populado.
- Tests `server/tests/dashboard-summary-me.test.ts`.

### Task 8: dashboardService.attention ⛔

Função `attention({ view, userId? })` com 4 queries paralelas:
- `proposal_old` (critical) — deals stage='proposta_enviada' AND updated_at < now() - '14 days'
- `conv_expired` (critical) — conversations status != 'encerrada' AND last_inbound_at IS NOT NULL AND last_inbound_at < now() - '24 hours' AND last_message_at <= last_inbound_at
- `deal_stale` (warning) — deals stage IN ('proposta_enviada','em_negociacao') AND updated_at < now() - '5 days'
- `queue_pending` (info) — conversations queue='comercial' AND status='aguardando_atendimento'

Filtra por `assignedTo=userId` ou `ownerUserId=userId` quando `view='me'`. Retorna ordenado por severidade. Filtros pré-construídos no campo `filter` para o front montar deep-link. Tests `server/tests/dashboard-attention.test.ts` cobrindo cada kind + ordering + me filter.

### Task 9: dashboardService.whatsappStats ⛔

Função `whatsappStats()`:
- Lê `whatsapp_instance.last_status` para `instanceConnected = lastStatus === 'connected'`.
- `inQueue` — count `conversations WHERE status='aguardando_atendimento'`.
- `expired24h` — mesma lógica de `conv_expired` da attention.
- `avgFirstResponseSec` — query LATERAL: para conversas dos últimos 7d, AVG(first_outbound.sent_at - first_inbound.sent_at).
- `noResponseToday` — conversations com `last_inbound_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo')` e sem outbound depois.

Tests `server/tests/dashboard-whatsapp.test.ts` cobrindo cada métrica + estado disconnected.

### Task 10: Controller + route + RBAC ⛔

- `server/controllers/dashboardController.ts` — 3 handlers (summary, attention, whatsapp), Zod validation, RBAC inline (`view='org'` requer `req.user.role === 'admin'` ou retorna 403).
- `server/routes/dashboard.ts` — `GET /summary`, `GET /attention`, `GET /whatsapp` (esse último com `requireRole('admin')`).
- Mount: `app.use('/api/dashboard', dashboardRoutes)`.
- Tests `server/tests/dashboard-rbac.test.ts` — comercial em `view=org` → 403, admin → 200, etc.

---

## Phase 2 — Frontend foundation ✅

### Task 11: API client + React Query hooks ✅

- `src/pages/dashboard/api.ts` — `fetchSummary(view, period)`, `fetchAttention(view)`, `fetchWhatsapp()`. Paths sem prefixo `/api` (auto-prefixado pelo `apiClient`).
- `src/pages/dashboard/hooks.ts` — `useDashboardSummary` (60s + `keepPreviousData`), `useDashboardAttention` (30s), `useDashboardWhatsapp(enabled)` (15s, gated por enabled).

### Task 12: ViewToggle, PeriodPicker, BlockSkeleton, BlockError ✅

4 primitivos pequenos em `src/pages/dashboard/components/`:
- `ViewToggle.tsx` — segmented control admin (org ↔ me).
- `PeriodPicker.tsx` — dropdown com 5 opções + "vs período anterior" subtitle.
- `BlockSkeleton.tsx` — `role="status"` + `aria-label="Carregando"` (a11y fix).
- `BlockError.tsx` — fallback com `Tentar novamente`.

---

## Phase 3 — Frontend widgets ✅

### Task 13: KpiCard + KpiRow ✅

- `KpiCard.tsx` — primitivo display com props `label`, `value`, `delta?`, `goal?`, `cta?`, `empty?`, `emptyHint?`. Mutually-exclusive: goal OU cta. Progress bar com ARIA. Trend arrow (▲▼→) + cor (emerald/ruby/slate).
- `KpiRow.tsx` — composição de 4 KpiCards bound a `DashboardSummary.kpis`. Recebe prop `period: DashboardPeriod` (review fix — era string match em label antes). CTA "Definir meta →" no card Vendas quando `view='org' && period='month' && !data.goal`.

### Task 14: AttentionList ✅

- `AttentionList.tsx` — lista de até 5 itens ordenados por severidade. Records-as-config para COPY/CTA/ICON por kind, SEV_BG por severity. `buildHref(item)` monta route + querystring do filter. Empty state ✅. Footer "+ N outros alertas" quando >5.

### Task 15: FunnelChart + PipelineOpen ✅

- `FunnelChart.tsx` — barras horizontais empilhadas (CSS puro, sem chart-lib), discriminated union narrowing entre `funnel.kind === 'org'` (4 etapas) e `'me'` (3 etapas).
- `PipelineOpen.tsx` — tabela mínima de stages com BRL no valor + count. Footer com Total aberto + idade média. Empty state.

### Task 16: WhatsappStats + Leaderboard + RecentActivities ✅

- `WhatsappStats.tsx` — 2x2 grid de mini-stats. Quando `!instanceConnected`, renderiza único card com ícone `lc-ruby` + `Reconectar →` link pra `/settings?tab=whatsapp`.
- `Leaderboard.tsx` — top 5 vendedores, posição mono + nome + valor + count.
- `RecentActivities.tsx` — últimas 10 atividades minhas, com KIND_LABEL pra todos os 8 DealActivityKind. Link pro lead em `/inside-sales`.

---

## Phase 4 — Page assembly ✅

### Task 17: DashboardPage assembly ✅

`src/pages/dashboard/DashboardPage.tsx` — substitui o `<Placeholder>`:
- Header: ViewToggle (admin) ou h1 "Meu pipeline" (comercial). PeriodPicker + botão Refresh com feedback visual (`disabled + animate-spin` quando `isFetching`).
- Initial state: `view = isAdmin ? 'org' : 'me'`, `period = 'month'`.
- Hooks: `useDashboardSummary`, `useDashboardAttention`, `useDashboardWhatsapp(view === 'org')`.
- 4 sections (KPI / Atenção / Funil+Pipeline / Whatsapp+Leaderboard-or-Recents) com loading/error/data ternaries por bloco.
- `RightSection` helper extraído pra achatar a lógica do leaderboard-vs-recentActivities (review fix).
- Sem `summary.data!` non-null assertion (review fix).

### Task 18: Manual smoke + final lint ⛔

Skipped enquanto backend bloqueado. Quando voltar:
- `npm run dev` em `localhost:3000`, login admin → toggle, período, refresh, blocks navegáveis, etc.
- Login comercial → sem toggle, escopo dele, sem WhatsApp section.
- Tentar `GET /api/dashboard/summary?view=org` como comercial → 403.
- Cadastrar meta em Settings → barra aparece.
- Desconectar instância → bloco WhatsApp mostra "Reconectar →".
- DB limpo → todos blocos com mensagem própria, sem erro.

---

## Done quando

- Lint clean (`npm run lint`) ✅ atual
- Todos os testes do backend passando (`npx vitest run`) ⛔ depende de DB
- Smoke manual cobrindo os fluxos acima ⛔ depende de backend rodando
- Commits atomic por task seguindo o formato `feat(dashboard|settings|api|db|types):`

## Out of scope

- Reativação de carteira (rota própria depois)
- Metas por vendedor (só org-wide)
- Drilldown "ver todos" do ranking
- Export CSV/PDF
- WebSocket/SSE
- Mobile-first
