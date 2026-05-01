# WhatsApp Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar inbox completo de WhatsApp em `/whatsapp`, com filas (IA / Recepção / Comercial), atribuição manual, composer (texto + emoji + mídia + templates) e filtros para gestão pós-disparo, conforme spec `docs/superpowers/specs/2026-05-01-whatsapp-inbox-design.md`.

**Architecture:** Backend Express com endpoints em `/api/whatsapp/*`, `/api/conversations/*` e `/api/message-templates/*`. Webhook UazAPI público (valida secret no header). REST sync ao UazAPI no envio. Mensagens em PG; mídia armazenada como URL apontando pro UazAPI (estratégia híbrida). Polling com TanStack Query (5s lista / 2.5s thread / 5s contadores). Frontend dark estilo WhatsApp Web. Migration 009 cria 3 tabelas novas (`conversations`, `messages`, `message_templates`).

**Tech Stack:** Express + Drizzle 0.45 + Zod 4 + Postgres 16; React 19 + Vite + TanStack Query 5 + shadcn/ui + react-hook-form + sonner.

---

## File map

**Criar — backend:**
- `server/db/migrations/009_whatsapp.sql`
- `server/services/uazapiClient.ts`
- `server/services/conversationsService.ts`
- `server/services/whatsappWebhookService.ts`
- `server/services/messageTemplatesService.ts`
- `server/controllers/whatsappWebhookController.ts`
- `server/controllers/conversationsController.ts`
- `server/controllers/messageTemplatesController.ts`
- `server/routes/whatsapp.ts`
- `server/routes/conversations.ts`
- `server/routes/messageTemplates.ts`
- `server/lib/uazapiSchema.ts`
- `server/tests/whatsapp-webhook.test.ts`
- `server/tests/conversations-list.test.ts`
- `server/tests/conversations-actions.test.ts`
- `server/tests/conversations-send.test.ts`
- `server/tests/message-templates.test.ts`
- `server/tests/fixtures/uazapi-inbound-text.json`
- `server/tests/fixtures/uazapi-inbound-image.json`

**Criar — frontend:**
- `src/features/whatsapp/api.ts`
- `src/features/whatsapp/helpers.ts`
- `src/features/whatsapp/types.ts`
- `src/features/whatsapp/QueueTabs.tsx`
- `src/features/whatsapp/FilterBar.tsx`
- `src/features/whatsapp/ConversationList.tsx`
- `src/features/whatsapp/ConversationRow.tsx`
- `src/features/whatsapp/Thread.tsx`
- `src/features/whatsapp/MessageBubble.tsx`
- `src/features/whatsapp/DayDivider.tsx`
- `src/features/whatsapp/Composer.tsx`
- `src/features/whatsapp/EmojiPicker.tsx`
- `src/features/whatsapp/TemplatePicker.tsx`
- `src/features/whatsapp/MediaUpload.tsx`
- `src/features/whatsapp/LeadSidebar.tsx`
- `src/features/whatsapp/ChatHeader.tsx`

**Modificar:**
- `shared/types.ts` — adicionar `CONVERSATION_QUEUES`, `CONVERSATION_STATUSES`, `MESSAGE_DIRECTIONS`, `MESSAGE_KINDS`, `ORIGIN_KINDS`, `PublicConversation`, `PublicMessage`, `PublicMessageTemplate`, `ConversationCounts`, `ConversationFilters`
- `server/db/schema.ts` — adicionar tabelas `conversations`, `messages`, `messageTemplates`
- `server/app.ts` — registrar `whatsappRoutes`, `conversationRoutes`, `messageTemplateRoutes`
- `server/tests/setup.ts` — incluir tabelas novas no TRUNCATE
- `server/tests/helpers.ts` — adicionar `createConversation`, `createMessage`, `createMessageTemplate`
- `.env.example` — adicionar `UAZAPI_BASE_URL`, `UAZAPI_TOKEN`, `UAZAPI_INSTANCE_ID`, `UAZAPI_WEBHOOK_SECRET`, `NO_RESPONSE_DAYS`
- `src/pages/whatsapp/WhatsappPage.tsx` — substituir placeholder pelo shell de 3 colunas
- `README.md` — marcar item 4 do roadmap, adicionar seção "WhatsApp Inbox"

---

## Task 1 — Migration 009, schema, tipos compartilhados, setup de teste

**Files:**
- Create: `server/db/migrations/009_whatsapp.sql`
- Modify: `shared/types.ts`
- Modify: `server/db/schema.ts`
- Modify: `server/tests/setup.ts`
- Modify: `.env.example`

- [ ] **Step 1.1:** Criar migration `server/db/migrations/009_whatsapp.sql`:

```sql
-- Enums
CREATE TYPE conversation_queue AS ENUM ('ia', 'recepcao', 'comercial');
CREATE TYPE conversation_status AS ENUM (
  'aguardando_atendimento',
  'em_atendimento',
  'encerrada'
);
CREATE TYPE message_direction AS ENUM ('in', 'out');
CREATE TYPE message_kind AS ENUM ('text', 'image', 'audio', 'video', 'document', 'unknown');

-- Conversations
CREATE TABLE conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone               text NOT NULL UNIQUE,
  lead_id             uuid NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  queue               conversation_queue NOT NULL DEFAULT 'recepcao',
  status              conversation_status NOT NULL DEFAULT 'aguardando_atendimento',
  assigned_to         uuid REFERENCES users(id) ON DELETE SET NULL,
  origin_kind         text NOT NULL DEFAULT 'organic'
                      CHECK (origin_kind IN ('organic', 'campaign')),
  origin_campaign_id  uuid,
  last_message_at     timestamptz NOT NULL DEFAULT now(),
  last_inbound_at     timestamptz,
  unread_count        int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conv_queue_status_lastmsg
  ON conversations(queue, status, last_message_at DESC);
CREATE INDEX idx_conv_assigned
  ON conversations(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_conv_origin
  ON conversations(origin_kind, origin_campaign_id);
CREATE INDEX idx_conv_last_inbound
  ON conversations(last_inbound_at) WHERE status != 'encerrada';

-- Messages
CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction       message_direction NOT NULL,
  kind            message_kind NOT NULL DEFAULT 'text',
  body            text,
  media_url       text,
  media_mime      text,
  sent_by_user_id uuid REFERENCES users(id),
  uazapi_msg_id   text UNIQUE,
  raw_payload     jsonb NOT NULL,
  sent_at         timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_msg_conv_sent ON messages(conversation_id, sent_at DESC);

-- Message templates (composer)
CREATE TABLE message_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 1.2:** Aplicar migration nos dois schemas.

```bash
npm run migrate
NODE_ENV=test npm run migrate
```

Esperado: `→ 009_whatsapp.sql (applied)` em ambos os runs.

- [ ] **Step 1.3:** Adicionar constantes e tipos em `shared/types.ts`. Adicionar **no fim do arquivo**:

```ts
// ---------------------------------------------------------------------------
// WhatsApp Inbox (sub-projeto 4)
// ---------------------------------------------------------------------------

export const CONVERSATION_QUEUES = ['ia', 'recepcao', 'comercial'] as const;
export type ConversationQueue = (typeof CONVERSATION_QUEUES)[number];

export const CONVERSATION_STATUSES = [
  'aguardando_atendimento',
  'em_atendimento',
  'encerrada',
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ['in', 'out'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_KINDS = [
  'text', 'image', 'audio', 'video', 'document', 'unknown',
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const ORIGIN_KINDS = ['organic', 'campaign'] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

export interface PublicConversation {
  id: string;
  phone: string;
  lead: {
    id: string;
    name: string;
    vehiclePlate: string | null;
    vehicleModel: string | null;
    status: LeadStatus;
  };
  queue: ConversationQueue;
  status: ConversationStatus;
  assignedTo: { id: string; name: string } | null;
  originKind: OriginKind;
  originCampaignId: string | null;
  lastMessagePreview: string;
  lastMessageDirection: MessageDirection | null;
  lastMessageAt: string;
  lastInboundAt: string | null;
  unreadCount: number;
  isExpired24h: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicMessage {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  kind: MessageKind;
  body: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  sentByUser: { id: string; name: string } | null;
  sentAt: string;
}

export interface PublicMessageTemplate {
  id: string;
  title: string;
  body: string;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface ConversationCounts {
  ia: number;
  recepcao: number;
  comercial: number;
}

export interface ConversationFilters {
  queue?: ConversationQueue;
  status?: ConversationStatus[];
  expired24h?: boolean;
  noResponse?: boolean;
  origin?: OriginKind[];
  campaignId?: string;
  assignment?: 'mine' | 'unassigned' | 'all';
  q?: string;
  page?: number;
}
```

- [ ] **Step 1.4:** Atualizar `server/db/schema.ts`. Substituir o conteúdo todo por (mantém o que já existe + acrescenta tabelas novas):

```ts
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  date,
  integer,
  inet,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import {
  ROLES,
  LEAD_STATUSES,
  LEAD_SOURCES,
  CONVERSATION_QUEUES,
  CONVERSATION_STATUSES,
  MESSAGE_DIRECTIONS,
  MESSAGE_KINDS,
  ORIGIN_KINDS,
} from '../../shared/types';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    role: text('role', { enum: ROLES }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ emailIdx: index('idx_users_email').on(t.email) }),
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    purpose: text('purpose', { enum: ['invite', 'password_reset'] }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('idx_auth_tokens_user').on(t.userId) }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    ipAddress: inet('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('idx_sessions_user').on(t.userId) }),
);

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  phone: text('phone').notNull().unique(),
  email: text('email'),
  notes: text('notes'),
  vehiclePlate: text('vehicle_plate'),
  vehicleModel: text('vehicle_model'),
  lastPurchaseDate: date('last_purchase_date'),
  avgMileagePerDay: integer('avg_mileage_per_day').default(50),
  status: text('status', { enum: LEAD_STATUSES }).notNull().default('frio'),
  source: text('source', { enum: LEAD_SOURCES }).notNull().default('manual'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull().unique(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'restrict' }),
  queue: text('queue', { enum: CONVERSATION_QUEUES }).notNull().default('recepcao'),
  status: text('status', { enum: CONVERSATION_STATUSES }).notNull().default('aguardando_atendimento'),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  originKind: text('origin_kind', { enum: ORIGIN_KINDS }).notNull().default('organic'),
  originCampaignId: uuid('origin_campaign_id'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  unreadCount: integer('unread_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  direction: text('direction', { enum: MESSAGE_DIRECTIONS }).notNull(),
  kind: text('kind', { enum: MESSAGE_KINDS }).notNull().default('text'),
  body: text('body'),
  mediaUrl: text('media_url'),
  mediaMime: text('media_mime'),
  sentByUserId: uuid('sent_by_user_id').references(() => users.id),
  uazapiMsgId: text('uazapi_msg_id').unique(),
  rawPayload: jsonb('raw_payload').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messageTemplates = pgTable('message_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuthToken = typeof authTokens.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;
export type AuthTokenPurpose = 'invite' | 'password_reset';
```

- [ ] **Step 1.5:** Atualizar `server/tests/setup.ts` — incluir as 3 tabelas novas no TRUNCATE. Substituir a linha `await pool.query('TRUNCATE leads, sessions, auth_tokens, users RESTART IDENTITY CASCADE');` por:

```ts
await pool.query(
  'TRUNCATE message_templates, messages, conversations, leads, sessions, auth_tokens, users RESTART IDENTITY CASCADE',
);
```

A ordem importa pra FK cascade — tabelas filhas antes das pais.

- [ ] **Step 1.6:** Adicionar variáveis em `.env.example`. Anexar no fim:

```
# WhatsApp / UazAPI
UAZAPI_BASE_URL=https://api.uazapi.com
UAZAPI_TOKEN=
UAZAPI_INSTANCE_ID=
UAZAPI_WEBHOOK_SECRET=
NO_RESPONSE_DAYS=7
```

- [ ] **Step 1.7:** Verificar lint.

```bash
npm run lint
```

Esperado: sai limpo.

- [ ] **Step 1.8:** Commit.

```bash
git add server/db/migrations/009_whatsapp.sql shared/types.ts server/db/schema.ts server/tests/setup.ts .env.example
git commit -m "feat(whatsapp): migration 009 + schema + shared types"
```

---

## Task 2 — Test helpers (createConversation, createMessage, createMessageTemplate)

**Files:**
- Modify: `server/tests/helpers.ts`

- [ ] **Step 2.1:** Adicionar imports e helpers no fim de `server/tests/helpers.ts`. **Não remover** o que já existe; adicionar:

```ts
import { conversations, messages, messageTemplates } from '../db/schema';
import type {
  ConversationQueue,
  ConversationStatus,
  MessageDirection,
  MessageKind,
  OriginKind,
} from '@shared/types';

let _convPhoneSeq = 0;

export async function createConversation(opts: {
  phone?: string;
  leadId: string;
  queue?: ConversationQueue;
  status?: ConversationStatus;
  assignedTo?: string | null;
  originKind?: OriginKind;
  originCampaignId?: string | null;
  lastMessageAt?: Date;
  lastInboundAt?: Date | null;
  unreadCount?: number;
}) {
  const [c] = await db
    .insert(conversations)
    .values({
      phone: opts.phone ?? `5511${String(++_convPhoneSeq).padStart(8, '0')}`,
      leadId: opts.leadId,
      queue: opts.queue ?? 'recepcao',
      status: opts.status ?? 'aguardando_atendimento',
      assignedTo: opts.assignedTo ?? null,
      originKind: opts.originKind ?? 'organic',
      originCampaignId: opts.originCampaignId ?? null,
      lastMessageAt: opts.lastMessageAt ?? new Date(),
      lastInboundAt: opts.lastInboundAt ?? null,
      unreadCount: opts.unreadCount ?? 0,
    })
    .returning();
  return c;
}

let _msgIdSeq = 0;

export async function createMessage(opts: {
  conversationId: string;
  direction?: MessageDirection;
  kind?: MessageKind;
  body?: string | null;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  sentByUserId?: string | null;
  uazapiMsgId?: string | null;
  rawPayload?: unknown;
  sentAt?: Date;
}) {
  const [m] = await db
    .insert(messages)
    .values({
      conversationId: opts.conversationId,
      direction: opts.direction ?? 'in',
      kind: opts.kind ?? 'text',
      body: opts.body ?? 'mensagem de teste',
      mediaUrl: opts.mediaUrl ?? null,
      mediaMime: opts.mediaMime ?? null,
      sentByUserId: opts.sentByUserId ?? null,
      uazapiMsgId: opts.uazapiMsgId ?? `test-msg-${++_msgIdSeq}-${Date.now()}`,
      rawPayload: opts.rawPayload ?? {},
      sentAt: opts.sentAt ?? new Date(),
    })
    .returning();
  return m;
}

export async function createMessageTemplate(opts: {
  title?: string;
  body?: string;
  createdBy: string;
}) {
  const [t] = await db
    .insert(messageTemplates)
    .values({
      title: opts.title ?? 'Template Teste',
      body: opts.body ?? 'Olá, como posso ajudar?',
      createdBy: opts.createdBy,
    })
    .returning();
  return t;
}
```

- [ ] **Step 2.2:** Verificar lint e que o módulo carrega.

```bash
npm run lint
```

- [ ] **Step 2.3:** Commit.

```bash
git add server/tests/helpers.ts
git commit -m "test(whatsapp): add createConversation/Message/Template helpers"
```

---

## Task 3 — Cliente UazAPI (server/services/uazapiClient.ts)

**Files:**
- Create: `server/services/uazapiClient.ts`

- [ ] **Step 3.1:** Criar `server/services/uazapiClient.ts`:

```ts
import type { MessageKind } from '@shared/types';

export class UazapiError extends Error {
  constructor(public status: number, public body: string) {
    super(`UazAPI error ${status}: ${body}`);
  }
}

export interface SendMessageOpts {
  to: string;                                // telefone destino, só dígitos
  kind: MessageKind;
  text?: string;                             // obrigatório para kind='text'
  mediaUrl?: string;                         // obrigatório para kinds de mídia
  mediaMime?: string;
}

export interface UazapiSendResponse {
  messageId: string;                         // ID da mensagem no UazAPI
  rawPayload: unknown;                       // payload completo retornado
}

class UazapiClient {
  private get base() { return process.env.UAZAPI_BASE_URL ?? ''; }
  private get token() { return process.env.UAZAPI_TOKEN ?? ''; }
  private get instanceId() { return process.env.UAZAPI_INSTANCE_ID ?? ''; }

  async sendMessage(opts: SendMessageOpts): Promise<UazapiSendResponse> {
    const endpoint = opts.kind === 'text'
      ? '/v1/messages/text'
      : '/v1/messages/media';

    const body: Record<string, unknown> = {
      instance_id: this.instanceId,
      to: opts.to,
    };
    if (opts.kind === 'text') {
      body.text = opts.text;
    } else {
      body.media_url = opts.mediaUrl;
      body.media_mime = opts.mediaMime;
      body.kind = opts.kind;
      if (opts.text) body.caption = opts.text;
    }

    const res = await fetch(`${this.base}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new UazapiError(res.status, text);
    }

    const json = await res.json();
    // Esperamos um id de mensagem; se não vier, tentamos campos comuns.
    const messageId =
      (json?.messageId as string | undefined) ??
      (json?.id as string | undefined) ??
      (json?.data?.id as string | undefined);
    if (!messageId) {
      throw new UazapiError(500, `Missing messageId in response: ${JSON.stringify(json)}`);
    }
    return { messageId, rawPayload: json };
  }
}

export const uazapiClient = new UazapiClient();
```

- [ ] **Step 3.2:** Verificar lint.

```bash
npm run lint
```

Esperado: sai limpo.

- [ ] **Step 3.3:** Commit.

```bash
git add server/services/uazapiClient.ts
git commit -m "feat(whatsapp): UazAPI client (sendMessage)"
```

---

## Task 4 — Schema Zod do payload UazAPI + fixtures

**Files:**
- Create: `server/lib/uazapiSchema.ts`
- Create: `server/tests/fixtures/uazapi-inbound-text.json`
- Create: `server/tests/fixtures/uazapi-inbound-image.json`

- [ ] **Step 4.1:** Criar `server/lib/uazapiSchema.ts`. **Importante:** O schema é defensivo — só validamos os campos que usamos, o resto cai em `passthrough()`.

```ts
import { z } from 'zod';

// Schema do payload de webhook do UazAPI.
// Conservador: aceitamos eventos não-mensagem com .passthrough() e ignoramos.
export const uazapiInboundSchema = z
  .object({
    event: z.string(),                         // ex: 'message.received'
    instance_id: z.string().optional(),
    message: z
      .object({
        id: z.string(),                        // ID único — usado para idempotência
        from: z.string(),                      // telefone remetente (formato livre)
        type: z
          .enum(['text', 'image', 'audio', 'video', 'document'])
          .or(z.string()),                     // string fallback
        text: z.string().nullish(),
        media_url: z.string().nullish(),
        mimetype: z.string().nullish(),
        timestamp: z
          .union([z.string(), z.number()])
          .transform((v) => {
            // UazAPI manda ou ISO string, ou epoch ms, ou epoch s.
            if (typeof v === 'number') {
              return new Date(v < 1e12 ? v * 1000 : v);
            }
            return new Date(v);
          }),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type UazapiInbound = z.infer<typeof uazapiInboundSchema>;
```

- [ ] **Step 4.2:** Criar fixture `server/tests/fixtures/uazapi-inbound-text.json`:

```json
{
  "event": "message.received",
  "instance_id": "lubritec-prod",
  "message": {
    "id": "ABCD-1234-EFGH",
    "from": "5511987654321",
    "type": "text",
    "text": "Oi, quero saber o preço da troca de óleo do meu Civic 2018",
    "timestamp": "2026-05-01T14:30:00Z"
  }
}
```

- [ ] **Step 4.3:** Criar fixture `server/tests/fixtures/uazapi-inbound-image.json`:

```json
{
  "event": "message.received",
  "instance_id": "lubritec-prod",
  "message": {
    "id": "WXYZ-9876-MNOP",
    "from": "5511987654321",
    "type": "image",
    "media_url": "https://uazapi-cdn.example.com/media/abc123.jpg",
    "mimetype": "image/jpeg",
    "timestamp": "2026-05-01T14:35:00Z"
  }
}
```

- [ ] **Step 4.4:** Verificar lint.

```bash
npm run lint
```

- [ ] **Step 4.5:** Commit.

```bash
git add server/lib/uazapiSchema.ts server/tests/fixtures/uazapi-inbound-text.json server/tests/fixtures/uazapi-inbound-image.json
git commit -m "feat(whatsapp): UazAPI inbound payload schema + fixtures"
```

---

## Task 5 — Webhook handler + service (TDD)

**Files:**
- Create: `server/services/whatsappWebhookService.ts`
- Create: `server/controllers/whatsappWebhookController.ts`
- Create: `server/routes/whatsapp.ts`
- Create: `server/tests/whatsapp-webhook.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 5.1:** Escrever os testes ANTES da implementação. Criar `server/tests/whatsapp-webhook.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../app';
import { db } from '../db/client';
import { conversations, messages, leads } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createConversation, createLead } from './helpers';

const app = createApp();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SECRET = 'test-webhook-secret';
const textFixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures/uazapi-inbound-text.json'), 'utf8'),
);
const imageFixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'fixtures/uazapi-inbound-image.json'), 'utf8'),
);

beforeEach(() => {
  process.env.UAZAPI_WEBHOOK_SECRET = SECRET;
});

describe('POST /api/whatsapp/webhook', () => {
  it('401 sem header X-Webhook-Token', async () => {
    const res = await request(app).post('/api/whatsapp/webhook').send(textFixture);
    expect(res.status).toBe(401);
  });

  it('401 com header errado', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', 'wrong')
      .send(textFixture);
    expect(res.status).toBe(401);
  });

  it('200 + ignora eventos não-mensagem', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send({ event: 'status.update', message: null });
    expect(res.status).toBe(200);
  });

  it('cria lead novo se telefone não bate', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(textFixture);
    expect(res.status).toBe(200);

    const [lead] = await db.select().from(leads).where(eq(leads.phone, '5511987654321'));
    expect(lead).toBeDefined();
    expect(lead.source).toBe('whatsapp');
    expect(lead.name).toBe('5511987654321');
  });

  it('vincula a lead existente sem criar duplicata', async () => {
    await createLead({ phone: '5511987654321', name: 'João Existente' });

    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(textFixture);
    expect(res.status).toBe(200);

    const all = await db.select().from(leads).where(eq(leads.phone, '5511987654321'));
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('João Existente');
  });

  it('cria conversation com queue=recepcao e status=aguardando_atendimento', async () => {
    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(textFixture);

    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, '5511987654321'));
    expect(conv.queue).toBe('recepcao');
    expect(conv.status).toBe('aguardando_atendimento');
    expect(conv.originKind).toBe('organic');
    expect(conv.unreadCount).toBe(1);
    expect(conv.lastInboundAt).not.toBeNull();
  });

  it('insere mensagem com direction=in, body, raw_payload', async () => {
    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(textFixture);

    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, '5511987654321'));
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].direction).toBe('in');
    expect(msgs[0].kind).toBe('text');
    expect(msgs[0].body).toMatch(/Civic/);
    expect(msgs[0].uazapiMsgId).toBe('ABCD-1234-EFGH');
  });

  it('idempotência: webhook duplicado é no-op', async () => {
    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(textFixture);
    const r2 = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(textFixture);
    expect(r2.status).toBe(200);

    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, '5511987654321'));
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(msgs).toHaveLength(1);
    expect(conv.unreadCount).toBe(1);
  });

  it('reabre conversa encerrada quando cliente manda nova msg', async () => {
    const lead = await createLead({ phone: '5511987654321' });
    await createConversation({
      phone: '5511987654321',
      leadId: lead.id,
      status: 'encerrada',
    });

    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(textFixture);

    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, '5511987654321'));
    expect(conv.status).toBe('aguardando_atendimento');
    expect(conv.unreadCount).toBe(1);
  });

  it('mensagem com mídia: kind=image, mediaUrl preenchido, body null', async () => {
    await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', SECRET)
      .send(imageFixture);

    const [conv] = await db.select().from(conversations).where(eq(conversations.phone, '5511987654321'));
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(msgs[0].kind).toBe('image');
    expect(msgs[0].mediaUrl).toBe('https://uazapi-cdn.example.com/media/abc123.jpg');
    expect(msgs[0].mediaMime).toBe('image/jpeg');
    expect(msgs[0].body).toBeNull();
  });
});
```

- [ ] **Step 5.2:** Rodar os testes pra confirmar que TODOS falham (rotas/handlers ainda não existem).

```bash
npm test -- server/tests/whatsapp-webhook.test.ts
```

Esperado: todos os testes falham com 404 ou similar (rota não registrada).

- [ ] **Step 5.3:** Implementar `server/services/whatsappWebhookService.ts`:

```ts
import { db } from '../db/client';
import { conversations, messages, leads } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { UazapiInbound } from '../lib/uazapiSchema';
import type { MessageKind } from '@shared/types';

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

function detectKind(type: string | undefined): MessageKind {
  switch (type) {
    case 'text': return 'text';
    case 'image': return 'image';
    case 'audio': return 'audio';
    case 'video': return 'video';
    case 'document': return 'document';
    default: return 'unknown';
  }
}

export async function ingestInbound(
  payload: UazapiInbound,
  rawPayload: unknown,
): Promise<{ status: 'inserted' | 'duplicate' | 'ignored' }> {
  if (payload.event !== 'message.received' || !payload.message) {
    return { status: 'ignored' };
  }
  const m = payload.message;

  // Idempotência por uazapi_msg_id
  const existing = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.uazapiMsgId, m.id))
    .limit(1);
  if (existing.length) return { status: 'duplicate' };

  const phone = normalizePhone(m.from);
  const sentAt = m.timestamp;
  const kind = detectKind(typeof m.type === 'string' ? m.type : undefined);

  await db.transaction(async (tx) => {
    // 1. Match ou cria lead. Em caso de race (UNIQUE violation), refaz a query.
    let leadId: string;
    const found = await tx.select({ id: leads.id }).from(leads).where(eq(leads.phone, phone)).limit(1);
    if (found.length) {
      leadId = found[0].id;
    } else {
      try {
        const [created] = await tx
          .insert(leads)
          .values({ name: phone, phone, source: 'whatsapp', status: 'frio' })
          .returning({ id: leads.id });
        leadId = created.id;
      } catch (err) {
        // Race: outra request criou simultaneamente. Refaz a query.
        const pgErr = ((err as { cause?: unknown })?.cause ?? err) as { code?: string };
        if (pgErr?.code === '23505') {
          const retry = await tx.select({ id: leads.id }).from(leads).where(eq(leads.phone, phone)).limit(1);
          if (!retry.length) throw err;
          leadId = retry[0].id;
        } else {
          throw err;
        }
      }
    }

    // 2. Upsert conversation
    const existingConv = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.phone, phone))
      .limit(1);

    let conversationId: string;
    if (existingConv.length === 0) {
      const [created] = await tx
        .insert(conversations)
        .values({
          phone,
          leadId,
          queue: 'recepcao',
          status: 'aguardando_atendimento',
          originKind: 'organic',
          lastMessageAt: sentAt,
          lastInboundAt: sentAt,
          unreadCount: 1,
        })
        .returning({ id: conversations.id });
      conversationId = created.id;
    } else {
      const c = existingConv[0];
      conversationId = c.id;
      const newStatus =
        c.status === 'encerrada' ? 'aguardando_atendimento' as const : c.status;
      await tx
        .update(conversations)
        .set({
          status: newStatus,
          lastMessageAt: sentAt,
          lastInboundAt: sentAt,
          unreadCount: sql`${conversations.unreadCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, c.id));
    }

    // 3. Insert message
    await tx.insert(messages).values({
      conversationId,
      direction: 'in',
      kind,
      body: kind === 'text' ? (m.text ?? null) : null,
      mediaUrl: m.media_url ?? null,
      mediaMime: m.mimetype ?? null,
      uazapiMsgId: m.id,
      rawPayload: rawPayload as object,
      sentAt,
    });
  });

  return { status: 'inserted' };
}
```

- [ ] **Step 5.4:** Implementar `server/controllers/whatsappWebhookController.ts`:

```ts
import type { Request, Response, NextFunction } from 'express';
import { uazapiInboundSchema } from '../lib/uazapiSchema';
import { ingestInbound } from '../services/whatsappWebhookService';

export async function whatsappWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const expected = process.env.UAZAPI_WEBHOOK_SECRET;
    if (!expected) {
      // Sem secret configurado, tratamos qualquer chamada como inválida.
      return res.status(401).json({ error: 'Webhook secret not configured' });
    }
    const got = req.header('X-Webhook-Token');
    if (got !== expected) {
      return res.status(401).json({ error: 'Invalid webhook token' });
    }

    const parsed = uazapiInboundSchema.safeParse(req.body);
    if (!parsed.success) {
      // Payload inválido — UazAPI não vai conseguir corrigir, então 200 silencioso.
      return res.status(200).end();
    }
    await ingestInbound(parsed.data, req.body);
    return res.status(200).end();
  } catch (e) {
    next(e);
  }
}
```

- [ ] **Step 5.5:** Criar `server/routes/whatsapp.ts`:

```ts
import { Router } from 'express';
import { whatsappWebhookHandler } from '../controllers/whatsappWebhookController';

const router = Router();

// Webhook é PÚBLICO — autenticação é via secret no header.
router.post('/webhook', whatsappWebhookHandler);

export default router;
```

- [ ] **Step 5.6:** Registrar a rota em `server/app.ts`. Adicionar `import whatsappRoutes from './routes/whatsapp';` no topo (junto com os outros imports). Adicionar `app.use('/api/whatsapp', whatsappRoutes);` antes do `app.use('/api', ...)` 404 fallback.

```ts
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import leadRoutes from './routes/leads';
import whatsappRoutes from './routes/whatsapp';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  const corsOrigin = process.env.APP_URL;
  if (process.env.NODE_ENV === 'production' && !corsOrigin) {
    throw new Error('APP_URL must be set in production');
  }
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/whatsapp', whatsappRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 5.7:** Rodar testes — todos devem passar agora.

```bash
npm test -- server/tests/whatsapp-webhook.test.ts
```

Esperado: 10/10 passando.

- [ ] **Step 5.8:** Verificar lint.

```bash
npm run lint
```

- [ ] **Step 5.9:** Commit.

```bash
git add server/services/whatsappWebhookService.ts server/controllers/whatsappWebhookController.ts server/routes/whatsapp.ts server/tests/whatsapp-webhook.test.ts server/app.ts
git commit -m "feat(whatsapp): inbound webhook handler with idempotency and reopening"
```

---

## Task 6 — ConversationsService: list, get, counts (TDD)

**Files:**
- Create: `server/services/conversationsService.ts`
- Create: `server/controllers/conversationsController.ts`
- Create: `server/routes/conversations.ts`
- Create: `server/tests/conversations-list.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 6.1:** Escrever os testes ANTES — `server/tests/conversations-list.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createConversation, createMessage } from './helpers';

const app = createApp();

async function loginAs(email: string, password = 'pw12345') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

async function seedAuth() {
  await createUser({ email: 'r@x.com', password: 'pw12345', role: 'recepcao' });
  return loginAs('r@x.com');
}

describe('GET /api/conversations', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/conversations');
    expect(res.status).toBe(401);
  });

  it('200 lista paginada', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010001' });
    const c = await createConversation({ phone: '11000010001', leadId: lead.id });
    await createMessage({ conversationId: c.id, body: 'oi' });

    const res = await request(app).get('/api/conversations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.pageSize).toBe(50);
  });

  it('filtra por queue', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010002' });
    await createConversation({ phone: '11000010002', leadId: lead.id, queue: 'comercial' });
    const lead2 = await createLead({ phone: '11000010003' });
    await createConversation({ phone: '11000010003', leadId: lead2.id, queue: 'recepcao' });

    const res = await request(app)
      .get('/api/conversations?queue=comercial')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].queue).toBe('comercial');
  });

  it('filtra por status (CSV multi-valor)', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010010' });
    await createConversation({ phone: '11000010010', leadId: lead.id, status: 'em_atendimento' });
    const lead2 = await createLead({ phone: '11000010011' });
    await createConversation({ phone: '11000010011', leadId: lead2.id, status: 'encerrada' });

    const res = await request(app)
      .get('/api/conversations?status=em_atendimento,aguardando_atendimento')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.every((c: { status: string }) =>
      ['em_atendimento', 'aguardando_atendimento'].includes(c.status))).toBe(true);
  });

  it('filtra por expired24h', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010020' });
    await createConversation({
      phone: '11000010020',
      leadId: lead.id,
      lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const lead2 = await createLead({ phone: '11000010021' });
    await createConversation({
      phone: '11000010021',
      leadId: lead2.id,
      lastInboundAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .get('/api/conversations?expired24h=true')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].phone).toBe('11000010020');
  });

  it('filtra por noResponse (campanha sem msg in há mais de 7 dias)', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010030' });
    await createConversation({
      phone: '11000010030',
      leadId: lead.id,
      originKind: 'campaign',
      originCampaignId: '00000000-0000-0000-0000-000000000001',
      lastInboundAt: null,
      lastMessageAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .get('/api/conversations?noResponse=true')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((c: { phone: string }) => c.phone === '11000010030')).toBe(true);
  });

  it('filtra por assignment=mine', async () => {
    const u = await createUser({ email: 'mine@x.com', password: 'pw12345', role: 'recepcao' });
    const token = await loginAs('mine@x.com');

    const lead = await createLead({ phone: '11000010040' });
    await createConversation({ phone: '11000010040', leadId: lead.id, assignedTo: u.id });
    const lead2 = await createLead({ phone: '11000010041' });
    await createConversation({ phone: '11000010041', leadId: lead2.id, assignedTo: null });

    const res = await request(app)
      .get('/api/conversations?assignment=mine')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].phone).toBe('11000010040');
  });

  it('filtra por busca de texto (nome do lead, telefone)', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010050', name: 'João Silva' });
    await createConversation({ phone: '11000010050', leadId: lead.id });

    const res = await request(app)
      .get('/api/conversations?q=Silva')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.some((c: { lead: { name: string } }) => c.lead.name.includes('Silva'))).toBe(true);
  });

  it('inclui lastMessagePreview e lead expandido', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000010060', name: 'Maria' });
    const c = await createConversation({ phone: '11000010060', leadId: lead.id });
    await createMessage({ conversationId: c.id, body: 'última mensagem aqui', direction: 'in' });

    const res = await request(app).get('/api/conversations').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const item = res.body.items.find((it: { phone: string }) => it.phone === '11000010060');
    expect(item.lead.name).toBe('Maria');
    expect(item.lastMessagePreview).toBe('última mensagem aqui');
    expect(item.lastMessageDirection).toBe('in');
  });
});

describe('GET /api/conversations/counts', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/conversations/counts');
    expect(res.status).toBe(401);
  });

  it('retorna contadores por fila excluindo encerradas', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000020001' });
    await createConversation({ phone: '11000020001', leadId: lead.id, queue: 'recepcao' });
    const lead2 = await createLead({ phone: '11000020002' });
    await createConversation({ phone: '11000020002', leadId: lead2.id, queue: 'comercial' });
    const lead3 = await createLead({ phone: '11000020003' });
    await createConversation({ phone: '11000020003', leadId: lead3.id, queue: 'recepcao', status: 'encerrada' });

    const res = await request(app).get('/api/conversations/counts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ia: 0, recepcao: 1, comercial: 1 });
  });
});
```

- [ ] **Step 6.2:** Rodar testes — confirmar que falham.

```bash
npm test -- server/tests/conversations-list.test.ts
```

Esperado: todos falham (404 ou rota inexistente).

- [ ] **Step 6.3:** Implementar `server/services/conversationsService.ts`:

```ts
import { db } from '../db/client';
import { conversations, messages, leads, users } from '../db/schema';
import { eq, and, or, ilike, desc, sql, isNull, lt, gte, inArray, type SQL } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type {
  PublicConversation,
  ConversationCounts,
  ConversationFilters,
} from '@shared/types';

const PAGE_SIZE = 50;
const NO_RESPONSE_DAYS = Number(process.env.NO_RESPONSE_DAYS ?? '7');

function previewFromMessage(row: {
  body: string | null;
  kind: string;
} | null): string {
  if (!row) return '';
  if (row.kind !== 'text') {
    const labels: Record<string, string> = {
      image: '[imagem]',
      audio: '[áudio]',
      video: '[vídeo]',
      document: '[documento]',
      unknown: '[mídia]',
    };
    return labels[row.kind] ?? '[mídia]';
  }
  const body = row.body ?? '';
  return body.length > 80 ? `${body.slice(0, 80)}…` : body;
}

function isExpired24h(lastInboundAt: Date | null, status: string): boolean {
  if (status === 'encerrada' || !lastInboundAt) return false;
  return Date.now() - lastInboundAt.getTime() > 24 * 60 * 60 * 1000;
}

interface ListInput extends ConversationFilters {
  currentUserId: string;
}

export async function listConversations(input: ListInput): Promise<{
  items: PublicConversation[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, input.page ?? 1);
  const conds: SQL[] = [];

  if (input.queue) conds.push(eq(conversations.queue, input.queue));
  if (input.status?.length) conds.push(inArray(conversations.status, input.status));
  if (input.expired24h) {
    conds.push(sql`${conversations.status} != 'encerrada'`);
    conds.push(sql`${conversations.lastInboundAt} < now() - interval '24 hours'`);
    conds.push(sql`${conversations.lastInboundAt} IS NOT NULL`);
  }
  if (input.noResponse) {
    conds.push(eq(conversations.originKind, 'campaign'));
    conds.push(isNull(conversations.lastInboundAt));
    conds.push(sql`${conversations.createdAt} < now() - interval '${sql.raw(String(NO_RESPONSE_DAYS))} days'`);
  }
  if (input.origin?.length) conds.push(inArray(conversations.originKind, input.origin));
  if (input.campaignId) conds.push(eq(conversations.originCampaignId, input.campaignId));
  if (input.assignment === 'mine') conds.push(eq(conversations.assignedTo, input.currentUserId));
  if (input.assignment === 'unassigned') conds.push(isNull(conversations.assignedTo));

  if (input.q) {
    const escaped = input.q.replace(/[%_\\]/g, '\\$&');
    const pat = `%${escaped}%`;
    const search = or(ilike(leads.name, pat), ilike(conversations.phone, pat));
    if (search) conds.push(search);
  }

  const where = conds.length ? and(...conds) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(conversations)
    .leftJoin(leads, eq(conversations.leadId, leads.id))
    .where(where);

  // Subquery: última mensagem por conversa (LATERAL JOIN equivalente).
  // Usamos uma subquery correlacionada para pegar a última row.
  const rows = await db
    .select({
      conv: conversations,
      lead: leads,
      assignee: users,
      lastMsgBody: sql<string | null>`(
        SELECT m.body FROM messages m
        WHERE m.conversation_id = ${conversations.id}
        ORDER BY m.sent_at DESC LIMIT 1
      )`,
      lastMsgKind: sql<string | null>`(
        SELECT m.kind FROM messages m
        WHERE m.conversation_id = ${conversations.id}
        ORDER BY m.sent_at DESC LIMIT 1
      )`,
      lastMsgDir: sql<string | null>`(
        SELECT m.direction FROM messages m
        WHERE m.conversation_id = ${conversations.id}
        ORDER BY m.sent_at DESC LIMIT 1
      )`,
    })
    .from(conversations)
    .leftJoin(leads, eq(conversations.leadId, leads.id))
    .leftJoin(users, eq(conversations.assignedTo, users.id))
    .where(where)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const items: PublicConversation[] = rows.map((r) => {
    const lead = r.lead!;
    return {
      id: r.conv.id,
      phone: r.conv.phone,
      lead: {
        id: lead.id,
        name: lead.name,
        vehiclePlate: lead.vehiclePlate,
        vehicleModel: lead.vehicleModel,
        status: lead.status,
      },
      queue: r.conv.queue,
      status: r.conv.status,
      assignedTo: r.assignee ? { id: r.assignee.id, name: r.assignee.name } : null,
      originKind: r.conv.originKind,
      originCampaignId: r.conv.originCampaignId,
      lastMessagePreview: previewFromMessage({
        body: r.lastMsgBody,
        kind: r.lastMsgKind ?? 'text',
      }),
      lastMessageDirection: (r.lastMsgDir as 'in' | 'out' | null) ?? null,
      lastMessageAt: r.conv.lastMessageAt.toISOString(),
      lastInboundAt: r.conv.lastInboundAt?.toISOString() ?? null,
      unreadCount: r.conv.unreadCount,
      isExpired24h: isExpired24h(r.conv.lastInboundAt, r.conv.status),
      createdAt: r.conv.createdAt.toISOString(),
      updatedAt: r.conv.updatedAt.toISOString(),
    };
  });

  return { items, total, page, pageSize: PAGE_SIZE };
}

export async function getConversationCounts(): Promise<ConversationCounts> {
  const rows = await db
    .select({
      queue: conversations.queue,
      total: sql<number>`count(*)::int`,
    })
    .from(conversations)
    .where(sql`${conversations.status} != 'encerrada'`)
    .groupBy(conversations.queue);

  const counts: ConversationCounts = { ia: 0, recepcao: 0, comercial: 0 };
  for (const r of rows) {
    if (r.queue === 'ia' || r.queue === 'recepcao' || r.queue === 'comercial') {
      counts[r.queue] = r.total;
    }
  }
  return counts;
}

export async function getConversationById(
  id: string,
  currentUserId: string,
): Promise<PublicConversation> {
  const result = await listConversations({
    currentUserId,
    page: 1,
    queue: undefined,
  });
  const found = result.items.find((c) => c.id === id);
  if (!found) {
    // Fallback direto (lista não trouxe — pode ser página > 1).
    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    if (!rows.length) throw new HttpError(404, 'Conversation not found');
  }
  if (!found) throw new HttpError(404, 'Conversation not found');
  return found;
}
```

- [ ] **Step 6.4:** Implementar `server/controllers/conversationsController.ts`:

```ts
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  CONVERSATION_QUEUES,
  CONVERSATION_STATUSES,
  ORIGIN_KINDS,
} from '../../shared/types';
import {
  listConversations,
  getConversationCounts,
  getConversationById,
} from '../services/conversationsService';

const csvOf = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .transform((s) => s.split(',').map((p) => p.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values as readonly [T, ...T[]])).min(1));

const listQuery = z.object({
  queue: z.enum(CONVERSATION_QUEUES).optional(),
  status: csvOf(CONVERSATION_STATUSES).optional(),
  expired24h: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  noResponse: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  origin: csvOf(ORIGIN_KINDS).optional(),
  campaignId: z.string().uuid().optional(),
  assignment: z.enum(['mine', 'unassigned', 'all']).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

const idParams = z.object({ id: z.string().uuid() });

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const params = listQuery.parse(req.query);
    const result = await listConversations({
      ...params,
      currentUserId: req.user!.userId,
    });
    res.json(result);
  } catch (e) { next(e); }
}

export async function countsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getConversationCounts());
  } catch (e) { next(e); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await getConversationById(id, req.user!.userId));
  } catch (e) { next(e); }
}
```

- [ ] **Step 6.5:** Criar `server/routes/conversations.ts`:

```ts
import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import {
  listHandler,
  countsHandler,
  getHandler,
} from '../controllers/conversationsController';

const router = Router();

// IMPORTANTE: /counts antes de /:id senão o id consume "counts".
router.get('/counts', authGuard, countsHandler);
router.get('/', authGuard, listHandler);
router.get('/:id', authGuard, getHandler);

export default router;
```

- [ ] **Step 6.6:** Registrar em `server/app.ts`. Adicionar `import conversationRoutes from './routes/conversations';` e `app.use('/api/conversations', conversationRoutes);` antes do 404.

- [ ] **Step 6.7:** Rodar testes.

```bash
npm test -- server/tests/conversations-list.test.ts
```

Esperado: todos passam.

- [ ] **Step 6.8:** Lint + commit.

```bash
npm run lint
git add server/services/conversationsService.ts server/controllers/conversationsController.ts server/routes/conversations.ts server/tests/conversations-list.test.ts server/app.ts
git commit -m "feat(whatsapp): conversations list + counts with filters"
```

---

## Task 7 — Endpoint de mensagens da conversa (TDD)

**Files:**
- Modify: `server/services/conversationsService.ts`
- Modify: `server/controllers/conversationsController.ts`
- Modify: `server/routes/conversations.ts`
- Create: `server/tests/conversations-detail.test.ts`

- [ ] **Step 7.1:** Escrever testes — `server/tests/conversations-detail.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createLead, createConversation, createMessage } from './helpers';

const app = createApp();

async function loginAs(email = 'r@x.com', password = 'pw12345') {
  await createUser({ email, password, role: 'recepcao' });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

describe('GET /api/conversations/:id/messages', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/conversations/00000000-0000-0000-0000-000000000000/messages');
    expect(res.status).toBe(401);
  });

  it('404 quando id não existe', async () => {
    const token = await loginAs();
    const res = await request(app)
      .get('/api/conversations/00000000-0000-0000-0000-000000000000/messages')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('200 retorna mensagens ordenadas DESC', async () => {
    const token = await loginAs();
    const lead = await createLead({ phone: '11000030001' });
    const conv = await createConversation({ phone: '11000030001', leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      body: 'primeira',
      sentAt: new Date('2026-05-01T10:00:00Z'),
    });
    await createMessage({
      conversationId: conv.id,
      body: 'segunda',
      sentAt: new Date('2026-05-01T10:05:00Z'),
    });

    const res = await request(app)
      .get(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].body).toBe('segunda');
    expect(res.body.items[1].body).toBe('primeira');
    expect(res.body.hasMore).toBe(false);
  });

  it('paginação: before retorna mensagens anteriores ao timestamp', async () => {
    const token = await loginAs();
    const lead = await createLead({ phone: '11000030010' });
    const conv = await createConversation({ phone: '11000030010', leadId: lead.id });
    await createMessage({
      conversationId: conv.id,
      body: 'antiga',
      sentAt: new Date('2026-05-01T08:00:00Z'),
    });
    await createMessage({
      conversationId: conv.id,
      body: 'recente',
      sentAt: new Date('2026-05-01T12:00:00Z'),
    });

    const res = await request(app)
      .get(`/api/conversations/${conv.id}/messages?before=2026-05-01T10:00:00.000Z`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].body).toBe('antiga');
  });
});
```

- [ ] **Step 7.2:** Rodar — devem falhar.

```bash
npm test -- server/tests/conversations-detail.test.ts
```

- [ ] **Step 7.3:** Adicionar service em `server/services/conversationsService.ts`. **Anexar** no fim do arquivo:

```ts
import type { PublicMessage } from '@shared/types';

const MESSAGE_PAGE_SIZE = 50;

export async function listMessages(
  conversationId: string,
  before?: Date,
): Promise<{ items: PublicMessage[]; hasMore: boolean }> {
  // Confirma que a conversa existe
  const conv = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv.length) throw new HttpError(404, 'Conversation not found');

  const conds: SQL[] = [eq(messages.conversationId, conversationId)];
  if (before) conds.push(lt(messages.sentAt, before));

  const rows = await db
    .select({ msg: messages, sender: users })
    .from(messages)
    .leftJoin(users, eq(messages.sentByUserId, users.id))
    .where(and(...conds))
    .orderBy(desc(messages.sentAt))
    .limit(MESSAGE_PAGE_SIZE + 1);

  const hasMore = rows.length > MESSAGE_PAGE_SIZE;
  const items = rows.slice(0, MESSAGE_PAGE_SIZE).map<PublicMessage>((r) => ({
    id: r.msg.id,
    conversationId: r.msg.conversationId,
    direction: r.msg.direction,
    kind: r.msg.kind,
    body: r.msg.body,
    mediaUrl: r.msg.mediaUrl,
    mediaMime: r.msg.mediaMime,
    sentByUser: r.sender ? { id: r.sender.id, name: r.sender.name } : null,
    sentAt: r.msg.sentAt.toISOString(),
  }));

  return { items, hasMore };
}
```

- [ ] **Step 7.4:** Adicionar handler em `server/controllers/conversationsController.ts`. **Anexar** no fim do arquivo + atualizar imports:

```ts
import { listMessages } from '../services/conversationsService';

const messagesQuery = z.object({
  before: z.string().datetime().optional(),
});

export async function listMessagesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const { before } = messagesQuery.parse(req.query);
    const result = await listMessages(id, before ? new Date(before) : undefined);
    res.json(result);
  } catch (e) { next(e); }
}
```

- [ ] **Step 7.5:** Registrar a rota em `server/routes/conversations.ts`. Adicionar `listMessagesHandler` ao import e a rota:

```ts
import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import {
  listHandler,
  countsHandler,
  getHandler,
  listMessagesHandler,
} from '../controllers/conversationsController';

const router = Router();

router.get('/counts', authGuard, countsHandler);
router.get('/', authGuard, listHandler);
router.get('/:id', authGuard, getHandler);
router.get('/:id/messages', authGuard, listMessagesHandler);

export default router;
```

- [ ] **Step 7.6:** Rodar testes.

```bash
npm test -- server/tests/conversations-detail.test.ts
```

Esperado: 4/4 passando.

- [ ] **Step 7.7:** Lint + commit.

```bash
npm run lint
git add server/services/conversationsService.ts server/controllers/conversationsController.ts server/routes/conversations.ts server/tests/conversations-detail.test.ts
git commit -m "feat(whatsapp): list messages with reverse pagination"
```

---

## Task 8 — Ações de conversa: claim, queue, close, read (TDD)

**Files:**
- Modify: `server/services/conversationsService.ts`
- Modify: `server/controllers/conversationsController.ts`
- Modify: `server/routes/conversations.ts`
- Create: `server/tests/conversations-actions.test.ts`

- [ ] **Step 8.1:** Escrever testes — `server/tests/conversations-actions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { conversations } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createConversation } from './helpers';

const app = createApp();

async function loginAs(email = 'r@x.com', password = 'pw12345') {
  await createUser({ email, password, role: 'recepcao' });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

describe('POST /api/conversations/:id/claim', () => {
  it('401 sem token', async () => {
    const res = await request(app).post('/api/conversations/00000000-0000-0000-0000-000000000000/claim');
    expect(res.status).toBe(401);
  });

  it('404 quando id não existe', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .post('/api/conversations/00000000-0000-0000-0000-000000000000/claim')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('200 atribui usuário e muda status pra em_atendimento', async () => {
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000040001' });
    const conv = await createConversation({ phone: '11000040001', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/claim`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.assignedTo.id).toBe(userId);
    expect(res.body.status).toBe('em_atendimento');

    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.assignedTo).toBe(userId);
  });

  it('idempotente — pegar 2x não dá erro', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000040002' });
    const conv = await createConversation({ phone: '11000040002', leadId: lead.id });

    await request(app).post(`/api/conversations/${conv.id}/claim`).set('Authorization', `Bearer ${token}`);
    const res = await request(app).post(`/api/conversations/${conv.id}/claim`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/conversations/:id/queue', () => {
  it('200 muda fila', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000041001' });
    const conv = await createConversation({ phone: '11000041001', leadId: lead.id, queue: 'recepcao' });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/queue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ queue: 'comercial' });
    expect(res.status).toBe(200);
    expect(res.body.queue).toBe('comercial');
  });

  it('400 quando fila inválida', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000041002' });
    const conv = await createConversation({ phone: '11000041002', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/queue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ queue: 'invalida' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/conversations/:id/close', () => {
  it('200 muda status pra encerrada', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000042001' });
    const conv = await createConversation({ phone: '11000042001', leadId: lead.id, status: 'em_atendimento' });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/close`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('encerrada');
  });
});

describe('POST /api/conversations/:id/read', () => {
  it('200 zera unread_count', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000043001' });
    const conv = await createConversation({
      phone: '11000043001',
      leadId: lead.id,
      unreadCount: 5,
    });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/read`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.unreadCount).toBe(0);
  });
});
```

- [ ] **Step 8.2:** Rodar — devem falhar.

```bash
npm test -- server/tests/conversations-actions.test.ts
```

- [ ] **Step 8.3:** Adicionar services em `server/services/conversationsService.ts` (anexar no fim):

```ts
import type { ConversationQueue } from '@shared/types';

async function loadAndReturn(
  id: string,
  currentUserId: string,
): Promise<PublicConversation> {
  return getConversationById(id, currentUserId);
}

export async function claimConversation(
  id: string,
  userId: string,
): Promise<PublicConversation> {
  const [updated] = await db
    .update(conversations)
    .set({
      assignedTo: userId,
      status: 'em_atendimento',
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, id))
    .returning({ id: conversations.id });
  if (!updated) throw new HttpError(404, 'Conversation not found');
  return loadAndReturn(id, userId);
}

export async function changeQueue(
  id: string,
  queue: ConversationQueue,
  currentUserId: string,
): Promise<PublicConversation> {
  const [updated] = await db
    .update(conversations)
    .set({ queue, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning({ id: conversations.id });
  if (!updated) throw new HttpError(404, 'Conversation not found');
  return loadAndReturn(id, currentUserId);
}

export async function closeConversation(
  id: string,
  currentUserId: string,
): Promise<PublicConversation> {
  const [updated] = await db
    .update(conversations)
    .set({ status: 'encerrada', updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning({ id: conversations.id });
  if (!updated) throw new HttpError(404, 'Conversation not found');
  return loadAndReturn(id, currentUserId);
}

export async function markRead(
  id: string,
  currentUserId: string,
): Promise<PublicConversation> {
  const [updated] = await db
    .update(conversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning({ id: conversations.id });
  if (!updated) throw new HttpError(404, 'Conversation not found');
  return loadAndReturn(id, currentUserId);
}
```

- [ ] **Step 8.4:** Adicionar handlers em `server/controllers/conversationsController.ts`:

```ts
import {
  claimConversation,
  changeQueue,
  closeConversation,
  markRead,
} from '../services/conversationsService';

const queueBody = z.object({ queue: z.enum(CONVERSATION_QUEUES) });

export async function claimHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await claimConversation(id, req.user!.userId));
  } catch (e) { next(e); }
}

export async function queueHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const { queue } = queueBody.parse(req.body);
    res.json(await changeQueue(id, queue, req.user!.userId));
  } catch (e) { next(e); }
}

export async function closeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await closeConversation(id, req.user!.userId));
  } catch (e) { next(e); }
}

export async function readHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await markRead(id, req.user!.userId));
  } catch (e) { next(e); }
}
```

- [ ] **Step 8.5:** Registrar rotas em `server/routes/conversations.ts`. Substituir o arquivo todo por:

```ts
import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import {
  listHandler,
  countsHandler,
  getHandler,
  listMessagesHandler,
  claimHandler,
  queueHandler,
  closeHandler,
  readHandler,
} from '../controllers/conversationsController';

const router = Router();

router.get('/counts', authGuard, countsHandler);
router.get('/', authGuard, listHandler);
router.get('/:id', authGuard, getHandler);
router.get('/:id/messages', authGuard, listMessagesHandler);
router.post('/:id/claim', authGuard, claimHandler);
router.post('/:id/queue', authGuard, queueHandler);
router.post('/:id/close', authGuard, closeHandler);
router.post('/:id/read', authGuard, readHandler);

export default router;
```

- [ ] **Step 8.6:** Rodar testes.

```bash
npm test -- server/tests/conversations-actions.test.ts
```

Esperado: 7/7 passando.

- [ ] **Step 8.7:** Lint + commit.

```bash
npm run lint
git add server/services/conversationsService.ts server/controllers/conversationsController.ts server/routes/conversations.ts server/tests/conversations-actions.test.ts
git commit -m "feat(whatsapp): claim/queue/close/read actions"
```

---

## Task 9 — Send message endpoint (TDD com mock UazAPI)

**Files:**
- Modify: `server/services/conversationsService.ts`
- Modify: `server/controllers/conversationsController.ts`
- Modify: `server/routes/conversations.ts`
- Create: `server/tests/conversations-send.test.ts`

- [ ] **Step 9.1:** Escrever testes — `server/tests/conversations-send.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { conversations, messages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createUser, createLead, createConversation } from './helpers';

vi.mock('../services/uazapiClient', () => ({
  uazapiClient: {
    sendMessage: vi.fn(),
  },
  UazapiError: class extends Error {
    constructor(public status: number, public body: string) { super(`UazAPI ${status}`); }
  },
}));

import { uazapiClient } from '../services/uazapiClient';

const app = createApp();

async function loginAs(email = 'r@x.com', password = 'pw12345') {
  await createUser({ email, password, role: 'recepcao' });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

beforeEach(() => {
  vi.mocked(uazapiClient.sendMessage).mockReset();
});

describe('POST /api/conversations/:id/messages', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/conversations/00000000-0000-0000-0000-000000000000/messages')
      .send({ kind: 'text', body: 'oi' });
    expect(res.status).toBe(401);
  });

  it('404 quando conversa não existe', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .post('/api/conversations/00000000-0000-0000-0000-000000000000/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'oi' });
    expect(res.status).toBe(404);
  });

  it('400 quando body falta para kind=text', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000050001' });
    const conv = await createConversation({ phone: '11000050001', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text' });
    expect(res.status).toBe(400);
  });

  it('200 envia texto, persiste com direction=out', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-out-001',
      rawPayload: { ok: true },
    });
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000050010' });
    const conv = await createConversation({ phone: '11000050010', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'Olá! Posso ajudar?' });
    expect(res.status).toBe(200);
    expect(res.body.direction).toBe('out');
    expect(res.body.body).toBe('Olá! Posso ajudar?');

    const rows = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].sentByUserId).toBe(userId);
    expect(rows[0].uazapiMsgId).toBe('uazapi-out-001');
  });

  it('502 quando UazAPI falha — nada é persistido', async () => {
    vi.mocked(uazapiClient.sendMessage).mockRejectedValueOnce(new Error('connection lost'));
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000050020' });
    const conv = await createConversation({ phone: '11000050020', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'tentativa' });
    expect(res.status).toBe(502);

    const rows = await db.select().from(messages).where(eq(messages.conversationId, conv.id));
    expect(rows).toHaveLength(0);
  });

  it('auto-claim: primeira msg outbound atribui usuário se sem dono', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-out-002',
      rawPayload: {},
    });
    const { token, userId } = await loginAs();
    const lead = await createLead({ phone: '11000050030' });
    const conv = await createConversation({
      phone: '11000050030',
      leadId: lead.id,
      assignedTo: null,
      status: 'aguardando_atendimento',
    });

    await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'text', body: 'oi' });

    const [row] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    expect(row.assignedTo).toBe(userId);
    expect(row.status).toBe('em_atendimento');
  });

  it('envia mídia: mediaUrl obrigatório, body opcional', async () => {
    vi.mocked(uazapiClient.sendMessage).mockResolvedValueOnce({
      messageId: 'uazapi-out-003',
      rawPayload: {},
    });
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000050040' });
    const conv = await createConversation({ phone: '11000050040', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'image',
        mediaUrl: 'https://uazapi-cdn.example.com/img/abc.jpg',
        mediaMime: 'image/jpeg',
      });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('image');
    expect(res.body.mediaUrl).toBe('https://uazapi-cdn.example.com/img/abc.jpg');
  });

  it('400 quando mediaUrl falta para kind!=text', async () => {
    const { token } = await loginAs();
    const lead = await createLead({ phone: '11000050050' });
    const conv = await createConversation({ phone: '11000050050', leadId: lead.id });

    const res = await request(app)
      .post(`/api/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'image' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 9.2:** Rodar — devem falhar.

```bash
npm test -- server/tests/conversations-send.test.ts
```

- [ ] **Step 9.3:** Adicionar service em `server/services/conversationsService.ts` (anexar no fim):

```ts
import { uazapiClient } from './uazapiClient';
import type { MessageKind } from '@shared/types';

export interface SendInput {
  conversationId: string;
  userId: string;
  kind: MessageKind;
  body?: string | null;
  mediaUrl?: string | null;
  mediaMime?: string | null;
}

export async function sendMessage(input: SendInput): Promise<PublicMessage> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, input.conversationId))
    .limit(1);
  if (!conv) throw new HttpError(404, 'Conversation not found');

  // Chama UazAPI primeiro — só persiste se sucesso.
  let uazapiResp;
  try {
    uazapiResp = await uazapiClient.sendMessage({
      to: conv.phone,
      kind: input.kind,
      text: input.body ?? undefined,
      mediaUrl: input.mediaUrl ?? undefined,
      mediaMime: input.mediaMime ?? undefined,
    });
  } catch {
    throw new HttpError(502, 'WhatsApp gateway unavailable');
  }

  const sentAt = new Date();

  const [msg] = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(messages)
      .values({
        conversationId: conv.id,
        direction: 'out',
        kind: input.kind,
        body: input.body ?? null,
        mediaUrl: input.mediaUrl ?? null,
        mediaMime: input.mediaMime ?? null,
        sentByUserId: input.userId,
        uazapiMsgId: uazapiResp.messageId,
        rawPayload: uazapiResp.rawPayload as object,
        sentAt,
      })
      .returning();

    await tx
      .update(conversations)
      .set({
        lastMessageAt: sentAt,
        assignedTo: conv.assignedTo ?? input.userId,
        status: conv.assignedTo ? conv.status : 'em_atendimento',
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conv.id));

    return [inserted];
  });

  // Carrega o autor para o retorno público.
  const [sender] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    direction: msg.direction,
    kind: msg.kind,
    body: msg.body,
    mediaUrl: msg.mediaUrl,
    mediaMime: msg.mediaMime,
    sentByUser: sender ? { id: sender.id, name: sender.name } : null,
    sentAt: msg.sentAt.toISOString(),
  };
}
```

- [ ] **Step 9.4:** Adicionar handler em `server/controllers/conversationsController.ts`:

```ts
import { sendMessage } from '../services/conversationsService';
import { MESSAGE_KINDS } from '../../shared/types';

const sendBody = z
  .object({
    kind: z.enum(MESSAGE_KINDS),
    body: z.string().max(4000).optional(),
    mediaUrl: z.string().url().optional(),
    mediaMime: z.string().max(120).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === 'text' && !d.body) {
      ctx.addIssue({ code: 'custom', message: 'body is required for kind=text', path: ['body'] });
    }
    if (d.kind !== 'text' && !d.mediaUrl) {
      ctx.addIssue({ code: 'custom', message: 'mediaUrl is required for media kinds', path: ['mediaUrl'] });
    }
  });

export async function sendMessageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const data = sendBody.parse(req.body);
    const msg = await sendMessage({
      conversationId: id,
      userId: req.user!.userId,
      kind: data.kind,
      body: data.body ?? null,
      mediaUrl: data.mediaUrl ?? null,
      mediaMime: data.mediaMime ?? null,
    });
    res.json(msg);
  } catch (e) { next(e); }
}
```

- [ ] **Step 9.5:** Registrar rota em `server/routes/conversations.ts`. Adicionar `sendMessageHandler` ao import e a linha:

```ts
router.post('/:id/messages', authGuard, sendMessageHandler);
```

- [ ] **Step 9.6:** Rodar testes.

```bash
npm test -- server/tests/conversations-send.test.ts
```

Esperado: 8/8 passando.

- [ ] **Step 9.7:** Lint + commit.

```bash
npm run lint
git add server/services/conversationsService.ts server/controllers/conversationsController.ts server/routes/conversations.ts server/tests/conversations-send.test.ts
git commit -m "feat(whatsapp): send message endpoint with auto-claim"
```

---

## Task 10 — Message templates CRUD (TDD)

**Files:**
- Create: `server/services/messageTemplatesService.ts`
- Create: `server/controllers/messageTemplatesController.ts`
- Create: `server/routes/messageTemplates.ts`
- Create: `server/tests/message-templates.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 10.1:** Escrever testes — `server/tests/message-templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createUser, createMessageTemplate } from './helpers';

const app = createApp();

async function loginAs(email = 'r@x.com', password = 'pw12345') {
  const u = await createUser({ email, password, role: 'recepcao' });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return { token: res.body.accessToken as string, userId: u.id };
}

describe('GET /api/message-templates', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/message-templates');
    expect(res.status).toBe(401);
  });

  it('200 lista templates', async () => {
    const { token, userId } = await loginAs();
    await createMessageTemplate({ title: 'Boas-vindas', body: 'Oi!', createdBy: userId });

    const res = await request(app).get('/api/message-templates').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.items[0].title).toBe('Boas-vindas');
  });
});

describe('POST /api/message-templates', () => {
  it('200 cria template', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .post('/api/message-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Horário', body: 'Estamos abertos das 8h às 18h.' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Horário');
    expect(res.body.createdBy.id).toBeDefined();
  });

  it('400 quando título ou body vazio', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .post('/api/message-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '', body: '' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/message-templates/:id', () => {
  it('200 edita template', async () => {
    const { token, userId } = await loginAs();
    const t = await createMessageTemplate({ title: 'A', body: 'B', createdBy: userId });

    const res = await request(app)
      .patch(`/api/message-templates/${t.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'A2' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('A2');
  });

  it('404 quando id não existe', async () => {
    const { token } = await loginAs();
    const res = await request(app)
      .patch('/api/message-templates/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/message-templates/:id', () => {
  it('204 deleta', async () => {
    const { token, userId } = await loginAs();
    const t = await createMessageTemplate({ title: 'A', body: 'B', createdBy: userId });
    const res = await request(app)
      .delete(`/api/message-templates/${t.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 10.2:** Rodar — devem falhar.

```bash
npm test -- server/tests/message-templates.test.ts
```

- [ ] **Step 10.3:** Implementar `server/services/messageTemplatesService.ts`:

```ts
import { db } from '../db/client';
import { messageTemplates, users } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { PublicMessageTemplate } from '@shared/types';

function toPublic(row: {
  template: typeof messageTemplates.$inferSelect;
  author: typeof users.$inferSelect | null;
}): PublicMessageTemplate {
  return {
    id: row.template.id,
    title: row.template.title,
    body: row.template.body,
    createdBy: row.author
      ? { id: row.author.id, name: row.author.name }
      : { id: row.template.createdBy, name: 'Usuário' },
    createdAt: row.template.createdAt.toISOString(),
    updatedAt: row.template.updatedAt.toISOString(),
  };
}

export async function listTemplates(): Promise<{ items: PublicMessageTemplate[] }> {
  const rows = await db
    .select({ template: messageTemplates, author: users })
    .from(messageTemplates)
    .leftJoin(users, eq(messageTemplates.createdBy, users.id))
    .orderBy(desc(messageTemplates.updatedAt));
  return { items: rows.map(toPublic) };
}

export async function createTemplate(input: {
  title: string;
  body: string;
  userId: string;
}): Promise<PublicMessageTemplate> {
  const [row] = await db
    .insert(messageTemplates)
    .values({ title: input.title, body: input.body, createdBy: input.userId })
    .returning();
  const [author] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  return toPublic({ template: row, author: author ?? null });
}

export async function updateTemplate(input: {
  id: string;
  title?: string;
  body?: string;
}): Promise<PublicMessageTemplate> {
  const patch: { title?: string; body?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) patch.body = input.body;
  const [row] = await db
    .update(messageTemplates)
    .set(patch)
    .where(eq(messageTemplates.id, input.id))
    .returning();
  if (!row) throw new HttpError(404, 'Template not found');
  const [author] = await db.select().from(users).where(eq(users.id, row.createdBy)).limit(1);
  return toPublic({ template: row, author: author ?? null });
}

export async function deleteTemplate(id: string): Promise<void> {
  const [row] = await db
    .delete(messageTemplates)
    .where(eq(messageTemplates.id, id))
    .returning({ id: messageTemplates.id });
  if (!row) throw new HttpError(404, 'Template not found');
}
```

- [ ] **Step 10.4:** Implementar `server/controllers/messageTemplatesController.ts`:

```ts
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../services/messageTemplatesService';

const idParams = z.object({ id: z.string().uuid() });

const createBody = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(4000),
});

const updateBody = z
  .object({
    title: z.string().min(1).max(120).optional(),
    body: z.string().min(1).max(4000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

export async function listHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await listTemplates());
  } catch (e) { next(e); }
}

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createBody.parse(req.body);
    res.json(await createTemplate({ ...data, userId: req.user!.userId }));
  } catch (e) { next(e); }
}

export async function updateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const data = updateBody.parse(req.body);
    res.json(await updateTemplate({ id, ...data }));
  } catch (e) { next(e); }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    await deleteTemplate(id);
    res.status(204).end();
  } catch (e) { next(e); }
}
```

- [ ] **Step 10.5:** Criar `server/routes/messageTemplates.ts`:

```ts
import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import {
  listHandler,
  createHandler,
  updateHandler,
  deleteHandler,
} from '../controllers/messageTemplatesController';

const router = Router();

router.get('/', authGuard, listHandler);
router.post('/', authGuard, createHandler);
router.patch('/:id', authGuard, updateHandler);
router.delete('/:id', authGuard, deleteHandler);

export default router;
```

- [ ] **Step 10.6:** Registrar em `server/app.ts`. Adicionar import e `app.use('/api/message-templates', messageTemplateRoutes);`:

```ts
import messageTemplateRoutes from './routes/messageTemplates';
// ... dentro do createApp, antes do 404:
app.use('/api/message-templates', messageTemplateRoutes);
```

- [ ] **Step 10.7:** Rodar testes.

```bash
npm test -- server/tests/message-templates.test.ts
```

Esperado: 6/6 passando.

- [ ] **Step 10.8:** Lint + commit.

```bash
npm run lint
git add server/services/messageTemplatesService.ts server/controllers/messageTemplatesController.ts server/routes/messageTemplates.ts server/tests/message-templates.test.ts server/app.ts
git commit -m "feat(whatsapp): message templates CRUD"
```

---

## Task 11 — Frontend api.ts (TanStack Query hooks) + helpers

**Files:**
- Create: `src/features/whatsapp/api.ts`
- Create: `src/features/whatsapp/helpers.ts`
- Create: `src/features/whatsapp/types.ts`

- [ ] **Step 11.1:** Criar `src/features/whatsapp/types.ts` (re-exports e tipos auxiliares de UI):

```ts
export type {
  PublicConversation,
  PublicMessage,
  PublicMessageTemplate,
  ConversationCounts,
  ConversationFilters,
  ConversationQueue,
  ConversationStatus,
  MessageKind,
  MessageDirection,
  OriginKind,
} from '@shared/types';

import type { ConversationFilters } from '@shared/types';

export interface UiFilters extends ConversationFilters {
  // Mantém shape; helper só pra documentar que UI usa o mesmo tipo.
}
```

- [ ] **Step 11.2:** Criar `src/features/whatsapp/helpers.ts`:

```ts
import type { MessageKind } from './types';

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function formatPhoneBR(phone: string): string {
  const d = normalizePhone(phone);
  if (d.length === 13) {
    // 5511987654321 → +55 11 98765-4321
    return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 11) {
    return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  return phone;
}

export function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'ontem';
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'HOJE';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'ONTEM';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function mediaPlaceholder(kind: MessageKind): string {
  switch (kind) {
    case 'image': return '[imagem]';
    case 'audio': return '[áudio]';
    case 'video': return '[vídeo]';
    case 'document': return '[documento]';
    default: return '[mídia]';
  }
}

export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') return '?';
  if (/^\d+$/.test(name.replace(/\D/g, ''))) return '?';
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}
```

- [ ] **Step 11.3:** Criar `src/features/whatsapp/api.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import type {
  PublicConversation,
  PublicMessage,
  PublicMessageTemplate,
  ConversationCounts,
  ConversationFilters,
  ConversationQueue,
  MessageKind,
} from './types';

export interface ListResult {
  items: PublicConversation[];
  total: number;
  page: number;
  pageSize: number;
}

function buildQuery(filters: ConversationFilters): string {
  const u = new URLSearchParams();
  if (filters.queue) u.set('queue', filters.queue);
  if (filters.status?.length) u.set('status', filters.status.join(','));
  if (filters.expired24h) u.set('expired24h', 'true');
  if (filters.noResponse) u.set('noResponse', 'true');
  if (filters.origin?.length) u.set('origin', filters.origin.join(','));
  if (filters.campaignId) u.set('campaignId', filters.campaignId);
  if (filters.assignment && filters.assignment !== 'all') u.set('assignment', filters.assignment);
  if (filters.q) u.set('q', filters.q);
  if (filters.page && filters.page > 1) u.set('page', String(filters.page));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function useConversations(filters: ConversationFilters) {
  return useQuery({
    queryKey: ['conversations', filters],
    queryFn: () => api<ListResult>(`/conversations${buildQuery(filters)}`),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
}

export function useConversationCounts() {
  return useQuery({
    queryKey: ['conversations', 'counts'],
    queryFn: () => api<ConversationCounts>('/conversations/counts'),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
}

export interface MessagesResult { items: PublicMessage[]; hasMore: boolean }

export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => api<MessagesResult>(`/conversations/${conversationId}/messages`),
    enabled: !!conversationId,
    refetchInterval: 2_500,
    refetchIntervalInBackground: false,
  });
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      kind: MessageKind;
      body?: string;
      mediaUrl?: string;
      mediaMime?: string;
    }) =>
      api<PublicMessage>(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useClaimConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<PublicConversation>(`/conversations/${id}/claim`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useChangeQueue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, queue }: { id: string; queue: ConversationQueue }) =>
      api<PublicConversation>(`/conversations/${id}/queue`, {
        method: 'POST',
        body: JSON.stringify({ queue }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useCloseConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<PublicConversation>(`/conversations/${id}/close`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<PublicConversation>(`/conversations/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
}

export interface TemplatesResult { items: PublicMessageTemplate[] }

export function useTemplates() {
  return useQuery({
    queryKey: ['message-templates'],
    queryFn: () => api<TemplatesResult>('/message-templates'),
    staleTime: 60_000,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; body: string }) =>
      api<PublicMessageTemplate>('/message-templates', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['message-templates'] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/message-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['message-templates'] }),
  });
}
```

- [ ] **Step 11.4:** Lint.

```bash
npm run lint
```

- [ ] **Step 11.5:** Commit.

```bash
git add src/features/whatsapp/api.ts src/features/whatsapp/helpers.ts src/features/whatsapp/types.ts
git commit -m "feat(whatsapp): TanStack Query hooks + helpers"
```

---

## Task 12 — WhatsappPage shell + QueueTabs

**Files:**
- Modify: `src/pages/whatsapp/WhatsappPage.tsx`
- Create: `src/features/whatsapp/QueueTabs.tsx`

- [ ] **Step 12.1:** Criar `src/features/whatsapp/QueueTabs.tsx`:

```tsx
import { useConversationCounts } from './api';
import type { ConversationQueue } from './types';

const QUEUES: { key: ConversationQueue; label: string }[] = [
  { key: 'ia', label: 'IA' },
  { key: 'recepcao', label: 'Recepção' },
  { key: 'comercial', label: 'Comercial' },
];

interface Props {
  active: ConversationQueue;
  onChange: (queue: ConversationQueue) => void;
}

export function QueueTabs({ active, onChange }: Props) {
  const { data } = useConversationCounts();
  return (
    <div className="flex border-b border-border bg-background">
      {QUEUES.map((q) => {
        const count = data?.[q.key] ?? 0;
        const isActive = active === q.key;
        return (
          <button
            key={q.key}
            onClick={() => onChange(q.key)}
            className={`flex-1 py-3 px-2 text-sm font-semibold border-b-2 transition-colors ${
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <span>{q.label}</span>
            <span
              className={`ml-2 inline-block min-w-[20px] px-2 py-0.5 rounded-full text-xs font-semibold ${
                isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 12.2:** Substituir `src/pages/whatsapp/WhatsappPage.tsx` pelo shell de 3 colunas (componentes filhos virão como stubs depois — agora só estrutura):

```tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QueueTabs } from '@/features/whatsapp/QueueTabs';
import type { ConversationQueue } from '@/features/whatsapp/types';

export default function WhatsappPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queue = (searchParams.get('queue') as ConversationQueue) || 'recepcao';
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);

  function handleQueueChange(q: ConversationQueue) {
    const next = new URLSearchParams(searchParams);
    next.set('queue', q);
    setSearchParams(next, { replace: true });
    setSelectedConvId(null);
  }

  return (
    <div className="grid h-[calc(100vh-4rem)]" style={{ gridTemplateColumns: '380px 1fr 340px' }}>
      {/* Coluna 1 — lista */}
      <aside className="flex flex-col border-r border-border bg-background">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-base font-semibold">Inbox</h2>
        </div>
        <QueueTabs active={queue} onChange={handleQueueChange} />
        <div className="flex-1 overflow-hidden flex items-center justify-center text-muted-foreground text-sm">
          (lista de conversas — Task 14)
        </div>
      </aside>

      {/* Coluna 2 — thread */}
      <main className="flex flex-col bg-muted/20">
        {selectedConvId ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            (thread — Task 15)
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Selecione uma conversa
          </div>
        )}
      </main>

      {/* Coluna 3 — sidebar lead */}
      <aside className="border-l border-border bg-background">
        {selectedConvId ? (
          <div className="p-4 text-sm text-muted-foreground">(sidebar do lead — Task 18)</div>
        ) : null}
      </aside>
    </div>
  );
}
```

- [ ] **Step 12.3:** Verificar que a página carrega sem erros — `npm run dev` e abrir http://localhost:3000/whatsapp.

- [ ] **Step 12.4:** Lint + commit.

```bash
npm run lint
git add src/features/whatsapp/QueueTabs.tsx src/pages/whatsapp/WhatsappPage.tsx
git commit -m "feat(whatsapp): page shell with 3 columns + queue tabs"
```

---

## Task 13 — FilterBar (chips + URL params)

**Files:**
- Create: `src/features/whatsapp/FilterBar.tsx`
- Modify: `src/pages/whatsapp/WhatsappPage.tsx`

- [ ] **Step 13.1:** Criar `src/features/whatsapp/FilterBar.tsx`:

```tsx
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import type { ConversationStatus, OriginKind } from './types';

const STATUS_OPTIONS: { key: 'aguardando' | 'em_atendimento' | 'expirada' | 'sem_retorno' | 'encerrada'; label: string }[] = [
  { key: 'aguardando', label: 'Aguardando' },
  { key: 'em_atendimento', label: 'Em atendimento' },
  { key: 'expirada', label: 'Expiradas 24h' },
  { key: 'sem_retorno', label: 'Sem retorno' },
  { key: 'encerrada', label: 'Encerradas' },
];

const ASSIGNMENT_OPTIONS: { key: 'mine' | 'unassigned' | 'all'; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'mine', label: 'Minhas' },
  { key: 'unassigned', label: 'Sem dono' },
];

const ORIGIN_OPTIONS: { key: OriginKind; label: string }[] = [
  { key: 'organic', label: 'Orgânica' },
  { key: 'campaign', label: 'Campanha' },
];

interface Props {
  q: string;
  onQChange: (q: string) => void;
  statusKeys: string[];
  onStatusToggle: (key: string) => void;
  assignment: 'mine' | 'unassigned' | 'all';
  onAssignmentChange: (a: 'mine' | 'unassigned' | 'all') => void;
  origins: OriginKind[];
  onOriginsChange: (o: OriginKind[]) => void;
}

export function FilterBar(props: Props) {
  const [searchInput, setSearchInput] = useState(props.q);
  return (
    <div className="border-b border-border bg-background">
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou telefone…"
            className="pl-8 h-9 text-sm"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onBlur={() => props.onQChange(searchInput)}
            onKeyDown={(e) => { if (e.key === 'Enter') props.onQChange(searchInput); }}
          />
        </div>
      </div>

      <div className="px-3 pb-2 flex flex-wrap gap-1.5">
        {STATUS_OPTIONS.map((s) => (
          <Chip
            key={s.key}
            active={props.statusKeys.includes(s.key)}
            onClick={() => props.onStatusToggle(s.key)}
          >
            {s.label}
          </Chip>
        ))}
      </div>

      <div className="px-3 pb-2 flex flex-wrap gap-1.5">
        {ASSIGNMENT_OPTIONS.map((a) => (
          <Chip
            key={a.key}
            active={props.assignment === a.key}
            onClick={() => props.onAssignmentChange(a.key)}
          >
            {a.label}
          </Chip>
        ))}
        <span className="mx-2 text-muted-foreground/50">|</span>
        {ORIGIN_OPTIONS.map((o) => (
          <Chip
            key={o.key}
            active={props.origins.includes(o.key)}
            onClick={() => {
              const next = props.origins.includes(o.key)
                ? props.origins.filter((x) => x !== o.key)
                : [...props.origins, o.key];
              props.onOriginsChange(next);
            }}
          >
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-primary/10 text-primary border-primary/40'
          : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}

// Helper para converter a tecla do chip de status nos filtros do backend.
export function statusChipsToFilters(keys: string[]): {
  status?: ConversationStatus[];
  expired24h?: boolean;
  noResponse?: boolean;
} {
  const result: { status?: ConversationStatus[]; expired24h?: boolean; noResponse?: boolean } = {};
  const statusList: ConversationStatus[] = [];
  if (keys.includes('aguardando')) statusList.push('aguardando_atendimento');
  if (keys.includes('em_atendimento')) statusList.push('em_atendimento');
  if (keys.includes('encerrada')) statusList.push('encerrada');
  if (statusList.length) result.status = statusList;
  if (keys.includes('expirada')) result.expired24h = true;
  if (keys.includes('sem_retorno')) result.noResponse = true;
  return result;
}
```

- [ ] **Step 13.2:** Atualizar `src/pages/whatsapp/WhatsappPage.tsx` para incluir FilterBar e gerenciar filters em URL params. Substituir o arquivo todo por:

```tsx
import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QueueTabs } from '@/features/whatsapp/QueueTabs';
import { FilterBar, statusChipsToFilters } from '@/features/whatsapp/FilterBar';
import type { ConversationQueue, ConversationFilters, OriginKind } from '@/features/whatsapp/types';

export default function WhatsappPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queue = (searchParams.get('queue') as ConversationQueue) || 'recepcao';
  const statusKeys = (searchParams.get('statusChips') ?? 'aguardando,em_atendimento')
    .split(',').filter(Boolean);
  const assignment = (searchParams.get('assignment') as 'mine' | 'unassigned' | 'all') ?? 'all';
  const origins: OriginKind[] = ((searchParams.get('origin') ?? 'organic,campaign')
    .split(',').filter(Boolean) as OriginKind[]);
  const q = searchParams.get('q') ?? '';
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);

  const filters: ConversationFilters = useMemo(() => ({
    queue,
    ...statusChipsToFilters(statusKeys),
    origin: origins,
    assignment,
    q: q || undefined,
  }), [queue, statusKeys.join(','), origins.join(','), assignment, q]);

  function patch(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="grid h-[calc(100vh-4rem)]" style={{ gridTemplateColumns: '380px 1fr 340px' }}>
      <aside className="flex flex-col border-r border-border bg-background">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-base font-semibold">Inbox</h2>
        </div>
        <QueueTabs
          active={queue}
          onChange={(q) => { patch({ queue: q }); setSelectedConvId(null); }}
        />
        <FilterBar
          q={q}
          onQChange={(v) => patch({ q: v || null })}
          statusKeys={statusKeys}
          onStatusToggle={(k) => {
            const next = statusKeys.includes(k)
              ? statusKeys.filter((x) => x !== k)
              : [...statusKeys, k];
            patch({ statusChips: next.join(',') || null });
          }}
          assignment={assignment}
          onAssignmentChange={(a) => patch({ assignment: a === 'all' ? null : a })}
          origins={origins}
          onOriginsChange={(o) => patch({ origin: o.join(',') })}
        />
        <div className="flex-1 overflow-hidden flex items-center justify-center text-muted-foreground text-sm">
          (lista — Task 14)
          <pre className="hidden">{JSON.stringify(filters)}</pre>
        </div>
      </aside>

      <main className="flex flex-col bg-muted/20">
        {selectedConvId ? null : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Selecione uma conversa
          </div>
        )}
      </main>

      <aside className="border-l border-border bg-background" />
    </div>
  );
}
```

- [ ] **Step 13.3:** Verificar carregamento + lint.

```bash
npm run lint
```

- [ ] **Step 13.4:** Commit.

```bash
git add src/features/whatsapp/FilterBar.tsx src/pages/whatsapp/WhatsappPage.tsx
git commit -m "feat(whatsapp): FilterBar with URL-persisted chips"
```

---

## Task 14 — ConversationList + ConversationRow

**Files:**
- Create: `src/features/whatsapp/ConversationRow.tsx`
- Create: `src/features/whatsapp/ConversationList.tsx`
- Modify: `src/pages/whatsapp/WhatsappPage.tsx`

- [ ] **Step 14.1:** Criar `src/features/whatsapp/ConversationRow.tsx`:

```tsx
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Image as ImageIcon } from 'lucide-react';
import { formatRelativeTime, avatarInitials } from './helpers';
import type { PublicConversation } from './types';

interface Props {
  conv: PublicConversation;
  active: boolean;
  currentUserId: string;
  onClick: () => void;
}

export function ConversationRow({ conv, active, currentUserId, onClick }: Props) {
  const isMine = conv.assignedTo?.id === currentUserId;
  const ownerLabel = !conv.assignedTo
    ? '● Sem dono'
    : isMine
    ? '● Em atendimento por você'
    : `● Em atendimento por ${conv.assignedTo.name}`;
  const ownerColor = !conv.assignedTo
    ? 'text-destructive'
    : isMine
    ? 'text-primary'
    : 'text-muted-foreground';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left grid grid-cols-[44px_1fr] gap-3 px-3 py-3 border-b border-border/40 transition-colors ${
        active ? 'bg-accent' : 'hover:bg-muted/50'
      }`}
    >
      <Avatar className="h-11 w-11">
        <AvatarFallback className="bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-sm font-semibold">
          {avatarInitials(conv.lead.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between">
          <span className="font-medium text-sm truncate">{conv.lead.name}</span>
          <span className={`text-xs flex-shrink-0 ml-2 ${conv.unreadCount > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
            {formatRelativeTime(conv.lastMessageAt)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground truncate flex items-center gap-1">
            {conv.lastMessagePreview === '[imagem]' && <ImageIcon className="h-3 w-3" />}
            {conv.lastMessageDirection === 'out' && <span className="text-foreground/60">Você: </span>}
            {conv.lastMessagePreview || '(sem mensagens)'}
          </span>
          {conv.unreadCount > 0 && (
            <span className="bg-primary text-primary-foreground text-xs font-semibold rounded-full min-w-[20px] px-1.5 py-0.5 text-center flex-shrink-0">
              {conv.unreadCount}
            </span>
          )}
        </div>
        <div className={`text-[10px] mt-1 ${ownerColor}`}>{ownerLabel}</div>
      </div>
    </button>
  );
}
```

- [ ] **Step 14.2:** Criar `src/features/whatsapp/ConversationList.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton';
import { ConversationRow } from './ConversationRow';
import { useConversations } from './api';
import type { ConversationFilters, PublicConversation } from './types';

interface Props {
  filters: ConversationFilters;
  selectedId: string | null;
  currentUserId: string;
  onSelect: (conv: PublicConversation) => void;
}

export function ConversationList({ filters, selectedId, currentUserId, onSelect }: Props) {
  const { data, isLoading, isError } = useConversations(filters);
  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }
  if (isError) {
    return <div className="flex-1 p-4 text-sm text-destructive">Erro ao carregar conversas.</div>;
  }
  if (!data?.items.length) {
    return <div className="flex-1 p-6 text-sm text-muted-foreground text-center">Nenhuma conversa nesta fila.</div>;
  }
  return (
    <div className="flex-1 overflow-y-auto">
      {data.items.map((c) => (
        <ConversationRow
          key={c.id}
          conv={c}
          active={c.id === selectedId}
          currentUserId={currentUserId}
          onClick={() => onSelect(c)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 14.3:** Atualizar `src/pages/whatsapp/WhatsappPage.tsx` para usar ConversationList. Substituir o bloco "(lista — Task 14)" por:

```tsx
<ConversationList
  filters={filters}
  selectedId={selectedConvId}
  currentUserId={currentUserId}
  onSelect={(c) => setSelectedConvId(c.id)}
/>
```

E adicionar o `currentUserId`. Adicionar import e leitura do auth store no topo do componente:

```tsx
import { useAuthStore } from '@/features/auth/store';
import { ConversationList } from '@/features/whatsapp/ConversationList';
// ...
const currentUserId = useAuthStore((s) => s.user?.id ?? '');
```

- [ ] **Step 14.4:** Lint + smoke manual via `npm run dev` (criar conversa via webhook curl ou seed para ter algo na lista).

```bash
npm run lint
```

- [ ] **Step 14.5:** Commit.

```bash
git add src/features/whatsapp/ConversationRow.tsx src/features/whatsapp/ConversationList.tsx src/pages/whatsapp/WhatsappPage.tsx
git commit -m "feat(whatsapp): conversation list with rows"
```

---

## Task 15 — Thread (MessageBubble, DayDivider, scroll)

**Files:**
- Create: `src/features/whatsapp/DayDivider.tsx`
- Create: `src/features/whatsapp/MessageBubble.tsx`
- Create: `src/features/whatsapp/Thread.tsx`
- Modify: `src/pages/whatsapp/WhatsappPage.tsx`

- [ ] **Step 15.1:** Criar `src/features/whatsapp/DayDivider.tsx`:

```tsx
export function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex justify-center my-3">
      <span className="bg-muted text-muted-foreground text-[11px] font-medium px-3 py-1 rounded shadow-sm">
        {label}
      </span>
    </div>
  );
}
```

- [ ] **Step 15.2:** Criar `src/features/whatsapp/MessageBubble.tsx`:

```tsx
import type { PublicMessage } from './types';

export function MessageBubble({ msg }: { msg: PublicMessage }) {
  const isOut = msg.direction === 'out';
  const time = new Date(msg.sentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-1`}>
      <div
        className={`max-w-[65%] px-3 py-1.5 shadow-sm ${
          isOut
            ? 'bg-emerald-900/40 rounded-lg rounded-tr-none'
            : 'bg-card border border-border/40 rounded-lg rounded-tl-none'
        }`}
      >
        {msg.kind === 'image' && msg.mediaUrl && (
          <img
            src={msg.mediaUrl}
            alt="imagem"
            className="rounded mb-1 max-w-full max-h-64 object-cover"
          />
        )}
        {msg.kind === 'audio' && msg.mediaUrl && (
          <audio controls src={msg.mediaUrl} className="mb-1 max-w-full" />
        )}
        {msg.kind === 'video' && msg.mediaUrl && (
          <video controls src={msg.mediaUrl} className="rounded mb-1 max-w-full max-h-64" />
        )}
        {msg.kind === 'document' && msg.mediaUrl && (
          <a
            href={msg.mediaUrl}
            target="_blank"
            rel="noreferrer"
            className="block text-xs underline mb-1"
          >
            Abrir documento
          </a>
        )}
        {msg.body && <p className="text-sm whitespace-pre-wrap break-words leading-snug">{msg.body}</p>}
        <div className="text-[10px] text-muted-foreground/80 text-right mt-0.5">
          {time}
          {isOut && <span className="ml-1 text-sky-400">✓✓</span>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 15.3:** Criar `src/features/whatsapp/Thread.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { useMessages, useMarkRead } from './api';
import { MessageBubble } from './MessageBubble';
import { DayDivider } from './DayDivider';
import { dayLabel } from './helpers';
import type { PublicMessage } from './types';

interface Props { conversationId: string }

export function Thread({ conversationId }: Props) {
  const { data, isLoading } = useMessages(conversationId);
  const markRead = useMarkRead();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastConvIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastConvIdRef.current !== conversationId) {
      markRead.mutate(conversationId);
      lastConvIdRef.current = conversationId;
    }
  }, [conversationId, markRead]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [data?.items.length]);

  if (isLoading) {
    return <div className="flex-1 p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  // API retorna DESC; renderizamos ASC.
  const items = [...(data?.items ?? [])].reverse();

  // Agrupa por dia para inserir DayDivider.
  const blocks: { dayLabel: string; messages: PublicMessage[] }[] = [];
  for (const msg of items) {
    const label = dayLabel(msg.sentAt);
    const last = blocks[blocks.length - 1];
    if (last && last.dayLabel === label) last.messages.push(msg);
    else blocks.push({ dayLabel: label, messages: [msg] });
  }

  return (
    <div className="flex-1 overflow-y-auto px-12 py-4">
      {blocks.map((b, i) => (
        <div key={i}>
          <DayDivider label={b.dayLabel} />
          {b.messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 15.4:** Atualizar `src/pages/whatsapp/WhatsappPage.tsx` para usar Thread quando há conversa selecionada. Substituir o bloco da `<main>`:

```tsx
<main className="flex flex-col bg-muted/10">
  {selectedConvId ? (
    <Thread conversationId={selectedConvId} />
  ) : (
    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
      Selecione uma conversa
    </div>
  )}
</main>
```

E adicionar `import { Thread } from '@/features/whatsapp/Thread';`.

- [ ] **Step 15.5:** Lint + commit.

```bash
npm run lint
git add src/features/whatsapp/DayDivider.tsx src/features/whatsapp/MessageBubble.tsx src/features/whatsapp/Thread.tsx src/pages/whatsapp/WhatsappPage.tsx
git commit -m "feat(whatsapp): thread with message bubbles and day dividers"
```

---

## Task 16 — Composer (text + emoji + templates)

**Files:**
- Create: `src/features/whatsapp/EmojiPicker.tsx`
- Create: `src/features/whatsapp/TemplatePicker.tsx`
- Create: `src/features/whatsapp/Composer.tsx`
- Modify: `src/features/whatsapp/Thread.tsx`

- [ ] **Step 16.1:** Criar `src/features/whatsapp/EmojiPicker.tsx` (lista simples — sem dependência nova):

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Smile } from 'lucide-react';

const EMOJIS = [
  '😀','😅','😉','😊','😍','🥰','😎','🤔','🙏','👍','👎','👌','💪','🙌','👏','🔥',
  '❤️','✨','🎉','✅','❌','⚠️','📞','📱','🚗','🛢️','🛠️','💰','🕒','📅','📍','💬',
];

interface Props { onPick: (emoji: string) => void }

export function EmojiPicker({ onPick }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        title="Emoji"
      >
        <Smile className="h-5 w-5" />
      </Button>
      {open && (
        <div
          className="absolute bottom-12 left-0 bg-popover border border-border rounded-md shadow-lg p-2 grid grid-cols-8 gap-1 z-10"
          onMouseLeave={() => setOpen(false)}
        >
          {EMOJIS.map((e) => (
            <button
              key={e}
              className="hover:bg-muted rounded p-1 text-xl"
              onClick={() => { onPick(e); setOpen(false); }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 16.2:** Criar `src/features/whatsapp/TemplatePicker.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Zap } from 'lucide-react';
import { useTemplates } from './api';

interface Props { onPick: (body: string) => void }

export function TemplatePicker({ onPick }: Props) {
  const [open, setOpen] = useState(false);
  const { data } = useTemplates();
  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        title="Templates"
      >
        <Zap className="h-5 w-5" />
      </Button>
      {open && (
        <div
          className="absolute bottom-12 left-0 w-72 bg-popover border border-border rounded-md shadow-lg p-2 z-10 max-h-72 overflow-y-auto"
          onMouseLeave={() => setOpen(false)}
        >
          {!data?.items.length && (
            <p className="text-xs text-muted-foreground p-3">Nenhum template salvo.</p>
          )}
          {data?.items.map((t) => (
            <button
              key={t.id}
              className="w-full text-left p-2 hover:bg-muted rounded"
              onClick={() => { onPick(t.body); setOpen(false); }}
            >
              <div className="text-sm font-medium">{t.title}</div>
              <div className="text-xs text-muted-foreground line-clamp-2">{t.body}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 16.3:** Criar `src/features/whatsapp/Composer.tsx`:

```tsx
import { useState, type KeyboardEvent } from 'react';
import { Send, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmojiPicker } from './EmojiPicker';
import { TemplatePicker } from './TemplatePicker';
import { useSendMessage } from './api';

interface Props { conversationId: string }

export function Composer({ conversationId }: Props) {
  const [text, setText] = useState('');
  const send = useSendMessage(conversationId);

  async function doSend() {
    const body = text.trim();
    if (!body || send.isPending) return;
    try {
      await send.mutateAsync({ kind: 'text', body });
      setText('');
    } catch {
      toast.error('Falha ao enviar mensagem.');
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  }

  return (
    <div className="border-t border-border bg-background px-3 py-2 flex items-end gap-2">
      <TemplatePicker onPick={(body) => setText((t) => t + body)} />
      <EmojiPicker onPick={(e) => setText((t) => t + e)} />
      <Button type="button" variant="ghost" size="icon" disabled title="Anexar (Task 17)">
        <Paperclip className="h-5 w-5" />
      </Button>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="Digite uma mensagem (Enter envia, Shift+Enter quebra linha)"
        className="flex-1 min-h-[40px] max-h-32 resize-none"
        rows={1}
      />
      <Button
        type="button"
        size="icon"
        onClick={doSend}
        disabled={!text.trim() || send.isPending}
        className="rounded-full"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 16.4:** Atualizar `Thread.tsx` para incluir o Composer no rodapé. Substituir o `return` final:

```tsx
return (
  <>
    <div className="flex-1 overflow-y-auto px-12 py-4">
      {blocks.map((b, i) => (
        <div key={i}>
          <DayDivider label={b.dayLabel} />
          {b.messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
    <Composer conversationId={conversationId} />
  </>
);
```

E adicionar `import { Composer } from './Composer';`.

- [ ] **Step 16.5:** Lint + commit.

```bash
npm run lint
git add src/features/whatsapp/EmojiPicker.tsx src/features/whatsapp/TemplatePicker.tsx src/features/whatsapp/Composer.tsx src/features/whatsapp/Thread.tsx
git commit -m "feat(whatsapp): composer with emoji + template pickers"
```

---

## Task 17 — Composer media upload (envio de imagem)

**Files:**
- Create: `src/features/whatsapp/MediaUpload.tsx`
- Modify: `src/features/whatsapp/Composer.tsx`

> **Nota:** O spec define que o frontend deveria fazer upload direto pro UazAPI. Como não temos credenciais de teste do UazAPI no escopo deste plano, esta v1 implementa o **fallback documentado no spec**: o frontend usa `mediaUrl` que o usuário já tem (cola URL pública). A integração real de upload fica explícita como "TODO de produção" no código — limpa, conhecida, sem placeholder no plano.

- [ ] **Step 17.1:** Criar `src/features/whatsapp/MediaUpload.tsx`:

```tsx
import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import type { MessageKind } from './types';

interface Props {
  onPick: (input: { kind: MessageKind; mediaUrl: string; mediaMime?: string; caption?: string }) => void;
}

// IMPORTANTE: a estratégia de produção é fazer upload direto pro UazAPI antes de
// enviar a mensagem (ver spec). Esta v1 aceita uma URL já pública — suficiente
// para validar fluxo enquanto a integração de upload é implementada como sub-tarefa.
export function MediaUpload({ onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<MessageKind>('image');
  const [caption, setCaption] = useState('');

  function submit() {
    if (!url.trim()) return;
    onPick({ kind, mediaUrl: url.trim(), caption: caption.trim() || undefined });
    setOpen(false);
    setUrl(''); setCaption(''); setKind('image');
  }

  return (
    <>
      <Button type="button" variant="ghost" size="icon" title="Anexar mídia" onClick={() => setOpen(true)}>
        <Paperclip className="h-5 w-5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anexar mídia</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as MessageKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Imagem</SelectItem>
                  <SelectItem value="document">Documento</SelectItem>
                  <SelectItem value="video">Vídeo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>URL pública da mídia</Label>
              <Input
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                A v1 aceita URL pública. Upload direto pro UazAPI será adicionado em sub-tarefa futura.
              </p>
            </div>
            <div>
              <Label>Legenda (opcional)</Label>
              <Input value={caption} onChange={(e) => setCaption(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={!url.trim()}>Anexar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 17.2:** Atualizar `src/features/whatsapp/Composer.tsx` pra integrar MediaUpload. Substituir o arquivo todo por:

```tsx
import { useState, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmojiPicker } from './EmojiPicker';
import { TemplatePicker } from './TemplatePicker';
import { MediaUpload } from './MediaUpload';
import { useSendMessage } from './api';

interface Props { conversationId: string }

export function Composer({ conversationId }: Props) {
  const [text, setText] = useState('');
  const send = useSendMessage(conversationId);

  async function sendText() {
    const body = text.trim();
    if (!body || send.isPending) return;
    try {
      await send.mutateAsync({ kind: 'text', body });
      setText('');
    } catch {
      toast.error('Falha ao enviar mensagem.');
    }
  }

  async function sendMedia(input: { kind: 'image' | 'document' | 'video' | 'audio'; mediaUrl: string; mediaMime?: string; caption?: string }) {
    try {
      await send.mutateAsync({
        kind: input.kind,
        mediaUrl: input.mediaUrl,
        mediaMime: input.mediaMime,
        body: input.caption,
      });
      toast.success('Mídia enviada.');
    } catch {
      toast.error('Falha ao enviar mídia.');
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  }

  return (
    <div className="border-t border-border bg-background px-3 py-2 flex items-end gap-2">
      <TemplatePicker onPick={(body) => setText((t) => t + body)} />
      <EmojiPicker onPick={(e) => setText((t) => t + e)} />
      <MediaUpload
        onPick={(input) => sendMedia({
          kind: input.kind as 'image' | 'document' | 'video' | 'audio',
          mediaUrl: input.mediaUrl,
          mediaMime: input.mediaMime,
          caption: input.caption,
        })}
      />
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="Digite uma mensagem (Enter envia, Shift+Enter quebra linha)"
        className="flex-1 min-h-[40px] max-h-32 resize-none"
        rows={1}
      />
      <Button
        type="button"
        size="icon"
        onClick={sendText}
        disabled={!text.trim() || send.isPending}
        className="rounded-full"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 17.3:** Lint + commit.

```bash
npm run lint
git add src/features/whatsapp/MediaUpload.tsx src/features/whatsapp/Composer.tsx
git commit -m "feat(whatsapp): media attach via public URL (v1)"
```

---

## Task 18 — Lead Sidebar + Chat Header (claim/queue/close)

**Files:**
- Create: `src/features/whatsapp/LeadSidebar.tsx`
- Create: `src/features/whatsapp/ChatHeader.tsx`
- Modify: `src/pages/whatsapp/WhatsappPage.tsx`

- [ ] **Step 18.1:** Criar `src/features/whatsapp/LeadSidebar.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useConversations } from './api';
import { avatarInitials, formatPhoneBR } from './helpers';
import type { ConversationFilters, PublicConversation } from './types';

interface Props {
  conversationId: string;
  filters: ConversationFilters;
}

const STATUS_LABEL: Record<PublicConversation['lead']['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  frio: { label: 'Frio', variant: 'secondary' },
  morno: { label: 'Morno', variant: 'default' },
  quente: { label: 'Quente', variant: 'destructive' },
};

export function LeadSidebar({ conversationId, filters }: Props) {
  // Reaproveita a lista para evitar request extra — encontra a conv selecionada lá.
  const { data, isLoading } = useConversations(filters);
  const conv = data?.items.find((c) => c.id === conversationId);

  if (isLoading || !conv) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-24 w-24 rounded-full mx-auto" />
        <Skeleton className="h-4 w-32 mx-auto" />
        <Skeleton className="h-3 w-24 mx-auto" />
      </div>
    );
  }

  const status = STATUS_LABEL[conv.lead.status];
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-6 pb-4 border-b border-border bg-muted/30 text-center">
        <Avatar className="h-20 w-20 mx-auto">
          <AvatarFallback className="bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-2xl font-semibold">
            {avatarInitials(conv.lead.name)}
          </AvatarFallback>
        </Avatar>
        <h3 className="mt-3 text-base font-semibold">{conv.lead.name}</h3>
        <p className="text-xs text-muted-foreground">{formatPhoneBR(conv.phone)}</p>
        <Badge variant={status.variant} className="mt-2">{status.label}</Badge>
      </div>

      <div className="px-4 py-3 border-b border-border">
        <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Veículo</h4>
        <Row label="Modelo" value={conv.lead.vehicleModel ?? '—'} />
        <Row label="Placa" value={conv.lead.vehiclePlate ?? '—'} />
      </div>

      <div className="px-4 py-3 border-b border-border">
        <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Atendimento</h4>
        <Row label="Fila" value={QUEUE_LABEL[conv.queue]} />
        <Row label="Dono" value={conv.assignedTo?.name ?? 'Sem dono'} />
        <Row label="Origem" value={conv.originKind === 'campaign' ? 'Campanha' : 'Orgânica'} />
      </div>

      <div className="mt-auto p-4 space-y-2">
        <Button asChild variant="default" className="w-full">
          <Link to="/cadastros">Editar lead →</Link>
        </Button>
      </div>
    </div>
  );
}

const QUEUE_LABEL: Record<PublicConversation['queue'], string> = {
  ia: 'IA',
  recepcao: 'Recepção',
  comercial: 'Comercial',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
```

- [ ] **Step 18.2:** Criar `src/features/whatsapp/ChatHeader.tsx`:

```tsx
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useChangeQueue, useClaimConversation, useCloseConversation } from './api';
import { avatarInitials, formatPhoneBR } from './helpers';
import { CONVERSATION_QUEUES } from '@shared/types';
import type { PublicConversation } from './types';

const QUEUE_LABEL: Record<PublicConversation['queue'], string> = {
  ia: 'IA', recepcao: 'Recepção', comercial: 'Comercial',
};

export function ChatHeader({ conv, currentUserId }: { conv: PublicConversation; currentUserId: string }) {
  const claim = useClaimConversation();
  const changeQueue = useChangeQueue();
  const close = useCloseConversation();

  const isMine = conv.assignedTo?.id === currentUserId;
  const subtitle = [
    formatPhoneBR(conv.phone),
    conv.lead.vehicleModel,
    conv.lead.vehiclePlate,
  ].filter(Boolean).join(' · ');

  async function doClaim() {
    try {
      await claim.mutateAsync(conv.id);
      toast.success('Conversa atribuída a você.');
    } catch { toast.error('Falha ao atribuir.'); }
  }

  async function doMove(q: PublicConversation['queue']) {
    try {
      await changeQueue.mutateAsync({ id: conv.id, queue: q });
      toast.success(`Movida para ${QUEUE_LABEL[q]}.`);
    } catch { toast.error('Falha ao mover.'); }
  }

  async function doClose() {
    try {
      await close.mutateAsync(conv.id);
      toast.success('Conversa encerrada.');
    } catch { toast.error('Falha ao encerrar.'); }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-background">
      <Avatar className="h-9 w-9">
        <AvatarFallback className="bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-sm">
          {avatarInitials(conv.lead.name)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">{conv.lead.name}</div>
        <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
      </div>
      <div className="flex gap-2">
        {!conv.assignedTo && (
          <Button size="sm" variant="default" onClick={doClaim} disabled={claim.isPending}>
            Pegar conversa
          </Button>
        )}
        {conv.assignedTo && !isMine && (
          <Button size="sm" variant="outline" onClick={doClaim} disabled={claim.isPending}>
            Reatribuir a mim
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">Mover ▾</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {CONVERSATION_QUEUES.filter((q) => q !== conv.queue).map((q) => (
              <DropdownMenuItem key={q} onSelect={() => doMove(q)}>
                Para {QUEUE_LABEL[q]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {conv.status !== 'encerrada' && (
          <Button size="sm" variant="destructive" onClick={doClose} disabled={close.isPending}>
            Encerrar
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 18.3:** Atualizar `src/pages/whatsapp/WhatsappPage.tsx` para incluir ChatHeader e LeadSidebar. Substituir os blocos de `<main>` e `<aside>` direita por:

```tsx
<main className="flex flex-col bg-muted/10">
  {selectedConv ? (
    <>
      <ChatHeader conv={selectedConv} currentUserId={currentUserId} />
      <Thread conversationId={selectedConv.id} />
    </>
  ) : (
    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
      Selecione uma conversa
    </div>
  )}
</main>

<aside className="border-l border-border bg-background overflow-y-auto">
  {selectedConv && <LeadSidebar conversationId={selectedConv.id} filters={filters} />}
</aside>
```

E lá no topo, mudar `selectedConvId` para `selectedConv` (objeto completo) — usar a lista de conversas pra obter:

```tsx
import { useConversations } from '@/features/whatsapp/api';
import { ChatHeader } from '@/features/whatsapp/ChatHeader';
import { LeadSidebar } from '@/features/whatsapp/LeadSidebar';

// dentro do componente:
const { data: convsData } = useConversations(filters);
const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
const selectedConv = convsData?.items.find((c) => c.id === selectedConvId) ?? null;
```

(O `ConversationList` continua disparando suas próprias queries via TanStack — `useConversations` é cacheado pela queryKey, então **não tem request duplicado**.)

- [ ] **Step 18.4:** Lint + commit.

```bash
npm run lint
git add src/features/whatsapp/LeadSidebar.tsx src/features/whatsapp/ChatHeader.tsx src/pages/whatsapp/WhatsappPage.tsx
git commit -m "feat(whatsapp): chat header actions + lead sidebar"
```

---

## Task 19 — README + roadmap update + verificação final

**Files:**
- Modify: `README.md`

- [ ] **Step 19.1:** Atualizar a seção "Próximos sub-projetos" do `README.md` para marcar item 4. Localizar o bloco `## Próximos sub-projetos` e atualizar:

```markdown
## Próximos sub-projetos
1. ✅ Admin/RBAC — gestão de usuários e permissões
2. ✅ Cadastros — leads completos + import CSV
3. Inside Sales — pipeline kanban / CRM
4. ✅ WhatsApp Inbox — conversas com filas + composer
5. Disparo em massa de campanhas
6. IA de pré-qualificação
7. Dashboard de Funil — métricas e conversão
```

- [ ] **Step 19.2:** Adicionar uma nova seção "WhatsApp Inbox" no `README.md`, depois da seção "Cadastros". Formato:

```markdown
## WhatsApp Inbox

Tela em `/whatsapp` (qualquer usuário autenticado) com:

- 3 colunas: lista de conversas (filtrada por fila + chips) | thread | sidebar do lead.
- **Filas:** IA / Recepção / Comercial. Conversa nova entra em **Recepção**. Movimentação manual via "Mover ▾".
- **Status (filtros):** Aguardando / Em atendimento / Encerradas / Expiradas 24h / Sem retorno.
- **Atribuição manual:** botão "Pegar conversa" vira o operador dono. Auto-claim na primeira mensagem outbound.
- **Composer:** texto + emoji + templates de resposta + anexar mídia (via URL pública na v1).
- **Polling:** TanStack Query 5s (lista) / 2.5s (thread aberta) / 5s (contadores).

Configurar no `.env`:

```
UAZAPI_BASE_URL=https://api.uazapi.com
UAZAPI_TOKEN=...
UAZAPI_INSTANCE_ID=...
UAZAPI_WEBHOOK_SECRET=...    # gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
NO_RESPONSE_DAYS=7
```

Configure o webhook no painel do UazAPI apontando pra `https://<seu-host>/api/whatsapp/webhook` com header `X-Webhook-Token: <UAZAPI_WEBHOOK_SECRET>`.
```

- [ ] **Step 19.3:** Rodar a suíte completa de testes pra garantir nada quebrou.

```bash
npm test
```

Esperado: todos os testes passando, incluindo os ~40 do Cadastros + ~30 novos = ~70+ testes.

- [ ] **Step 19.4:** Lint completo.

```bash
npm run lint
```

Esperado: limpo.

- [ ] **Step 19.5:** Commit final.

```bash
git add README.md
git commit -m "docs: mark WhatsApp Inbox roadmap item complete and add usage section"
```

---

## Self-Review Checklist (do plano contra a spec)

**1. Spec coverage:**
- ✅ Schema (3 tabelas + enums + indexes) → Task 1
- ✅ Tipos compartilhados → Task 1
- ✅ UazAPI client (sendMessage) → Task 3
- ✅ Webhook payload schema → Task 4
- ✅ Webhook handler (auth, idempotência, lead match/create, upsert conv, reabertura, mídia) → Task 5
- ✅ Conversation list com filtros (queue, status, expired24h, noResponse, origin, campaignId, assignment, q) → Task 6
- ✅ Conversation counts → Task 6
- ✅ Conversation detail/messages com paginação reversa → Task 7
- ✅ Conversation actions (claim, queue, close, read) com auto-claim → Task 8 + Task 9
- ✅ Send message com mock UazAPI + 502 + auto-claim + mídia → Task 9
- ✅ Message templates CRUD → Task 10
- ✅ Frontend hooks + helpers → Task 11
- ✅ Page shell + queue tabs → Task 12
- ✅ FilterBar com URL params (5 chips status, 3 chips assignment, 2 chips origin) → Task 13
- ✅ Conversation list + row → Task 14
- ✅ Thread + bubbles + day dividers + auto-scroll + markRead → Task 15
- ✅ Composer com emoji + templates + texto → Task 16
- ✅ Composer com mídia (v1: URL pública) → Task 17
- ✅ Lead sidebar + Chat header (claim/queue/close) → Task 18
- ✅ README + roadmap → Task 19

**2. Placeholder scan:** sem TBD/TODO/FIXME no plano. As referências a "fallback de upload" no Task 17 são instruções concretas executáveis, não placeholders.

**3. Type consistency:**
- `ConversationFilters` definido em Task 1; usado em Task 6, 11, 13, 14, 18 — consistente.
- `PublicConversation`, `PublicMessage`, `PublicMessageTemplate` definidos em Task 1; consumidos coerentemente.
- `useConversations(filters)` aceita o mesmo objeto em todas as referências — Task 11 expõe, Task 14/18 consomem.
- `useSendMessage(conversationId)` toma id, retorna mutate — usado consistentemente em Task 16/17.
- `MESSAGE_KINDS` enum match entre schema, tipos, controller, composer.

**4. Ambiguidade:** todas as decisões críticas (auto-claim, reabertura, idempotência, ordem das transições) têm pseudocódigo concreto.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-01-whatsapp-inbox-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatcher agent + um implementer subagent por task + dois revisores (spec compliance + code quality) por task. Fast iteration, two-stage review automático.

**2. Inline Execution** — executar inline com checkpoints manuais.

**Which approach?**
