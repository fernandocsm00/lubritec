# Mass Campaign Dispatch — Design

**Sub-projeto 7 do roadmap.** Sistema de disparo em massa de mensagens WhatsApp para listas filtradas de leads, com agendamento, rate-limit, mídia, placeholders, e dashboard de funil ROI integrado ao Inside Sales.

## Objetivo

Permitir à Lubritec disparar campanhas de WhatsApp pra dezenas/centenas de leads de uma vez (lembrete de troca, promoções, reativação) — sem queimar a chip por velocidade excessiva, e com **rastreio de ROI**: quantos responderam, quantos viraram negociação, quantos fecharam venda.

Aproveita a infra existente: `conversations.origin_kind = 'campaign'` (já no schema), `conversations.origin_campaign_id` (FK pendente — esta spec adiciona), `message_templates`, `uazapiClient.sendMessage`, e o pipeline Inside Sales pra fechar o funil.

## Decisões fixadas (brainstorming)

- **Escopo:** B — campanha como entidade (com `campaigns` + `campaign_recipients`), permite monitoramento/análise. Drip/recorrente fica fora.
- **Audiência:** D — filtros sobre `leads` + opt-out manual via tabela com checkboxes + upload CSV de telefones (cria leads se não existir).
- **Agendamento:** B — "agora" ou "agendado" via `scheduled_at`. Scheduler in-process via `setInterval(60_000)`.
- **Dispatch:** background com rate-limit configurável (default 1 msg / 3s = 20/min). Resume natural via `WHERE status='pending'`. Cancelável (`paused`/`cancelled`).
- **Template:** C — referencia `message_template` mas snapshot do texto fica no `campaigns.message_body`. Suporta 5 placeholders fixos (`{{nome}} {{telefone}} {{placa}} {{modelo}} {{ultima_compra}}`).
- **Mídia:** C — upload nativo de imagem. Storage local em `/uploads/campaigns/{uuid}.{ext}` servido via Express static. Multer pra upload.
- **RBAC:** B — admin+comercial criam/disparam, DELETE só admin. Mesmo padrão Inside Sales.
- **Tracking:** C — funil completo (Enviadas → Respondidas → Em negociação → Ganhos / Perdidos com motivos). JOINs com `messages`, `deals`, `deal_activities`.
- **Arquitetura:** Opção 1 — scheduler + dispatch loop in-process. Sem Redis/BullMQ.

## Schema

Migration `012_campaigns.sql`:

```sql
CREATE TYPE campaign_status AS ENUM (
  'draft',           -- criada mas não disparada
  'scheduled',       -- agendada pra data futura
  'running',         -- em disparo agora
  'paused',          -- pausada manualmente (pode retomar)
  'completed',       -- terminou (todos recipients processados)
  'cancelled'        -- cancelada manualmente (não retomável)
);

CREATE TYPE campaign_recipient_status AS ENUM (
  'pending',
  'sent',
  'failed',
  'skipped'          -- desmarcado no opt-out manual antes do disparo
);

-- Campanhas
CREATE TABLE campaigns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  description          text,
  status               campaign_status NOT NULL DEFAULT 'draft',

  -- Mensagem (snapshot)
  template_id          uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  message_body         text NOT NULL,             -- snapshot do texto (com placeholders {{...}})
  media_url            text,                      -- /uploads/campaigns/<uuid>.jpg
  media_mime           text,

  -- Audiência (filtro salvo pra auditoria)
  audience_filter      jsonb NOT NULL DEFAULT '{}'::jsonb,
                                                   -- ex: { "status": ["frio","morno"], "lastPurchaseDaysAgo": 90 }
  audience_total       int NOT NULL DEFAULT 0,    -- snapshot do total no momento da criação

  -- Agendamento
  scheduled_at         timestamptz,                -- null = "agora" (já passou pra running)
  started_at           timestamptz,                -- preenchido quando vira 'running'
  completed_at         timestamptz,

  -- Contadores agregados (atualizados pelo loop)
  sent_count           int NOT NULL DEFAULT 0,
  failed_count         int NOT NULL DEFAULT 0,
  skipped_count        int NOT NULL DEFAULT 0,

  -- Rate limiting
  rate_per_minute      int NOT NULL DEFAULT 20,

  -- Auditoria
  created_by_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_scheduled_at ON campaigns(scheduled_at)
  WHERE status = 'scheduled';
CREATE INDEX idx_campaigns_owner ON campaigns(created_by_user_id);

-- Recipients (1 row por destinatário do disparo)
CREATE TABLE campaign_recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  phone           text NOT NULL,                   -- snapshot do telefone

  status          campaign_recipient_status NOT NULL DEFAULT 'pending',
  sent_at         timestamptz,                     -- preenchido quando status='sent'
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
                                                   -- conv usada pro envio (criada/reusada)
  message_id      uuid REFERENCES messages(id) ON DELETE SET NULL,
                                                   -- msg outbound resultante
  failure_reason  text,                            -- mensagem de erro (se status='failed')

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (campaign_id, lead_id)                    -- 1 lead aparece 1 vez por campanha
);

CREATE INDEX idx_recipients_campaign_status ON campaign_recipients(campaign_id, status);
CREATE INDEX idx_recipients_lead ON campaign_recipients(lead_id);

-- Adiciona FK em conversations.origin_campaign_id (placeholder existente)
ALTER TABLE conversations
  ADD CONSTRAINT fk_conversations_origin_campaign
  FOREIGN KEY (origin_campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
```

### Decisões importantes

- **Snapshot de `message_body` no campaign** — se o template original for editado depois, a campanha disparada não muda. Auditoria preservada.
- **`audience_filter` jsonb** — guarda os filtros usados ("audit trail"). Campos: `status[]`, `source[]`, `lastPurchaseDaysAgo`, `phoneCsv` (lista após import). Nunca refeito — o que entrou em `campaign_recipients` é o que vale.
- **`conversation_id` no recipient** — útil pra debug ("qual conversa foi usada?"). FK SET NULL pra permitir admin apagar conversa sem quebrar histórico de campanha.
- **`UNIQUE (campaign_id, lead_id)`** — dedup automática (mesmo lead em filtro + CSV não duplica). Insert ignora duplicates via ON CONFLICT.
- **FK ON DELETE SET NULL no `origin_campaign_id`** — apagar uma campanha não quebra conversas históricas (só perde a referência).
- **Sem coluna `cost`** — Lubritec não cobra por mensagem internamente. Se for medir futuramente, adiciona em sub-tarefa.

### Constantes/types compartilhados

```ts
export const CAMPAIGN_STATUSES = [
  'draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_RECIPIENT_STATUSES = [
  'pending', 'sent', 'failed', 'skipped',
] as const;
export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

export interface AudienceFilters {
  status?: LeadStatus[];           // default: todos
  source?: LeadSource[];
  lastPurchaseDaysAgo?: number;    // ex: 90 → last_purchase_date <= now() - 90 days
  excludeLeadIds?: string[];       // opt-out manual
  phoneCsv?: string[];             // upload CSV (telefones normalizados)
}

export interface CampaignDryRunResponse {
  total: number;
  preview: Array<{
    leadId: string;
    name: string;
    phone: string;
    vehicleModel: string | null;
    vehiclePlate: string | null;
    lastPurchaseDate: string | null;
  }>;  // primeiros 5 leads pra preview
}

export interface PublicCampaign {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  templateId: string | null;
  messageBody: string;
  mediaUrl: string | null;
  mediaMime: string | null;
  audienceFilter: AudienceFilters;
  audienceTotal: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  ratePerMinute: number;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface CampaignFunnel {
  totalRecipients: number;
  sent: number;
  failed: number;
  skipped: number;
  replied: number;          // recipients onde conv tem msg.in com sent_at > recipient.sent_at
  inDeal: number;           // recipients cujo lead tem deal ativo (proposta_enviada/em_negociacao)
  won: number;              // recipients cujo lead tem deal ganho
  lost: number;             // recipients cujo lead tem deal perdido
  lostByReason: Record<LossReason, number>;
  totalWonValue: number;    // soma de proposal_value dos deals ganhos vinculados
}

export interface PublicCampaignRecipient {
  id: string;
  leadId: string;
  leadName: string;
  phone: string;
  status: CampaignRecipientStatus;
  sentAt: string | null;
  failureReason: string | null;
}
```

## Endpoints

Todos atrás de `authGuard` + `requireRole('admin', 'comercial')`. DELETE adicionalmente `admin`.

### `GET /api/campaigns`

Lista paginada com resumo de cada campanha. Query: `q`, `status`, `page` (50/page).

Resposta:
```json
{
  "items": [{ /* PublicCampaign + counts derivados */ }],
  "total": 12, "page": 1, "pageSize": 50
}
```

### `POST /api/campaigns/dry-run`

Body: `AudienceFilters`. Retorna `CampaignDryRunResponse` (total + 5 leads de preview). Não persiste nada.

### `POST /api/campaigns`

Body:
```json
{
  "name": "Lembrete troca outubro",
  "description": "Pra clientes com troca há mais de 90 dias",
  "templateId": "uuid",
  "messageBody": "Olá {{nome}}, ...",
  "mediaUrl": "/uploads/campaigns/abc.jpg",
  "mediaMime": "image/jpeg",
  "audienceFilter": { ... },
  "scheduledAt": "2026-05-15T08:00:00Z" | null,  // null = não agendada (draft)
  "ratePerMinute": 20
}
```

Lógica:
1. Cria row em `campaigns` com `status='draft'`.
2. Resolve audiência via `audienceFilter` (mesmo SELECT do dry-run).
3. INSERT em `campaign_recipients` em batch (1 por lead) com `ON CONFLICT (campaign_id, lead_id) DO NOTHING`.
4. Atualiza `audience_total` no campaign.
5. Retorna `PublicCampaign`.

### `POST /api/campaigns/:id/dispatch`

Sem body. Dispara campanha (ou agenda).
1. Verifica `status='draft'` → muda pra `running` (se sem `scheduled_at`) ou `scheduled` (se com).
2. Loop de background pega ela na próxima iteração.
3. Retorna `PublicCampaign`.

Validações:
- Se `audience_total > 50` → frontend exibe dupla confirmação (backend não força, mas devolve flag `requires_double_confirm: true` no dry-run).
- Se `media_url` e arquivo não existe no disco → 400.

### `POST /api/campaigns/:id/pause`

Pausa campanha em execução. `running` → `paused`. Loop ignora pausadas.

### `POST /api/campaigns/:id/resume`

`paused` → `running`.

### `POST /api/campaigns/:id/cancel`

`running`/`scheduled`/`paused` → `cancelled`. Recipients pendentes são marcados `skipped`. Não reversível.

### `GET /api/campaigns/:id`

Retorna `PublicCampaign` + `funnel: CampaignFunnel`.

### `GET /api/campaigns/:id/recipients`

Lista paginada de recipients (50/page). Filtros: `status`. Útil pra ver "quem falhou e por quê".

### `DELETE /api/campaigns/:id`

**Admin only.** Apaga campanha + recipients (CASCADE). FK em conversations zera `origin_campaign_id` (SET NULL).

### `POST /api/campaigns/upload-media`

Upload de imagem via multer (memory storage, max 5MB, mime `image/jpeg|png|webp`). Salva em `/uploads/campaigns/{uuid}.{ext}`. Retorna `{ mediaUrl, mediaMime }`.

## Dispatcher (background loop)

`server/services/campaignsDispatcher.ts`:

```ts
let timer: NodeJS.Timeout | null = null;

export function startDispatcher() {
  if (timer) return;
  timer = setInterval(tick, 60_000);
  tick(); // primeira execução imediata
}

async function tick() {
  // 1. Promove scheduled → running
  await db.update(campaigns)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(campaigns.status, 'scheduled'),
      lte(campaigns.scheduledAt, new Date()),
    ));

  // 2. Pra cada running, processa N pending
  const running = await db.select().from(campaigns)
    .where(eq(campaigns.status, 'running'));

  for (const c of running) {
    await processCampaign(c);
  }
}

async function processCampaign(c: Campaign) {
  const limit = c.ratePerMinute;  // ex: 20
  const recipients = await db.select()
    .from(campaignRecipients)
    .where(and(
      eq(campaignRecipients.campaignId, c.id),
      eq(campaignRecipients.status, 'pending'),
    ))
    .limit(limit);

  if (recipients.length === 0) {
    // Tudo processado → completed
    await db.update(campaigns)
      .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(campaigns.id, c.id));
    return;
  }

  const intervalMs = 60_000 / limit;  // ex: 3000ms
  for (const r of recipients) {
    // Re-check status (cancelado/pausado entre iterações)
    const [fresh] = await db.select({ status: campaigns.status })
      .from(campaigns).where(eq(campaigns.id, c.id));
    if (fresh.status !== 'running') break;

    await sendOne(c, r);
    await sleep(intervalMs);
  }
}

async function sendOne(c: Campaign, r: CampaignRecipient) {
  try {
    // 1. Carrega lead pra interpolação
    const [lead] = await db.select().from(leads).where(eq(leads.id, r.leadId));
    const interpolated = interpolatePlaceholders(c.messageBody, lead);

    // 2. Match/cria conversation com origin_campaign_id
    const conv = await getOrCreateConversation(r.phone, lead.id, c.id);

    // 3. Chama UazAPI sendMessage (text ou media)
    const resp = c.mediaUrl
      ? await uazapiClient.sendMessage({
          to: r.phone,
          kind: 'image',
          mediaUrl: absoluteUrl(c.mediaUrl),
          mediaMime: c.mediaMime,
          text: interpolated,
        })
      : await uazapiClient.sendMessage({
          to: r.phone,
          kind: 'text',
          text: interpolated,
        });

    // 4. Insere message
    const [msg] = await db.insert(messages).values({
      conversationId: conv.id,
      direction: 'out',
      kind: c.mediaUrl ? 'image' : 'text',
      body: interpolated,
      mediaUrl: c.mediaUrl ?? null,
      mediaMime: c.mediaMime ?? null,
      sentByUserId: c.createdByUserId,
      uazapiMsgId: resp.messageId,
      rawPayload: resp.rawPayload as object,
      sentAt: new Date(),
    }).returning();

    // 5. Marca recipient sent
    await db.update(campaignRecipients).set({
      status: 'sent',
      sentAt: new Date(),
      conversationId: conv.id,
      messageId: msg.id,
      updatedAt: new Date(),
    }).where(eq(campaignRecipients.id, r.id));

    // 6. Incrementa contador agregado
    await db.update(campaigns)
      .set({ sentCount: sql`${campaigns.sentCount} + 1`, updatedAt: new Date() })
      .where(eq(campaigns.id, c.id));
  } catch (err) {
    await db.update(campaignRecipients).set({
      status: 'failed',
      failureReason: String(err).slice(0, 500),
      updatedAt: new Date(),
    }).where(eq(campaignRecipients.id, r.id));
    await db.update(campaigns)
      .set({ failedCount: sql`${campaigns.failedCount} + 1`, updatedAt: new Date() })
      .where(eq(campaigns.id, c.id));
  }
}

function interpolatePlaceholders(body: string, lead: Lead): string {
  const lastPurchase = lead.lastPurchaseDate
    ? formatDateBR(lead.lastPurchaseDate)
    : 'sem registro';
  return body
    .replaceAll('{{nome}}', lead.name)
    .replaceAll('{{telefone}}', formatPhoneBR(lead.phone))
    .replaceAll('{{placa}}', lead.vehiclePlate ?? '')
    .replaceAll('{{modelo}}', lead.vehicleModel ?? '')
    .replaceAll('{{ultima_compra}}', lastPurchase);
}

function absoluteUrl(relative: string): string {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  return `${appUrl.replace(/\/$/, '')}${relative}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
```

`server/index.ts` chama `startDispatcher()` no boot do servidor (depois do `app.listen`).

**Tratamento de race:** múltiplos servidores rodando simultaneamente processariam o mesmo recipient 2x. Mitigação simples: na query `SELECT pending`, usar `FOR UPDATE SKIP LOCKED` (Postgres advisory lock). YAGNI hoje (Lubritec single-server) — adicionar quando virar gargalo.

## Frontend

### Estrutura de arquivos

```
src/pages/campaigns/
  CampaignsPage.tsx                # /campanhas — lista paginada
  CampaignNewPage.tsx              # /campanhas/nova — wizard 4 passos
  CampaignDetailPage.tsx           # /campanhas/:id — monitoramento + funil

src/features/campaigns/
  api.ts                           # hooks TanStack Query
  helpers.ts                       # formatDate, statusLabels, etc
  types.ts                         # re-exports
  CampaignList.tsx                 # tabela na lista
  StatusBadge.tsx                  # pill de status (draft/running/etc)

  # Wizard steps
  NameStep.tsx                     # 1. nome + descrição
  AudienceStep.tsx                 # 2. filtros + opt-out + CSV
  AudiencePreviewTable.tsx         # tabela com checkboxes pra opt-out
  CsvUpload.tsx                    # upload de telefones
  MessageStep.tsx                  # 3. template + edit + placeholders + mídia
  PreviewMessage.tsx               # preview interpolado
  MediaUpload.tsx                  # upload de imagem (multer)
  ReviewStep.tsx                   # 4. revisão + agendamento

  # Detail page
  CampaignFunnel.tsx               # cards/diagrama do funil
  DispatchProgress.tsx             # barra de progresso ao vivo
  RecipientsTable.tsx              # lista paginada de recipients
```

### Lista (`/campanhas`)

Tabela paginada com colunas:
- Nome
- Status (pill colorido)
- Audiência total
- Enviadas / Total
- Respondidas (% conversão)
- Criada por · em
- Ações: clicar abre detalhe; admin tem ⋮ → "Apagar"

Filtros no topo: busca por nome, filter por status. Botão **"+ Nova campanha"** redireciona pra `/campanhas/nova`.

### Wizard (`/campanhas/nova`)

4 passos com indicador (1·2·3·4). Botões "Anterior" / "Próximo". Estado em `useState` durante o wizard; persiste só no submit final.

**Passo 1 — Nome:** input nome (obrigatório, max 120) + descrição opcional (textarea max 500). Botão Próximo.

**Passo 2 — Audiência:**
- Bloco A — **Filtros:** select multi de `status`, select multi de `source`, input numérico "Última compra há mais de [N] dias". Em cada mudança, faz `POST /campaigns/dry-run` debounced (500ms) → atualiza contador "→ 487 leads serão impactados".
- Bloco B — **Upload CSV (opcional):** componente que aceita arquivo `.csv`. Telefones extraídos (1 por linha ou coluna `phone`). Adicionados como `phoneCsv[]` no filter.
- Bloco C — **Opt-out:** botão "Ver lista" abre dialog com tabela paginada da audiência atual. Cada linha tem checkbox "incluir". Desmarcados vão pra `excludeLeadIds[]`.
- Total final mostrado: "487 leads (5 excluídos manualmente) = 482 receberão"

**Passo 3 — Mensagem:**
- Select template (lista de `message_templates`) — opcional. Selecionar preenche o textarea.
- Textarea editável (max 4000 chars). Suporta `{{nome}} {{telefone}} {{placa}} {{modelo}} {{ultima_compra}}`.
- Botão "📷 Adicionar imagem" → `MediaUpload` faz upload via multer e retorna URL.
- **Preview**: card no canto direito mostra "Como vai chegar pro lead João Silva (HB20)" com texto interpolado + imagem se houver. Dropdown pra trocar de lead de exemplo.

**Passo 4 — Revisão:**
- Resumo: nome, audiência total, mensagem, mídia.
- Toggle "Disparar agora" / "Agendar". Se agendar, datepicker + horário.
- Botão **"Disparar"** (ou **"Agendar disparo"**). Se audiência > 50, modal de dupla confirmação ("Você vai disparar pra 487 leads. Esta ação não pode ser desfeita."). Confirmar → cria via `POST /campaigns` + dispara via `POST /:id/dispatch` → redireciona pra `/campanhas/:id`.

### Detalhe (`/campanhas/:id`)

Layout:
```
┌─────────────────────────────────────────────────────┐
│ [Status badge]  Lembrete troca outubro   ⋮ menu     │
│ Criada por João · 02/05 14:30                       │
│ Disparada 02/05 16:00 · Concluída 02/05 16:42      │
├─────────────────────────────────────────────────────┤
│ Progresso (se running): ━━━━━━━━━━ 127/487 (26%)    │
│ [Pausar] [Cancelar]                                 │
├─────────────────────────────────────────────────────┤
│ Funil ROI:                                          │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│ │ 487  │→│ 64   │→│ 28   │→│ 12   │·│ 9    │       │
│ │Envio │ │Resp. │ │Negoc.│ │Ganho │ │Perdido│       │
│ │ 100% │ │ 13%  │ │  6%  │ │ 2.5% │ │ 1.8% │       │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘       │
│                                                     │
│ R$ 6.840 em vendas fechadas                         │
│ Motivos de perda: preço (5), sem retorno (3),       │
│   fora_do_perfil (1)                                │
├─────────────────────────────────────────────────────┤
│ Mensagem disparada:                                 │
│ "Olá {{nome}}, sua troca foi em {{ultima_compra}}…" │
│ [📷 imagem.jpg]                                     │
├─────────────────────────────────────────────────────┤
│ Destinatários (487):  [Filtros: status ▾]          │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Nome     │ Telefone   │ Status  │ Enviada em   │ │
│ │ João S.  │ 5511…      │ enviada │ 02/05 16:01  │ │
│ │ Maria C. │ 5511…      │ falhou  │ – (erro 4xx) │ │
│ │ ...                                              │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

Polling: 5s enquanto `running`, 30s quando `completed/cancelled`.

### Polling com TanStack Query

```ts
useCampaigns(filters)              // refetch 30s
useCampaign(id)                    // refetch adaptativo: 5s running, 30s completed
useCampaignRecipients(id, filters) // 30s
useDryRun(filters)                 // sem refetch automático
useCreateCampaign()
useDispatchCampaign()
usePauseCampaign()
useResumeCampaign()
useCancelCampaign()
useDeleteCampaign()                // só admin
useUploadMedia()                   // multipart
```

## Tracking de funil

Query consolidada em `getCampaignFunnel(campaignId)`:

```sql
WITH recipients AS (
  SELECT id, lead_id, status, sent_at FROM campaign_recipients WHERE campaign_id = $1
),
replied AS (
  SELECT DISTINCT r.lead_id FROM recipients r
  JOIN conversations c ON c.lead_id = r.lead_id
  JOIN messages m ON m.conversation_id = c.id
  WHERE r.status = 'sent'
    AND m.direction = 'in'
    AND m.sent_at > r.sent_at
),
deals_for_recipients AS (
  SELECT d.* FROM deals d JOIN recipients r ON d.lead_id = r.lead_id
)
SELECT
  COUNT(*) FILTER (WHERE status = 'sent')      AS sent,
  COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
  COUNT(*) FILTER (WHERE status = 'skipped')   AS skipped,
  (SELECT COUNT(*) FROM replied)               AS replied,
  (SELECT COUNT(*) FROM deals_for_recipients
    WHERE stage IN ('proposta_enviada','em_negociacao')) AS in_deal,
  (SELECT COUNT(*) FROM deals_for_recipients
    WHERE stage = 'ganho')                     AS won,
  (SELECT COUNT(*) FROM deals_for_recipients
    WHERE stage = 'perdido')                   AS lost,
  ...
FROM recipients;
```

Lossbreakdown via subquery `GROUP BY loss_reason`. `totalWonValue` via `SUM(proposal_value)` em deals ganhos.

## Storage de mídia

`/uploads/campaigns/` — pasta servida via Express static:

```ts
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
```

Multer config (`server/middleware/multerCampaignMedia.ts`):

```ts
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';

const dir = path.join(process.cwd(), 'uploads', 'campaigns');
fs.mkdirSync(dir, { recursive: true });

export const multerCampaignMedia = multer({
  storage: multer.diskStorage({
    destination: dir,
    filename: (_, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.bin';
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
});
```

Endpoint retorna `{ mediaUrl: '/uploads/campaigns/<hash>.jpg', mediaMime }`.

`.gitignore`:
```
/uploads/
```

## Variáveis de ambiente

`.env.example`:
```
DISPATCH_RATE_PER_MINUTE=20  # rate limit padrão
```

(Apenas seed; cada campanha pode override no campo `rate_per_minute`.)

## Testes

Atualizar `setup.ts` — TRUNCATE incluindo `campaign_recipients, campaigns`:
```ts
'TRUNCATE campaign_recipients, campaigns, deal_activities, deals, message_templates, messages, conversations, leads, sessions, auth_tokens, users, whatsapp_instance RESTART IDENTITY CASCADE'
```

Helpers: `createCampaign`, `createCampaignRecipient`.

| Arquivo | Cobertura |
|---|---|
| `campaigns-crud.test.ts` | CRUD básico, RBAC (recepção 403, comercial OK, DELETE admin only) |
| `campaigns-dry-run.test.ts` | Filtros (status, source, lastPurchaseDaysAgo), excludeLeadIds, phoneCsv merge sem duplicatas, preview 5 leads |
| `campaigns-create.test.ts` | POST cria campanha + materializa recipients via ON CONFLICT, audience_total bate, snapshot de message_body funciona |
| `campaigns-dispatch.test.ts` | POST /dispatch muda status, scheduled→running quando scheduled_at passa, pause/resume/cancel transições válidas, dispatch loop respeita rate limit (mock UazAPI) |
| `campaigns-funnel.test.ts` | Funil calcula sent/replied/inDeal/won/lost corretamente; lossByReason agrega; totalWonValue soma |
| `campaigns-media.test.ts` | Upload retorna URL válida, mime invalid 400, size > 5MB 413 |
| `campaigns-rbac.test.ts` | Cobertura específica de roles em todas as rotas |

**Mock UazAPI:** `vi.mock('../services/uazapiClient', ...)` com `sendMessage` mockada. Dispatch loop chamado direto (não via setInterval — exposed function pra testar).

**Frontend:** sem testes adicionais. Smoke manual.

Meta: ~30 testes novos.

## Estrutura do plano

Comparável aos outros sub-projetos. **~14 tasks** (escopo médio).

**Backend (~7):**
1. Migration 012 + schema + types + setup truncate + helper
2. campaignsAudience (resolve filtros, dry-run, materializa recipients)
3. campaignsService (CRUD + dispatch state transitions + funnel query)
4. campaignsDispatcher (loop + interpolatePlaceholders + sendOne) — startDispatcher chamado no boot
5. campaignsMedia (multer + upload endpoint + Express static)
6. Endpoints CRUD + RBAC + tests TDD
7. Endpoints dispatch/pause/resume/cancel + funnel + recipients + tests TDD

**Frontend (~5):**
8. api.ts + helpers + types + CampaignsPage (lista)
9. CampaignNewPage Step 1+2 (nome + audiência com dry-run)
10. Step 3 (mensagem + placeholders + media upload + preview)
11. Step 4 (revisão + agendamento + double-confirm + submit)
12. CampaignDetailPage (progresso, funil, recipients, ações pause/resume/cancel/delete)

**Encerramento (~2):**
13. Sidebar link "Campanhas" + rotas + boot do dispatcher
14. README + roadmap update + verificação final

## Performance

- Dispatch loop: 1 query a cada 60s pra promover scheduled, +1 query/campaign running, +N (rate) sends/min/campaign. Mesmo com 5 campanhas simultâneas = ~100 sends/min ≈ 2 sends/seg de DB writes. Trivial pra Postgres.
- Funnel query: ~5 subqueries com JOINs. Index em `campaign_recipients(campaign_id, status)` cobre. <50ms tipicamente.
- Upload media: 5MB por arquivo. Disco local cresce proporcional. Limpeza manual conforme campanhas antigas (sub-tarefa futura: garbage collector).

## Segurança

- `requireRole('admin', 'comercial')` em tudo, DELETE admin-only.
- Upload de mídia: apenas mime image/*, max 5MB. Nome de arquivo random (não confia em input).
- Static serving de `/uploads`: arquivos públicos por design (UazAPI precisa baixar). Nada sensível ali.
- Placeholders interpolados server-side (não confia em frontend).
- Dispatcher: re-check `campaigns.status` antes de cada send (cobre race com cancel/pause).

## Fora de escopo (futuros)

- **Drip campaigns** (mensagem 2 X dias depois sem resposta) — sub-projeto separado.
- **Campanhas recorrentes** (toda segunda 8h).
- **A/B testing** (variantes de mensagem).
- **Cost tracking** (por mensagem ou pacote).
- **Audit log de execução** (quem pausou quando).
- **Garbage collector** de imagens antigas em `/uploads`.
- **Worker isolado** (BullMQ + Redis) — quando virar gargalo.
- **Limites diários** (UazAPI ou WhatsApp) — só rate-limiter por minuto hoje.
- **Notificação ao admin** quando campanha completa/falha — só tela.

## Roadmap atualizado

1. ✅ Auth/RBAC
2. ✅ Cadastros
3. ✅ WhatsApp Inbox
4. ✅ Inside Sales
5. ✅ Conexão WhatsApp
6. **Disparo em massa de campanhas (este sub-projeto)**
7. IA de pré-qualificação
8. Dashboard de Funil — métricas e conversão
