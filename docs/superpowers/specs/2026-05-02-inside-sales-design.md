# Inside Sales — Design

**Sub-projeto 5 do roadmap.** Pipeline kanban de leads em negociação, atribuído a Comercial. Construído sobre auth/RBAC + Cadastros + WhatsApp Inbox.

## Objetivo

Dar ao time Comercial uma visão clara dos leads em **negociação ativa**: quem está em qual etapa, valor estimado, há quanto tempo parado, e por que algumas oportunidades se perdem. Inside Sales **não substitui** a base de leads (Cadastros) nem o atendimento (WhatsApp Inbox) — ele é a **camada de funil de vendas** que vive em cima.

## Decisões fixadas (brainstorming)

- **Time:** pipeline compartilhado entre Recepção (qualifica upstream — fora do pipeline) e Comercial (trabalha o pipeline).
- **4 etapas:** `proposta_enviada` → `em_negociacao` → `ganho` / `perdido`. Sem etapa de "Novo" — o lead só entra no pipeline quando há proposta.
- **Entrada no pipeline:**
  - **Manual:** botão "+ Adicionar ao pipeline" no header da `/inside-sales` e na sidebar do WhatsApp Inbox.
  - **Automática:** quando Comercial manda mensagem **outbound do tipo imagem** numa conversa da fila Comercial (foto do orçamento), lead entra em `proposta_enviada`. Idempotente — se já tem deal, no-op; se está em terminal, reativa.
- **Dono do deal:** quem mandou a proposta (auto-claim igual WhatsApp). Reatribuição manual disponível.
- **Campos extras do deal:** `proposal_value` (R$ editável) + `loss_reason` (obrigatório ao perder).
- **Motivos de perda:** `condicoes_comerciais`, `preco`, `sem_retorno`, `fora_do_perfil` (enum fixo, sem "outro").
- **Movimento:** drag & drop com `@dnd-kit`. Mover pra Perdido abre dialog de motivo. Mover pra Ganho exige `proposal_value` preenchido.
- **Detalhe:** drawer lateral com dados do lead, deal, notas, e activity log (timeline).
- **Lifecycle:** Ganho/Perdido ficam visíveis no kanban por **7 dias após `closed_at`**, depois vão pra tab "Histórico" (paginada).
- **RBAC:** apenas `admin` + `comercial` acessam `/inside-sales`. Recepção vê apenas o chip "● No pipeline" em Cadastros e na sidebar do WhatsApp.
- **Integração com WhatsApp:** chamada direta no fim do `sendMessage` (Opção 1). Erro do pipeline não derruba envio (warn + continue).

## Schema

Migration `010_pipeline.sql`:

```sql
-- Enums
CREATE TYPE deal_stage AS ENUM (
  'proposta_enviada',
  'em_negociacao',
  'ganho',
  'perdido'
);
CREATE TYPE loss_reason AS ENUM (
  'condicoes_comerciais',
  'preco',
  'sem_retorno',
  'fora_do_perfil'
);
CREATE TYPE deal_activity_kind AS ENUM (
  'created',
  'stage_changed',
  'value_changed',
  'note_added',
  'won',
  'lost',
  'reactivated',
  'owner_changed'
);

-- Deals
CREATE TABLE deals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL UNIQUE REFERENCES leads(id) ON DELETE RESTRICT,
  stage           deal_stage NOT NULL DEFAULT 'proposta_enviada',
  proposal_value  numeric(12,2),
  loss_reason     loss_reason,
  notes           text,
  owner_user_id   uuid REFERENCES users(id) ON DELETE RESTRICT,
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_deals_stage_updated ON deals(stage, updated_at DESC);
CREATE INDEX idx_deals_owner ON deals(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX idx_deals_closed_at ON deals(closed_at) WHERE closed_at IS NOT NULL;

-- Activity log
CREATE TABLE deal_activities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id        uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  kind           deal_activity_kind NOT NULL,
  actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dealact_deal_created ON deal_activities(deal_id, created_at DESC);
```

### Decisões importantes

- **`deals.lead_id UNIQUE`** → cada lead tem no máximo um deal. Reativação reusa o mesmo registro (preserva histórico).
- **`owner_user_id` ON DELETE RESTRICT** → consistente com a regra "deactivate, never delete" do resto do sistema.
- **`deal_activities.actor_user_id` ON DELETE SET NULL** → activity log preserva ações de usuários removidos (mostra "ação do sistema" ou similar quando null).
- **`closed_at`** controla o filtro dos 7 dias do kanban. Sem coluna `is_archived` — derivado.
- **`metadata jsonb`** carrega o contexto de cada activity:
  - `created`: `{ source: 'manual' | 'auto_image' }`
  - `stage_changed`: `{ from, to }`
  - `value_changed`: `{ from, to }`
  - `note_added`: `{ note }` (snapshot)
  - `lost`: `{ reason }`
  - `won`: `{ value }`
  - `reactivated`: `{ from }`
  - `owner_changed`: `{ fromUserId, toUserId }`

### Constantes compartilhadas

`shared/types.ts`:

```ts
export const DEAL_STAGES = [
  'proposta_enviada', 'em_negociacao', 'ganho', 'perdido',
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const LOSS_REASONS = [
  'condicoes_comerciais', 'preco', 'sem_retorno', 'fora_do_perfil',
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

export const DEAL_ACTIVITY_KINDS = [
  'created', 'stage_changed', 'value_changed',
  'note_added', 'won', 'lost', 'reactivated', 'owner_changed',
] as const;
export type DealActivityKind = (typeof DEAL_ACTIVITY_KINDS)[number];

export interface PublicDeal {
  id: string;
  lead: {
    id: string;
    name: string;
    phone: string;
    vehicleModel: string | null;
    vehiclePlate: string | null;
    status: LeadStatus;
  };
  stage: DealStage;
  proposalValue: number | null;
  lossReason: LossReason | null;
  notes: string | null;
  owner: { id: string; name: string } | null;
  closedAt: string | null;
  isStale: boolean;            // true se sem activity há > 3 dias na etapa atual
  enteredCurrentStageAt: string;  // timestamp da última stage_changed (ou created)
  createdAt: string;
  updatedAt: string;
}

export interface PublicDealActivity {
  id: string;
  dealId: string;
  kind: DealActivityKind;
  actor: { id: string; name: string } | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
```

## Endpoints

Todos atrás de `authGuard` + `requireRole(['admin', 'comercial'])`. Recepção recebe 403.

### `GET /api/deals`

Lista deals do **kanban ativo**: `proposta_enviada`, `em_negociacao`, ou (`ganho` OR `perdido` AND `closed_at > now() - interval '7 days'`).

Query params:

| Param | Tipo | Default |
|---|---|---|
| `owner` | `mine` \| `all` | `mine` |
| `q` | string | — (busca em `leads.name`, `phone`, `vehicle_plate`) |

Resposta agrupada por stage para alimentar o kanban diretamente:

```json
{
  "stages": {
    "proposta_enviada": [/* PublicDeal */],
    "em_negociacao":    [],
    "ganho":            [],
    "perdido":          []
  },
  "totals": {
    "proposta_enviada": { "count": 12, "valueSum": 8400.00 },
    "em_negociacao":    { "count": 5,  "valueSum": 3200.00 },
    "ganho":            { "count": 3,  "valueSum": 1800.00 },
    "perdido":          { "count": 2,  "valueSum": 0 }
  }
}
```

### `GET /api/deals/history`

Deals com `closed_at < now() - interval '7 days'`. Paginado 50/page (igual Cadastros).

Query params: `q`, `owner`, `stage` (`ganho` | `perdido`), `lossReason`, `from` (ISO date), `to` (ISO date), `page`.

### `GET /api/deals/:id`

Retorna `PublicDeal` + `activities: PublicDealActivity[]` (timeline DESC).

### `POST /api/deals`

Body: `{ leadId: uuid, proposalValue?: number }`. Cria deal manualmente. Idempotente: se já existe deal pro `leadId`, retorna o existente com 200 (não 409). Owner = usuário autenticado. Loga `created` com `metadata.source = 'manual'`.

### `PATCH /api/deals/:id`

Body parcial:

```json
{
  "proposalValue": 580.00,
  "notes": "Pediu desconto de 10%.",
  "ownerUserId": "<uuid>"
}
```

Cada campo modificado gera activity própria (`value_changed`, `note_added`, `owner_changed`).

### `POST /api/deals/:id/stage`

Body: `{ stage: DealStage, lossReason?: LossReason }`.

Validações:
- `stage === 'perdido'` → `lossReason` obrigatório (400 se ausente).
- `stage === 'ganho'` → `proposal_value` precisa estar preenchido (400 com mensagem clara).

Side-effects:
- `closed_at = now()` em `ganho`/`perdido`; `closed_at = NULL` em `proposta_enviada`/`em_negociacao`.
- Activity `stage_changed` com `metadata: { from, to }`.
- Adicional: `won` ou `lost` (com `reason`) — facilita query do dashboard futuro.
- Se mover **de** terminal **para** ativo → activity `reactivated` no lugar de `stage_changed`.

### `DELETE /api/deals/:id`

Apenas `admin`. Comercial recebe 403. Remove o deal mas não deleta o lead.

### Endpoint interno

`pipelineIntegration.maybeAddDealFromConversation(opts)` — chamado pelo `sendMessage` do WhatsApp Inbox. Não é REST. Ver "Integração com WhatsApp Inbox" abaixo.

## Frontend

### Estrutura de arquivos

```
src/
  pages/inside-sales/
    InsideSalesPage.tsx               # shell com tabs Pipeline / Histórico
    HistoryPage.tsx                   # tabela paginada (acessada via tab)
  features/inside-sales/
    api.ts                            # hooks TanStack Query
    helpers.ts                        # formatCurrency, stageLabels, lossReasonLabels
    types.ts                          # re-exports
    KanbanBoard.tsx                   # 4 colunas + DndContext
    KanbanColumn.tsx                  # 1 coluna (drop zone)
    DealCard.tsx                      # card draggable
    DealDrawer.tsx                    # detail panel + activity log
    ActivityLog.tsx                   # timeline de PublicDealActivity[]
    LossReasonDialog.tsx              # dialog ao mover pra Perdido
    GanhoValueDialog.tsx              # dialog ao mover pra Ganho sem valor
    ValueInput.tsx                    # input formatado de R$ (R$ 1.234,56)
```

### Layout

**Header:** título "Inside Sales" + subtitle + botão "+ Adicionar ao pipeline" (abre dialog: select de leads sem deal ativo, opcional valor).

**Tabs:** Pipeline (default, kanban) | Histórico (tabela).

**Toolbar (acima do kanban):** busca livre + chips "Meus deals" / "Todos" (URL params persistentes).

**Kanban (`grid-template-columns: repeat(4, 1fr)`, h ~620px):**

- Cada coluna tem header com nome (cor varia: azul/azul/verde/vermelho), contador, soma de R$.
- Cards arrastáveis via `useDraggable` do dnd-kit.
- Card mostra: avatar (iniciais), nome, veículo, valor (verde se preenchido, "—" se null), dono, tempo relativo, tag amarela "parado" se `isStale`.
- Em "Perdido", chip de motivo aparece embaixo do veículo.

**Drag & drop comportamento:**
- Mover entre colunas ativas: optimistic update + `POST /:id/stage`.
- Mover pra Perdido: bloqueia drop, abre `LossReasonDialog`. Confirmar dispara o POST com `lossReason`.
- Mover pra Ganho sem `proposal_value`: bloqueia drop, abre `GanhoValueDialog` pedindo valor (input + confirm). Sem valor → cancela.
- Mover de terminal pra ativa: chama POST direto; backend marca como `reactivated`.
- Falha do POST: rollback otimista, toast vermelho.

**Stale indicator:**
- Backend calcula `isStale` no service (`PublicDeal.isStale`):
  - True se há > 3 dias desde a última activity (qualquer kind exceto `note_added`) numa etapa **ativa**.
  - False em terminais (Ganho/Perdido).
- Frontend só renderiza a tag amarela.

**Drawer lateral (clicar no card):**
- Slide-in da direita, ~440px.
- Header: avatar grande + nome + telefone · veículo · placa.
- Seção "Deal": etapa (pill colorido), valor (editável inline — clica abre input, salva no blur), dono (dropdown), no pipeline desde.
- Seção "Notas": textarea livre, salva no blur (debounced 500ms).
- Seção "Atividade": timeline DESC com ícones por kind:
  - `📝 note_added`
  - `↔️ stage_changed`
  - `💰 value_changed`
  - `⚡ created` (auto)
  - `+ created` (manual)
  - `✅ won`
  - `❌ lost`
  - `🔄 reactivated`
  - `👤 owner_changed`
- Botões no rodapé: "Abrir conversa" → `/whatsapp?conv=<id>` · "Editar lead" → `/cadastros`. (Se lead não tem conv, "Abrir conversa" fica disabled.)

### Histórico

Tabela com colunas: Cliente · Veículo · Valor · Etapa · Motivo · Dono · Fechado em.

Filtros: busca · período (datepicker simples) · etapa (Ganho / Perdido / Ambos) · motivo (multi-select, só ativo se etapa inclui Perdido) · dono.

Linhas clicáveis abrem o `DealDrawer` em modo read-only (sem drag-drop, edição desabilitada).

Paginação 50/page, igual Cadastros.

### Polling com TanStack Query

```ts
useDealsBoard(filters)         // refetchInterval: 5_000
useDealHistory(filters)        // refetchInterval: undefined (manual refetch)
useDeal(id)                    // refetchInterval: 5_000 quando drawer aberto
```

### URL params

`/inside-sales?owner=mine&q=joão` (Pipeline tab default)

`/inside-sales?tab=history&from=2026-04-01&to=2026-04-30&stage=perdido&reason=preco`

## Integração com WhatsApp Inbox

### Hook no `sendMessage`

`server/services/conversationsService.ts` — função `sendMessage` ganha hook **no fim**, após inserir mensagem outbound e fazer auto-claim:

```ts
import { maybeAddDealFromConversation } from './pipelineIntegration';

// ... dentro de sendMessage, após persistir a mensagem:
try {
  await maybeAddDealFromConversation({
    conversationId: conv.id,
    messageKind: input.kind,
    userId: input.userId,
  });
} catch (err) {
  console.warn('[pipeline] failed to maybe add deal:', err);
  // Não relança — mensagem já foi enviada com sucesso.
}
```

### `pipelineIntegration.maybeAddDealFromConversation`

`server/services/pipelineIntegration.ts`:

```ts
export async function maybeAddDealFromConversation(opts: {
  conversationId: string;
  messageKind: MessageKind;
  userId: string;
}): Promise<void> {
  if (opts.messageKind !== 'image') return;

  const [conv] = await db.select().from(conversations).where(eq(conversations.id, opts.conversationId)).limit(1);
  if (!conv || conv.queue !== 'comercial') return;

  const [existing] = await db.select().from(deals).where(eq(deals.leadId, conv.leadId)).limit(1);

  if (!existing) {
    await dealsService.createDeal({
      leadId: conv.leadId,
      ownerUserId: opts.userId,
      source: 'auto_image',
    });
  } else if (existing.stage === 'ganho' || existing.stage === 'perdido') {
    await dealsService.reactivateDeal({ dealId: existing.id, userId: opts.userId });
  } else {
    // Já no pipeline ativo — no-op (não polui timeline)
  }
}
```

### Sidebar do WhatsApp Inbox

`src/features/whatsapp/LeadSidebar.tsx` — adicionar nova seção "Pipeline" abaixo de "Atendimento":

- Lead **sem** deal ativo: botão "+ Adicionar ao pipeline" (chama `POST /api/deals`).
- Lead **com** deal ativo: chip de etapa (`● Em negociação`) + valor (`R$ 580`) + link "Ver deal →" (navega pra `/inside-sales` com drawer aberto via URL `?deal=<id>`).
- Visível só pra `comercial` + `admin`. Recepção não vê essa seção.

## Integração com Cadastros

### Tabela de leads (`/cadastros`)

`src/features/leads/LeadsTable.tsx` — adicionar coluna nova "Pipeline":
- Lead com deal ativo: chip `● {stageLabel}` (cor por etapa) + R$ valor.
- Lead sem deal: vazio.
- Visível pra todos os roles (read-only). Sem permissão pra modificar daqui.

`src/features/leads/LeadFilters.tsx` — adicionar filtro novo "No pipeline":
- `Todos` (default) · `Sim` (deal ativo) · `Não` (sem deal).
- Backend (`server/services/leadsService.ts`) ganha join opcional com `deals` no list.

### Edge case: deletar lead com deal

`leads.id` é `ON DELETE RESTRICT` no FK `deals.lead_id`. Se Comercial tenta deletar lead em Cadastros e ele tem deal ativo, Postgres barra (FK violation). Frontend traduz o 409 pra mensagem clara: "Não é possível excluir — lead está no pipeline. Remova o deal primeiro."

## Variáveis de ambiente

Nenhuma nova. Reusa as existentes.

## Dependência nova

```bash
npm install @dnd-kit/core @dnd-kit/sortable
```

~30KB gz. Compatível com React 19. Mantida ativamente.

## Testes

Mesmo padrão dos sub-projetos anteriores: Vitest + Supertest, schema `lubritec_test`.

**Atualizar `server/tests/setup.ts`** — incluir `deal_activities, deals` no TRUNCATE (child antes de parent):

```ts
'TRUNCATE deal_activities, deals, message_templates, messages, conversations, leads, sessions, auth_tokens, users RESTART IDENTITY CASCADE'
```

**Helpers em `server/tests/helpers.ts`:**
- `createDeal(opts)` — leadId obrigatório, demais com defaults sensatos.
- `createDealActivity(opts)` — dealId obrigatório.

**Test files:**

| Arquivo | Cobertura |
|---|---|
| `deals-list.test.ts` | 401 sem token, 403 pra recepcao, list `owner=mine/all`, busca, agrupamento por stage, totals, filtro de 7 dias em terminais |
| `deals-actions.test.ts` | Criar manual idempotente, editar valor (gera activity), editar notes, mover stage (gera activity), mover pra Ganho sem valor → 400, mover pra Perdido sem motivo → 400, reativar (terminal → ativa = `reactivated`) |
| `deals-history.test.ts` | Listagem com `closed_at < now() - 7d`, filtros (período, etapa, motivo, dono), paginação |
| `deals-rbac.test.ts` | Recepcao 403 em todas as rotas, comercial OK, comercial não pode deletar (403), admin pode deletar (204) |
| `pipeline-integration.test.ts` | `maybeAddDealFromConversation`: ignora se kind != image, ignora se queue != comercial, cria se sem deal, no-op se ativo, reativa se terminal |
| `whatsapp-pipeline-trigger.test.ts` | Integração: POST `/api/conversations/:id/messages` kind=image numa conv Comercial cria deal automático. UazAPI mockado. |

**Frontend:** sem testes adicionais nesta v1. Smoke manual.

**Lint + type-check:** obrigatórios.

Meta: ~25-30 testes novos.

## Performance

- Queries do board agrupam por stage no backend; um único SELECT cobre tudo.
- Index `(stage, updated_at DESC)` cobre a listagem do kanban.
- Index `closed_at WHERE closed_at IS NOT NULL` cobre filtro de 7 dias.
- Polling 5s consome 1 SELECT pequeno (com totals computados via SQL aggregation, sem N+1).
- Volume estimado: 50-200 deals ativos, 10k deals/ano em histórico — sem stress no Postgres.

## Segurança

- `requireRole(['admin', 'comercial'])` em todas as rotas REST. Recepção 403.
- `pipelineIntegration` roda server-to-server (chamada do `sendMessage` do WhatsApp), não tem role check próprio — quem dispara é o sendMessage do usuário autenticado.
- Sem dados sensíveis adicionais — só metadados financeiros (valor da proposta).

## Fora de escopo (sub-projetos futuros)

- **Dashboard de funil** — sub-projeto 7. O design atual já gera os dados necessários (motivo de perda, ciclo, conversão por etapa).
- **Notificações** quando deal fica parado X dias (push, email, slack).
- **Anexos no deal** (foto da proposta enviada por exemplo). Por enquanto só `notes` em texto.
- **Forecasting / previsão de fechamento** — campo `expected_close_date` foi explicitamente excluído por ciclo de venda curto.
- **Multi-pipeline** (vários funis simultâneos por produto/serviço).
- **Probabilidade por etapa** (% de fechamento típico) — futuro.

## Roadmap atualizado

1. ✅ Auth/RBAC
2. ✅ Cadastros
3. ✅ WhatsApp Inbox
4. **Inside Sales (este sub-projeto)**
5. Disparo em massa de campanhas
6. IA de pré-qualificação
7. Dashboard de Funil
