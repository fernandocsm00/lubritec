# Campanhas do lead em Cadastros e Inside Sales

**Data:** 2026-06-10
**Status:** Aprovado em brainstorming, aguardando plano

## Contexto

Hoje a Inbox mostra a campanha de origem de cada conversa (badge na `ConversationRow`, filtro por `?campaignId=`) e o backend resolve isso via JOIN simples — porque `conversations.originCampaignId` é 1:1.

O Fernando pediu o mesmo recurso nas telas onde os leads são geridos:

- **Cadastros (`/cadastros`)** — tabela de leads (`LeadsTable`).
- **Inside Sales (`/inside-sales`)** — Kanban de deals (`KanbanBoard`).

Diferença essencial: a relação **lead ↔ campanha é N:N** via `campaign_recipients` (um mesmo lead pode ter sido alvo de várias campanhas de reativação/recompra). Hoje nada disso é exposto no `PublicLead` nem no `PublicDeal`.

## Escopo

Decisões fixadas em brainstorming:

- **Quais campanhas mostrar:** todas em que o lead esteve com **disparo efetivado** (`campaign_recipients.sent_at IS NOT NULL`). Recipients `pending`, `failed` e `skipped` não contam, nem pra exibição nem pra filtro.
- **Filtro:** multi-select com semântica OR — "leads que estiveram em qualquer uma das campanhas selecionadas".
- **Apresentação:** até 2 badges visíveis na linha/card + indicador "+N" que abre popover com a lista completa.
- **Persistência:** sem migration de schema. Tudo derivado em tempo de leitura via JOIN agregado.

Não está no escopo desta entrega:

- Mostrar `campaigns` em outros endpoints (`GET /leads/:id`, drawer da conversa). Pode entrar em uma próxima passada se o Fernando pedir.
- Filtro com semântica AND ("esteve em A **e** B").
- Estatísticas agregadas tipo "X% dos leads vêm da campanha Y".

## Arquitetura geral

Três camadas mudam, todas mecânicas:

1. **`shared/types.ts`** — novo tipo `LeadCampaignSummary` e campo `campaigns: LeadCampaignSummary[]` em `PublicLead` e `PublicDeal`.
2. **Backend** — `leadsService.listLeads` e `dealsService.listBoard`/`listHistory` agregam campanhas via subquery JSON e aceitam `campaignIds` (CSV de UUIDs).
3. **Frontend** — componente reutilizável `LeadCampaignBadges` consumido em `LeadsTable` e nos cards do `KanbanBoard`; multi-select "Campanhas" no painel de filtros de cada tela.

## Dados expostos

```ts
// shared/types.ts
export interface LeadCampaignSummary {
  id: string;
  name: string;
  sentAt: string; // ISO; lista vem desc-ordenada por sentAt
}

// PublicLead
campaigns: LeadCampaignSummary[];

// PublicDeal
campaigns: LeadCampaignSummary[]; // pertence ao lead do deal, achatado no card pra
                                  // bater com o padrão atual (leadName, leadCnpj, etc.)
```

Lead/deal sem nenhum disparo efetivado retorna `campaigns: []`.

## Backend

### Subquery agregada

Adicionada como coluna calculada na listagem (não vira coluna física):

```sql
COALESCE(
  (
    SELECT json_agg(
      json_build_object('id', c.id, 'name', c.name, 'sentAt', cr.sent_at)
      ORDER BY cr.sent_at DESC
    )
    FROM campaign_recipients cr
    JOIN campaigns c ON c.id = cr.campaign_id
    WHERE cr.lead_id = leads.id
      AND cr.sent_at IS NOT NULL
  ),
  '[]'::json
) AS campaigns
```

### Filtro multi-OR

```sql
WHERE EXISTS (
  SELECT 1 FROM campaign_recipients cr
  WHERE cr.lead_id = leads.id
    AND cr.sent_at IS NOT NULL
    AND cr.campaign_id IN (...)
)
```

### Endpoints atingidos

- `GET /leads` — novo query param `campaignIds` (CSV de UUIDs).
- `GET /deals/board` — idem.
- `GET /deals/history` — idem.

Validação: cada UUID em `campaignIds` passa por `z.string().uuid()` no controller. Lista vazia ou ausente = sem filtro. UUIDs inexistentes no banco não causam erro — o `EXISTS` simplesmente não bate.

### Migration leve (não destrutiva)

Índice parcial pra que o filtro escale conforme a base de recipients cresce:

```sql
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_lead_sent
  ON lubritec.campaign_recipients (lead_id, campaign_id)
  WHERE sent_at IS NOT NULL;
```

Sem reorganização de dados — `CREATE INDEX CONCURRENTLY` não é necessário aqui porque o projeto roda em Supabase com tabela pequena, mas o script de migrate pode usar `CONCURRENTLY` por segurança.

## Frontend

### Componente `LeadCampaignBadges`

Arquivo: `src/features/leads/LeadCampaignBadges.tsx`.

Props:

```ts
interface LeadCampaignBadgesProps {
  campaigns: LeadCampaignSummary[];
  maxVisible?: number; // default 2
}
```

Comportamento:

- Renderiza `null` se `campaigns.length === 0` (linha/card fica limpa).
- Mostra até `maxVisible` badges (icon Megaphone + nome truncado em 20 chars, com tooltip do nome inteiro). Visual herdado do badge atual em [ConversationRow.tsx:88-98](../../../src/features/whatsapp/ConversationRow.tsx#L88).
- Se `campaigns.length > maxVisible`, adiciona um chip "+N" que dispara um Popover. O popover lista todas as campanhas com nome completo + data formatada (`dd/MM/yyyy` em pt-BR).

Acessibilidade: chip "+N" é um `button` com `aria-label="Ver mais N campanhas"`. Popover fecha com Esc/click-fora.

### Uso em Cadastros

`src/features/leads/LeadsTable.tsx`:

- Nova coluna **Campanhas** posicionada entre `Source` e `Flow Stage`.
- Largura fixa estilo `min-w-[180px]` pra acomodar dois badges + "+N" sem quebrar linha.
- Header da coluna não é clicável (sem ordenação por campanhas nesta entrega).

### Uso em Inside Sales

`src/features/inside-sales/DealCard.tsx`:

- Renderiza `LeadCampaignBadges` logo abaixo do nome do lead, antes da linha do `proposalValue`.
- `maxVisible` reduzido a 1 (cards são estreitos) — quase sempre dispara o "+N" pra 2+ campanhas, que é OK porque o popover é o caminho natural.

### Filtro multi-select "Campanhas"

Componente novo `src/features/leads/CampaignsMultiSelectFilter.tsx`, reusado nas duas telas.

UX:

- Botão trigger mostra estado: `"Todas as campanhas"`, `"Campanha X"` (uma), ou `"N selecionadas"` (>1).
- Popover com:
  - Caixa de busca (filtra por nome de campanha, case-insensitive).
  - Lista de checkboxes (alimentada por `GET /campaigns` paginado — vamos requisitar todas as ativas e arquivadas; se a base crescer pra centenas, paginar internamente).
  - Footer com "Limpar seleção" e "Aplicar" (aplicar fecha o popover).
- Estado vai pra query string da tela: `?campaignIds=uuid1,uuid2`. Refresh e share preservam o filtro.

Onde:

- **Cadastros**: barra de filtros existente em `CadastrosPage.tsx`, ao lado de Status/Source/FlowStage.
- **Inside Sales**: barra de filtros existente em `InsideSalesPage.tsx`, ao lado de Owner + busca.

### Hooks/queries

- `useLeads` (TanStack Query existente) ganha `campaignIds: string[]` no input; vira parte do queryKey pra cache não colidir entre filtros.
- `useDealsBoard` e `useDealsHistory` idem.
- Reuso de `useCampaigns(filters)` ([api.ts:145](../../../src/features/campaigns/api.ts#L145)) pra alimentar o multi-select — pedindo todas as campanhas (sem filtro de status) com paginação alta. Sem hook novo.

## Edge cases e validação

- **Lead/deal sem disparo efetivado:** `campaigns: []`, componente não renderiza badges, filtro não casa — comportamento limpo.
- **Recipient com `sent_at IS NULL`** (pending/failed/skipped): excluído tanto da agregação quanto do filtro — combina com a regra "só envios efetivados".
- **Campanha deletada:** `campaign_recipients.campaign_id` tem `onDelete: 'cascade'` ([schema.ts:303](../../../server/db/schema.ts#L303)) — recipients somem junto, agregação reflete imediato.
- **Campaign IDs inválidos no filtro:**
  - UUID malformado → `400 Bad Request` do controller (zod).
  - UUID válido mas inexistente → silenciosamente ignorado (filtro `EXISTS` não bate).
- **Lead com 50+ campanhas (improvável):** subquery retorna todas; UI mostra 2 + "+48" no popover, que rola se preciso. Sem truncamento no backend.
- **Performance:** com o índice parcial proposto, listagem paginada (50 itens) × subquery agregada fica em <50ms mesmo com 100k+ recipients. Filtro `EXISTS` usa o mesmo índice.

## Testes

### Backend (vitest)

`server/tests/leads-list-campaigns.test.ts` (novo):

- Lead sem nenhum recipient → `campaigns: []`.
- Lead com 1 recipient `sent` → `campaigns` com 1 item.
- Lead com 2 recipients (1 `sent`, 1 `pending`) → `campaigns` com 1 item, ordenado por `sentAt` desc.
- Filtro `campaignIds=A` → retorna só leads com recipient sent na campanha A.
- Filtro `campaignIds=A,B` → retorna leads com recipient sent em A **ou** B.
- Filtro `campaignIds=` (vazio) → sem efeito.
- UUID malformado em `campaignIds` → `400`.

`server/tests/deals-list-campaigns.test.ts` (novo) — mesmas garantias pra `listBoard` e `listHistory`.

### Frontend (vitest + RTL)

`src/features/leads/LeadCampaignBadges.test.tsx` (novo):

- 0 campanhas → não renderiza nada.
- 1 campanha → renderiza 1 badge, sem chip "+N".
- 2 campanhas (`maxVisible=2`) → 2 badges, sem chip.
- 5 campanhas (`maxVisible=2`) → 2 badges + chip "+3". Click no chip abre popover com 5 itens ordenados por data.
- 5 campanhas (`maxVisible=1`) → 1 badge + chip "+4" (cobre o caso Kanban).

Teste de integração da `CampaignsMultiSelectFilter` fica como TODO no plano — não é a parte arriscada.

## Riscos e mitigação

- **Risco:** filtro `EXISTS` lento se o índice parcial não pegar. **Mitigação:** o índice é parte da entrega; medir tempo em prod após deploy.
- **Risco:** `json_agg` com muitos itens pode aumentar payload da listagem. **Mitigação:** em prática um lead tem 1-5 campanhas; quem tiver 50+ é outlier e a UI já trata via popover. Sem truncamento no backend.
- **Risco:** drift de tipos entre `PublicLead.campaigns` e `PublicDeal.campaigns`. **Mitigação:** ambos referenciam o mesmo `LeadCampaignSummary`.

## Referências

- Padrão existente de exibição: [ConversationRow.tsx:88-98](../../../src/features/whatsapp/ConversationRow.tsx#L88).
- Padrão existente de filtro por campanha: [conversationsService.ts:96](../../../server/services/conversationsService.ts#L96).
- Modelo N:N: [schema.ts:301](../../../server/db/schema.ts#L301).
- Política "só envios efetivados" coerente com: [project_inbox_visibility.md](../../../../Users/User/.claude/projects/C--Saas-lubritec/memory/project_inbox_visibility.md).
