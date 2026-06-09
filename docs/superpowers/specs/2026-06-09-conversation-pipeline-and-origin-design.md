# Conversa: trocar fase no CRM + origem de campanha na lista

**Data:** 2026-06-09
**Status:** Aprovado em brainstorming, aguardando plano

## Contexto

Dois ajustes pedidos pelo Fernando na tela de WhatsApp/Inbox:

1. **Dentro da conversa, mudar a fase do lead no CRM (Inside Sales).** Hoje o painel direito (`LeadSidebar`) só tem um botão "+ Adicionar ao pipeline" que cria um deal em `lead_no_comercial` e empurra o usuário pra `/inside-sales`. Faltam controles inline pra trocar de fase sem sair da conversa.

2. **Identificação da campanha de origem na lista de conversas em aberto.** Hoje a `ConversationRow` recebe `originKind` e `originCampaignId` do backend mas não exibe nada — não há como saber, ao olhar a lista, de qual campanha veio aquela conversa.

## Feature 1 — Trocar fase do CRM dentro da conversa

### UX

Substituir a seção "Pipeline" atual do `LeadSidebar` por um seletor de fase sempre visível (admin/comercial), com as 5 fases do enum `DealStage`:

- `lead_no_comercial` — "Lead no Comercial"
- `proposta_enviada` — "Proposta enviada"
- `em_negociacao` — "Em negociação"
- `ganho` — "Ganho"
- `perdido` — "Perdido"

**Estados:**

- **Sem deal ainda:** dropdown mostra placeholder "Não está no pipeline". Selecionar uma fase cria o deal naquela fase. Se a fase escolhida ≠ `lead_no_comercial`, encadeia `useCreateDeal()` → `useChangeStage()`.
- **Com deal:** dropdown mostra a fase atual selecionada. Trocar dispara `useChangeStage()` direto.

**Casos especiais (preservam o fluxo existente do Kanban):**

- Selecionar **Ganho** → abrir `GanhoValueDialog` (pede `proposalValue` + `leadQualityFeedback`). Cancelar reverte a seleção visual; confirmar dispara create/change com os campos extras.
- Selecionar **Perdido** → abrir `LossReasonDialog` (pede `lossReason`). Mesmo padrão de cancelar/confirmar.

**Auxiliares:**

- Toast de sucesso/erro após cada mudança.
- Link "Abrir no pipeline →" abaixo do dropdown leva pra `/inside-sales?dealId=<id>` (apenas se já existe deal); abre o `DealDrawer` desse deal. (Se o param `dealId` ainda não existir na rota, definir nesta entrega.)
- Visível apenas para roles `admin` e `comercial` (mantém regra do `PipelineSection` atual).

### Backend

Novo endpoint:

```
GET /deals/by-lead/:leadId  →  PublicDeal | null
```

- Guard: `authGuard + requireRole('admin', 'comercial')` (mesmo padrão das demais rotas em `routes/deals.ts`).
- Service: nova função `getDealByLeadId(leadId)` em `dealsService` que retorna o deal vigente do lead (LEFT JOIN com `users` pro owner; sem activities — payload enxuto). Se houver mais de um deal histórico, retorna o mais recente por `updatedAt DESC`.
- Resposta `200` com `null` no body quando não existe deal — front trata isso sem erro.

### Frontend

- `inside-sales/api.ts`: novo hook `useDealByLead(leadId: string | null)` (analogamente ao `useDeal`), `enabled: !!leadId`, `staleTime: 30_000`.
- `whatsapp/LeadSidebar.tsx`: refatorar `PipelineSection` pra usar `useDealByLead(leadId)`. Renderizar:
  - Select shadcn com as 5 fases (labels de `STAGE_LABELS` em `inside-sales/helpers.ts`).
  - Estado local pra controlar dialog de Ganho/Perdido (mesmo padrão do `KanbanColumn`).
  - Link condicional "Abrir no pipeline →" só quando `deal != null`.
- `inside-sales/GanhoValueDialog.tsx` e `LossReasonDialog.tsx`: verificar se aceitam um modo "create+change" ou apenas "change". Se hoje só fazem "change" em um deal existente, estender a API do dialog pra aceitar uma callback genérica `onConfirm(payload)` em vez de chamar a mutation diretamente — assim o sidebar pode encadear create+change quando o deal ainda não existe. (Isso é uma melhoria local proporcional ao trabalho; não refatorar o Kanban.)

### Casos de borda

- Lead sem deal e usuário seleciona **Ganho** ou **Perdido**: válido. Cria o deal e já move pra fase final na mesma transação cliente (duas mutations encadeadas; se a segunda falhar, mostra erro e o deal fica em `lead_no_comercial`).
- Trocar fase enquanto a mutation anterior ainda está pendente: desabilitar o select durante `isPending`.
- Role não autorizada acessar a rota `/conversations/...`: a seção inteira continua oculta (sem mudança).

## Feature 2 — Origem da campanha na lista de conversas

### Backend

- `shared/types.ts`: adicionar `originCampaignName: string | null` na interface `PublicConversation`.
- `server/services/conversationsService.ts` (função `listConversations`):
  - Adicionar `leftJoin(campaigns, eq(conversations.originCampaignId, campaigns.id))` na query principal.
  - Selecionar `campaignName: campaigns.name`.
  - Incluir `originCampaignName: r.campaignName ?? null` no mapeamento de `PublicConversation`.
- Não há mudança de schema. Não há impacto em índices (já existe `idx ON conversations(origin_kind, origin_campaign_id)` em `009_whatsapp.sql`).

### Frontend

- `whatsapp/ConversationRow.tsx`: quando `conv.originKind === 'campaign' && conv.originCampaignName`, renderizar pill compacto abaixo da linha do owner:
  - Container: `inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground max-w-[140px]`
  - Ícone: `Megaphone` (lucide-react), `h-2.5 w-2.5`
  - Texto: `truncate` com `conv.originCampaignName`
- Se for orgânica (`originKind === 'organic'`), não exibe nada (evita ruído).
- Não exibir o pill quando `originCampaignName` for `null` mesmo com `originKind === 'campaign'` (campanha excluída — `ON DELETE SET NULL` no FK).

### Casos de borda

- Campanha foi deletada após o disparo: `originCampaignId` continua, mas o join devolve `null`. O pill não aparece (fallback silencioso).
- Nomes muito longos: `max-w-[140px] truncate` resolve. Tooltip não é necessário neste momento.

## Fora de escopo

- Filtro de "ver só conversas vindas da campanha X" no Inbox — já existe via `ConversationFilters.campaignId` no backend, mas adicionar o UI fica pra outra entrega.
- Drag-and-drop de fase a partir da conversa (mantém-se apenas no Kanban).
- Histórico de mudanças de fase visível no sidebar — quem quiser ver activities clica em "Abrir no pipeline →".

## Arquivos afetados

**Backend:**

- `shared/types.ts` — adicionar `originCampaignName` em `PublicConversation`
- `server/services/conversationsService.ts` — join + select de `campaigns.name`
- `server/services/dealsService.ts` — nova função `getDealByLeadId`
- `server/controllers/dealsController.ts` — novo handler `byLeadHandler`
- `server/routes/deals.ts` — registrar `GET /deals/by-lead/:leadId`

**Frontend:**

- `src/features/inside-sales/api.ts` — novo hook `useDealByLead`
- `src/features/inside-sales/GanhoValueDialog.tsx` — generalizar `onConfirm` (se necessário)
- `src/features/inside-sales/LossReasonDialog.tsx` — generalizar `onConfirm` (se necessário)
- `src/features/whatsapp/LeadSidebar.tsx` — refatorar `PipelineSection` com seletor de fase
- `src/features/whatsapp/ConversationRow.tsx` — pill de origem de campanha

**Testes:**

- `server/tests/conversations-list.test.ts` — asserir `originCampaignName` no payload
- `server/tests/deals-*.test.ts` — novo teste para `GET /deals/by-lead/:leadId` (com e sem deal)
