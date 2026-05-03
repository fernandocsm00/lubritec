# Dashboard LubriConnect — Design

**Data:** 2026-05-02
**Status:** Aprovado, frontend implementado, backend pendente (DB connectivity)
**Escopo:** Página `/dashboard` (hoje um Placeholder)

## Contexto

A rota `/dashboard` existe mas é só um `Placeholder`. A plataforma já coleta dados ricos suficientes para um painel estratégico:

- **Leads** (status, source, dados de veículo, `lastPurchaseDate`, `avgMileagePerDay`)
- **Conversations** (fila, status, `unreadCount`, `isExpired24h`, origem)
- **Messages** (timestamps — base para SLA de resposta)
- **Deals** (etapa, `proposalValue`, `lossReason`, owner, `isStale`)
- **DealActivities** (auditoria completa de mudanças de etapa)
- **WhatsappInstance** (status da conexão)

## Decisões travadas no brainstorm

| Tópico | Decisão |
|---|---|
| Audiência primária | Gestor (admin) + Vendedor inside sales (comercial). Recepção fora — eles vivem no Inbox. |
| Convivência das audiências | Toggle no topo "Visão da operação ↔ Meu pipeline". Comercial só vê "Meu pipeline" (toggle escondido). |
| Reativação de carteira | Fora desta entrega — vai pra rota própria depois. |
| Janela de tempo | Seletor "Hoje / 7d / Mês corrente / 30d / Trimestre". Default = Mês corrente. Comparativo automático com o período anterior do mesmo tamanho. |
| Metas | Meta única mensal (organização-wide), configurada em `Settings → Organização`. Singleton no schema. Sem meta por vendedor nessa fase. |
| Filosofia | Híbrida "KPI-first + Action-oriented" — overview executivo no topo, alertas acionáveis logo em seguida, depois funil/pipeline/ranking. |

## Layout

### Visão da operação (admin)

```
┌──────────────────────────────────────────────────────────────────────┐
│  ◉ Visão da operação    ○ Meu pipeline       Período: Mês corrente ▾ │
│                                              vs período anterior      │
├──────────────────────────────────────────────────────────────────────┤
│  KPI ROW (4 cards)                                                   │
│  Vendas R$ 48.200 (▓▓▓░ 64% meta R$ 75k) | Propostas 42 (▲ 12%)      │
│  Win rate 31% (▼ 3pp)                    | Ticket médio R$ 1.148    │
├──────────────────────────────────────────────────────────────────────┤
│  ATENÇÃO — 3-5 itens acionáveis (ordem por gravidade)                │
│  🔴 3 propostas há +14 dias sem retorno          [Abrir lista]       │
│  🔴 5 conversas expiraram (>24h sem resposta)    [Abrir inbox]       │
│  🟠 7 deals parados há +5 dias                   [Abrir kanban]      │
│  🟡 12 conversas no comercial aguardando         [Abrir inbox]       │
├──────────────────────────────────────────────────────────────────────┤
│  FUNIL DO PERÍODO          │  PIPELINE EM ABERTO (real-time)         │
│  Leads novos     187       │  Proposta enviada  R$ 84k  (28)         │
│  ↓ 72%                     │  Em negociação     R$ 51k  (19)         │
│  Conversaram    134        │  Total aberto     R$ 135k               │
│  ↓ 31%                     │  Idade média      6.2 dias              │
│  Propostas       42        │                                         │
│  ↓ 31%                     │                                         │
│  Ganhos          13        │                                         │
├──────────────────────────────────────────────────────────────────────┤
│  ATENDIMENTO WHATSAPP      │  TOP VENDEDORES (período)               │
│  Em fila            12     │  1. João Silva   R$ 18.300 (6 ✓)       │
│  Tempo méd. resp.   4m12s  │  2. Maria Costa  R$ 14.100 (4 ✓)       │
│  Expirados >24h     5      │  3. Pedro Alves  R$  9.800 (3 ✓)       │
│  Sem resposta hoje  3      │  4. Ana Lima     R$  6.000 (2 ✓)       │
└──────────────────────────────────────────────────────────────────────┘
```

### Meu pipeline (comercial e admin alternando)

Mesma estrutura, com diferenças:
- **KPI row** vira pessoal: Meus ganhos, Minhas propostas, Meu win rate, Meu ticket médio. Sem barra de meta no card de vendas (meta é da org, não individual).
- **Atenção** filtrada por `owner = req.user.id`.
- **Funil** pessoal — começa em "Conversas que respondi" (`messages.sentByUserId = me` no período), → "Propostas minhas" (`deals` com `ownerUserId=me` criados no período) → "Ganhos meus" (`deals` com `ownerUserId=me` e `stage='ganho'` no período). Não usa `leads.createdAt` porque leads não têm dono — a unidade de "meu" começa quando há atribuição de owner.
- **Pipeline em aberto** = só meus deals.
- **Atendimento WhatsApp** sai da tela (não é responsabilidade do comercial).
- **Top vendedores** vira **Atividades recentes minhas** (últimos 10 eventos do `deal_activities` com `actorUserId = req.user.id`).

### Princípios de layout

- Seções demarcadas por divisores horizontais finos. Sem cards aninhados em cards.
- Toda KPI e todo item de "Atenção" é clicável e leva à tela de origem com filtro pré-aplicado.
- Sem ações destrutivas no dashboard — ele é leitura + roteamento.

## Schema — adições

Singleton de configuração da organização (mesmo padrão do `whatsapp_instance`):

```ts
// server/db/schema.ts
export const orgSettings = pgTable('org_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  singleton: boolean('singleton').notNull().default(true),  // unique idx
  monthlySalesGoal: numeric('monthly_sales_goal', { precision: 12, scale: 2 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Editado em `Settings → Organização` (campo simples). Sem histórico por mês — singleton — porque a comparação do dashboard é entre *valores* de períodos, não "% de meta atingida no mês anterior". Se um dia precisar de série histórica vira tabela `sales_goals(month, value)` sem quebrar nada.

## Endpoints

### `GET /api/dashboard/summary?view=org|me&period=today|7d|month|30d|quarter`

Refetch a cada 60s no front (React Query).

```ts
{
  period: { start, end, prevStart, prevEnd, label },
  kpis: {
    sales:     { value, prev, deltaPct, count, prevCount },
    proposals: { value, prev, deltaPct },        // value = count
    winRate:   { value, prev, deltaPct },        // pp diff
    avgTicket: { value, prev, deltaPct },
  },
  goal: { monthlyTarget, currentMonthSales, percent } | null,  // só view=org && period=month
  funnel:
    | { kind: 'org', newLeads, withConversation, withProposal, won,
        convLeadToConv, convConvToProposal, convProposalToWon }
    | { kind: 'me', respondedConversations, myProposals, myWon,
        convRespToProposal, convProposalToWon },
  pipelineOpen: {                                // ignora period — snapshot live
    byStage: [{ stage, count, valueSum }],
    totalValue, avgAgeDays,
  },
  leaderboard: [{ userId, name, wonValue, wonCount }] | null,  // só view=org
  recentActivities: [{ id, kind, dealId, leadName, createdAt }] | null,  // só view=me
}
```

### `GET /api/dashboard/attention?view=org|me`

Refetch 30s. Ignora seletor de período (alertas operacionais sempre "agora").

```ts
{
  items: [
    { severity: 'critical' | 'warning' | 'info',
      kind: 'proposal_old' | 'conv_expired' | 'deal_stale' | 'queue_pending',
      count: number,
      route: string,           // ex.: '/inside-sales'
      filter: object,          // ex.: { stale: true, owner: 'me' }
    }
  ]
}
```

### `GET /api/dashboard/whatsapp` — só `view=org`

Refetch 15s. Métricas live de atendimento.

```ts
{ inQueue, avgFirstResponseSec, expired24h, noResponseToday, instanceConnected }
```

## Cálculos (services)

Novo arquivo `server/services/dashboardService.ts`:

- **`summary(view, userId, period)`**
  - `wonValue/count`: `SUM(proposalValue), COUNT(*) FROM deals WHERE stage='ganho' AND closedAt BETWEEN start AND end [AND ownerUserId=userId se view=me]`
  - `proposals`: contar `deal_activities WHERE kind='created' AND createdAt BETWEEN start AND end [AND actorUserId=userId se view=me]`
  - `winRate`: `won / (won + perdido)` no período
  - `avgTicket`: `wonValue / wonCount`
  - `funnel.newLeads`: `COUNT(*) FROM leads WHERE createdAt BETWEEN start AND end`
  - `funnel.withConversation`: `COUNT(DISTINCT leadId) FROM conversations WHERE createdAt BETWEEN start AND end`
  - `funnel.withProposal`: `COUNT(DISTINCT leadId) FROM deals WHERE createdAt BETWEEN start AND end`
  - `funnel.won`: igual a `wonCount`
  - `pipelineOpen.byStage`: `GROUP BY stage WHERE stage IN ('proposta_enviada','em_negociacao')`
  - `pipelineOpen.avgAgeDays`: `AVG(EXTRACT(DAY FROM now() - createdAt))` dos abertos
  - Roda 2x para período atual e anterior, calcula `deltaPct` e `pp diff` no service.
  - **Para `view=me`, o funil é diferente** (ver layout): `respondedConversations` (count distinct `conversation_id` em `messages WHERE sentByUserId=me AND sentAt BETWEEN start AND end`) → `myProposals` (`deals WHERE ownerUserId=me AND createdAt BETWEEN start AND end`) → `myWon`. O campo `funnel.newLeads` não se aplica em `view=me`; o tipo de retorno deve refletir isso (union discriminado por `view` ou campo opcional).
  - **Time zone:** todos os boundaries de período (`start`, `end`, `prevStart`, `prevEnd`) são calculados em `America/Sao_Paulo`. As colunas são `timestamptz` então a comparação no SQL é segura.
- **`attention(view, userId)`** — 4 queries paralelas:
  - `proposal_old` = `deals WHERE stage='proposta_enviada' AND updated_at < now() - INTERVAL '14 days'`
  - `conv_expired` = reusa `conversationsService` lógica de `isExpired24h=true AND status != 'encerrada'`
  - `deal_stale` = `deals WHERE stage IN ('proposta_enviada','em_negociacao') AND updated_at < now() - INTERVAL '5 days'`
  - `queue_pending` = `conversations WHERE queue='comercial' AND status='aguardando_atendimento'`
  - Filtra `ownerUserId=userId` quando `view=me`.
  - Retorna ordenado por severidade (`critical → warning → info`).
- **`whatsapp()`** — reusa `conversationsService` / `whatsappWebhookService` para métricas live + lê `whatsapp_instance.last_status` para `instanceConnected`.

### Permissões
- `view=me` — qualquer autenticado, escopo = `req.user.id`.
- `view=org` — só `role='admin'`. `comercial` → 403, e o front esconde o toggle.

## Visual

Usa só os tokens do redesign já aplicado (`lc-navy`, `lc-amber`, `lc-ruby`, `Geist`, `Geist Mono`).

- **Cards de KPI**: `bg-white border-slate-200 rounded-xl shadow-lc-card p-5`. Número grande Geist 600 tracking-tight, label `text-xs uppercase tracking-wider text-slate-500`. Delta em `font-mono text-xs` — verde (`text-emerald-600`) ou `text-lc-ruby` com seta `▲ ▼`.
- **Barra de meta**: `h-1.5 bg-slate-200 rounded-full` com fill `bg-gradient-to-r from-lc-navy to-lc-amber`. Texto sob a barra: `64% de R$ 75.000` em mono. ARIA progressbar com aria-valuenow/min/max/label.
- **Atenção**: lista, linha 56px, ícone à esquerda em caixa colorida, texto sans, contagem em mono, botão fantasma `text-sm text-lc-navy hover:underline`. Máx 5 visíveis.
- **Funil**: barras horizontais empilhadas decrescentes, valores em mono, % entre etapas como rótulo (`↓ 72%` em `text-xs text-slate-500 font-mono`). CSS puro, sem chart-lib.
- **Pipeline em aberto**: tabela mínima sem header, valor à direita em mono. Idade média no footer.
- **Atendimento WhatsApp**: 2x2 grid de mini-stats. Quando desconectado: card único com ícone lc-ruby + "Reconectar →".
- **Top vendedores**: lista, posição em mono, nome em sans, valor em mono à direita. Top 5.
- **Toggle**: segmented control (`bg-slate-100` com indicador `bg-white shadow-sm`).
- **Seletor de período**: dropdown discreto à direita do toggle, `text-sm`. Mostra label do comparativo logo abaixo (`vs período anterior` em `text-xs text-slate-400`).

## Estados

| Estado | Comportamento |
|---|---|
| Loading inicial | Skeleton por bloco (`bg-slate-100 animate-pulse`), não bloqueia tela toda. KPIs e Atenção carregam antes (queries mais leves). |
| Empty (org sem dados) | KPI: `—` no número + "sem vendas no período". Funil: "Nenhum lead novo no período". Atenção: ✅ "Nada exigindo atenção agora". Pipeline: "Nenhum deal aberto". Ranking: "Nenhum ganho no período". |
| Sem meta cadastrada | Card "Vendas" some a barra e mostra `Definir meta →` linkando pra `Settings → Organização`. |
| WhatsApp desconectado | Bloco WhatsApp mostra ícone `lc-ruby` + "Instância desconectada" + `Reconectar →`. Resto funciona. |
| Erro de API por bloco | Bloco mostra `Falha ao carregar` + `Tentar novamente`. Não derruba a página. |
| Troca de período | Refetch com `placeholderData: previousData` — números antigos com leve opacity até chegar o novo, sem flash. |
| Sem permissão | API 403; front esconde o toggle. |

## Refresh
- Auto-refetch silencioso (60s/30s/15s) sem indicador visual durante o refetch passivo.
- Botão `↻` discreto no canto superior direito força refresh manual de tudo. Disabled + spin enquanto qualquer query está fetching.
- Sem WebSocket/SSE.

## Responsivo
- ≥1280px: 2 colunas conforme desenho.
- 1024–1279px: KPIs viram 2x2; demais blocos 1 coluna empilhada.
- <1024px: tudo 1 coluna, KPIs 2x2.
- Sem mobile-first nessa fase (uso desktop pelo gestor).

## Acessibilidade
- Variação de cor sempre acompanhada de texto (`▲ ▼` ou label "alta/queda").
- Cards de "Atenção" são `<Link>` (Tab navigable).
- Skeletons com `role="status"` + `aria-label="Carregando"`.
- Barra de meta com `role="progressbar"` + aria-valuenow/min/max/label.

## Componentes a criar

```
src/pages/dashboard/
  DashboardPage.tsx              # rota + layout + toggle + seletor de período
  api.ts                         # client das 3 endpoints
  hooks.ts                       # useDashboardSummary / useAttention / useWhatsapp
  components/
    ViewToggle.tsx               # segmented control
    PeriodPicker.tsx             # dropdown
    KpiCard.tsx                  # card genérico (label, value, delta, opcional bar/cta)
    KpiRow.tsx                   # 4 cards
    AttentionList.tsx            # lista de atenção
    FunnelChart.tsx              # barras horizontais empilhadas (CSS puro)
    PipelineOpen.tsx             # tabela mínima
    WhatsappStats.tsx            # 2x2 grid + estado desconectado
    Leaderboard.tsx              # ranking top 5
    RecentActivities.tsx         # lista atividades (view=me)
    BlockSkeleton.tsx            # skeleton genérico por bloco
    BlockError.tsx               # estado de erro por bloco
```

```
server/
  routes/dashboard.ts            # 3 endpoints + permission guard
  services/dashboardService.ts   # summary + attention + whatsappStats
  services/orgSettingsService.ts # singleton get/update
  controllers/dashboardController.ts
  controllers/orgSettingsController.ts
  routes/orgSettings.ts
  lib/period.ts                  # date math + tz boundaries
  db/migrations/013_org_settings.sql
```

E adicionar em `src/pages/settings/`:
- Tab "Organização" com campo "Meta de vendas mensal" → `PUT /api/org-settings`.

## Fora de escopo desta entrega
- Reativação de clientes (carteira dormente).
- Metas por vendedor — singleton só de organização.
- Drilldown "ver todos" do ranking — modal/drawer fica pra próxima.
- Exportar CSV/PDF do dashboard.
- WebSocket/atualização real-time push.
- Versão mobile-first.
