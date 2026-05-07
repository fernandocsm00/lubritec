# Inside Sales — Atribuição de dono e etapa "Lead no Comercial"

**Data:** 2026-05-07
**Módulo:** `src/features/inside-sales` + backend de deals

## Contexto

Hoje o Kanban de Inside Sales tem 4 etapas (`proposta_enviada`, `em_negociacao`, `ganho`, `perdido`). Todo deal novo entra em `proposta_enviada`. O filtro do board só oferece `Meus deals` / `Todos`. O drawer mostra o dono mas não permite trocar, mesmo o backend já aceitando `ownerUserId` no PATCH.

A Lubritec quer:

1. Atribuir/reatribuir o dono de um deal pela UI e filtrar o Kanban por dono.
2. Uma etapa nova de triagem antes de `proposta_enviada`, chamada **"Lead no Comercial"**, onde todo deal entra por padrão.

## Decisões aprovadas

- **Default de criação:** todo deal novo (manual e `pipelineIntegration` automático) entra em `lead_no_comercial`.
- **Permissão de atribuição:** qualquer usuário autenticado (admin, comercial, recepção) pode reatribuir o dono de qualquer deal.
- **Lista de donos atribuíveis:** apenas usuários `is_active=true` com role `admin` ou `comercial`.

## Escopo

### Backend

**Migration `024_deal_stage_lead_no_comercial.sql`**
```sql
ALTER TYPE deal_stage ADD VALUE 'lead_no_comercial' BEFORE 'proposta_enviada';
```

**`shared/types.ts`**
- `DEAL_STAGES = ['lead_no_comercial', 'proposta_enviada', 'em_negociacao', 'ganho', 'perdido'] as const`
- A ordem do array dirige a ordem das colunas no Kanban.

**`server/services/dealsService.ts`**
- `createDeal()` insere com `stage: 'lead_no_comercial'`.
- `listBoard` SQL: stages ativas passam a ser `IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')`.
- `isStaleSql`: stages ativas (que disparam o cálculo de stale) passam a incluir `lead_no_comercial`.
- Inicialização de `stages`/`totals` em `BoardResponse` ganha a chave `lead_no_comercial: []` / `{ count: 0, valueSum: 0 }`.
- `changeStage` não ganha regra nova: `lead_no_comercial` aceita entrada/saída livremente. `ganho`/`perdido` mantêm validações atuais.
- `reactivateDeal` continua voltando para `proposta_enviada` (não muda).

**`server/services/dashboardService.ts`**
- Linhas 152-153, 213-214, 221-222: incluir `lead_no_comercial` nas três queries que enumeram stages ativas (`pipelineOpen`, alerts de proposta velha, alerts de stale).

**`server/services/campaignsService.ts`**
- Linha 306: `inDeal` passa a contar `lead_no_comercial` também.

**Filtro `owner` no boardQuery e historyQuery (`dealsController.ts`)**
- Zod: `z.union([z.enum(['mine','all','unassigned']), z.string().uuid()])`.
- `listBoard`/`listHistory` em `dealsService.ts` traduzem o filtro:
  - `mine` → `eq(deals.ownerUserId, currentUserId)` (mantém comportamento atual)
  - `all` → sem filtro de dono
  - `unassigned` → `isNull(deals.ownerUserId)`
  - UUID → `eq(deals.ownerUserId, <uuid>)`

**Endpoint `GET /users/assignable`**
- `server/routes/users.ts`: rota com `authGuard` apenas (sem `requireRole('admin')`). Registrar antes de `/:id` se houver conflito.
- `server/services/usersService.ts`: nova função `listAssignableUsers()`:
  - SELECT `id, name, role` FROM users WHERE `is_active = true` AND `role IN ('admin','comercial')`.
  - ORDER BY `name ASC`.
- Resposta: `{ users: [{ id, name, role }] }` — não vaza email, last_login, has_password.

### Frontend

**`src/features/inside-sales/api.ts`**
- `BoardFilters.owner` e `HistoryFilters.owner` passam a `'mine' | 'all' | 'unassigned' | string` (string = UUID). `buildBoardQuery`/`buildHistoryQuery` continuam fazendo `u.set('owner', f.owner)` — só ajusta o tipo.
- Novo tipo `AssignableUser { id: string; name: string; role: 'admin' | 'comercial' }`.
- Novo hook `useAssignableUsers()`: `useQuery` em `/users/assignable` com `staleTime: 5 * 60_000`.

**`src/features/inside-sales/KanbanBoard.tsx`**
- Substitui o par de pílulas `Meus deals / Todos` por **um único `Select` (shadcn)** compacto à esquerda da busca:
  - Itens fixos no topo: `Meus deals` (default), `Todos`, `Sem dono`, separador.
  - Lista dinâmica via `useAssignableUsers()` ordenada por nome. Usuário atual recebe sufixo `(você)`.
- Sincroniza com `searchParams.get('owner')` (mantém deep-linking).
- Layout do grid: `grid-cols-4` → `grid-cols-5` para 5 colunas. Container das colunas ganha `overflow-x-auto` e cada coluna `min-w-[220px]` para resiliência em telas estreitas.

**`src/features/inside-sales/DealDrawer.tsx`**
- Linha estática `Dono: <nome>` vira `Select`:
  - Item explícito "Sem dono" (valor `null`).
  - Lista de `useAssignableUsers()`. Usuário atual recebe sufixo `(você)`.
- Mudança chama `usePatchDeal({ id, ownerUserId })`. Activity log já registra `owner_changed` no backend.
- `disabled` quando `readOnly` (drawer aberto pelo histórico).

**`src/features/inside-sales/helpers.ts`**
- `STAGE_LABELS.lead_no_comercial = 'Lead no Comercial'`
- `STAGE_COLORS.lead_no_comercial = 'text-muted-foreground'`

**`src/features/inside-sales/DealCard.tsx`**
- `STAGE_ACCENT.lead_no_comercial = 'var(--lc-navy-soft)'`

**`src/pages/dashboard/components/PipelineOpen.tsx`**
- Adicionar `lead_no_comercial: 'Lead no Comercial'` ao `STAGE_LABEL`.

## Compatibilidade

- A migration só adiciona valor ao enum. Deals existentes ficam intocados em `proposta_enviada` — sem backfill.
- `createDeal` é idempotente por `leadId`. Deals já existentes não são recriados; a mudança de default não retroage.
- O frontend trata o stage novo via `DEAL_STAGES` exportado do `shared/types.ts` — a ordem do array determina a ordem das colunas, então a etapa aparece automaticamente no Kanban e nos `Record<DealStage, …>`.

## Testes

- `server/tests/deals-list.test.ts` — caso de `owner=<uuid>` e `owner=unassigned`; cobertura de `lead_no_comercial` no board.
- `server/tests/deals-actions.test.ts` — `createDeal` resulta em `stage='lead_no_comercial'`; transição `lead_no_comercial → proposta_enviada` gera activity `stage_changed`.
- `server/tests/deals-rbac.test.ts` — comercial e recepção podem `GET /users/assignable`; ambos seguem bloqueados em `GET /users`.
- `server/tests/dashboard-summary-org.test.ts` e `dashboard-summary-me.test.ts` — `lead_no_comercial` aparece em `pipelineOpen.byStage`.
- Smoke manual: criar deal → entra em "Lead no Comercial"; arrastar para "Proposta enviada"; trocar dono no drawer; filtrar Kanban por outro usuário e por "Sem dono".

## Fora de escopo

- Layout do dashboard (só adiciona o label, sem mudar componentes).
- Notificação dedicada de "deal parado em Lead no Comercial" — `isStale` já cobre.
- Mudanças na tela de Histórico (só active stages têm a etapa nova).
- Permissões granulares de reatribuição (qualquer autenticado pode reatribuir, conforme decisão).
