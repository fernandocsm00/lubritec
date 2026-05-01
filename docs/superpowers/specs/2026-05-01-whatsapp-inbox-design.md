# WhatsApp Inbox — Design

**Sub-projeto 4 do roadmap.** Inbox completo (lista + thread + composer) com filas (IA / Recepção / Comercial), atribuição manual e gestão de grande volume pós-disparo de campanha. Construído sobre auth/RBAC + Cadastros.

## Objetivo

Permitir à equipe da Lubritec ver, atribuir e responder conversas do WhatsApp dentro do LubriConnect, organizadas por filas e com filtros que aguentem o volume gerado por disparos em massa (que serão feitos em sub-projeto futuro).

Gateway: **UazAPI** (mesmo do CRM_ORION). Webhook recebe mensagens entrantes; REST envia respostas.

## Decisões fixadas (brainstorming)

- **Escopo:** B — inbox completo (lista + thread + composer), não apenas read-only.
- **Filas:** existem como rótulos (IA / Recepção / Comercial). Toda conversa nova entra em **Recepção** por padrão. Movimentação manual via dropdown "Mover" no header. Fila "IA" fica vazia até existir bot — sub-projeto futuro.
- **IA:** sub-projeto separado. Schema preparado mas sem implementação agora.
- **Composer:** texto + emoji + mídia (envio e recepção) + templates de resposta. **Áudio gravado fica fora.**
- **Instância WhatsApp:** uma só. Sem tabela de instâncias; token UazAPI em env vars.
- **Atribuição:** manual. Conversa entra sem dono; operador clica "Pegar conversa" pra virar dono. Reatribuível. Indicador "Em atendimento por X" na lista.
- **Realtime:** polling com TanStack Query (5s lista / 2.5s thread / 5s contadores de fila).
- **Lifecycle:** 3 estados armazenados (`aguardando_atendimento`, `em_atendimento`, `encerrada`); 5 filtros visíveis (os 3 + `expirada_24h` + `sem_retorno`, esses dois derivados em query).
- **Conversa ↔ Lead:** auto-cria lead com `name = phone`, `source = 'whatsapp'` se não bater telefone. Sempre vinculada (`lead_id NOT NULL`).
- **Persistência de mídia:** Opção 3 (híbrida) — mensagens persistidas em PG, mídia fica como URL apontando pro UazAPI (sem download de bytes).
- **Disparo em massa:** **fora do escopo deste sub-projeto.** Schema só prepara `origin_kind` e `origin_campaign_id`.

## Schema

Migration `009_whatsapp.sql` (próximo número disponível — 007 e 008 já existem):

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
  origin_campaign_id  uuid,                        -- FK virá quando campanhas existirem
  last_message_at     timestamptz NOT NULL DEFAULT now(),
  last_inbound_at     timestamptz,                 -- usado pra filtro expirada_24h
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
  media_url       text,                       -- URL UazAPI (sem download de bytes)
  media_mime      text,
  sent_by_user_id uuid REFERENCES users(id),  -- só preenchido em direction='out'
  uazapi_msg_id   text UNIQUE,                -- idempotência do webhook
  raw_payload     jsonb NOT NULL,
  sent_at         timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_msg_conv_sent ON messages(conversation_id, sent_at DESC);

-- Templates de resposta (composer)
CREATE TABLE message_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

### Constantes compartilhadas

`shared/types.ts`:

```ts
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
```

### Decisões importantes

- **`phone` UNIQUE em conversations** → uma conversa por telefone para sempre. Reabertura: status volta de `encerrada` para `aguardando_atendimento`.
- **`lead_id NOT NULL`** → toda conversa tem lead vinculado (auto-criado se preciso).
- **`uazapi_msg_id UNIQUE`** → webhook duplicado vira no-op silencioso.
- **`raw_payload jsonb`** → sempre persiste payload bruto. Debug e mudanças do gateway sem migration.
- **Sem `whatsapp_instances`** → uma instância só, configurada via env (`UAZAPI_BASE_URL`, `UAZAPI_TOKEN`, `UAZAPI_INSTANCE_ID`, `UAZAPI_WEBHOOK_SECRET`).

## Endpoints

Todos atrás de `authGuard`, **exceto o webhook** (público, valida secret próprio). Sem `requireRole` — qualquer role autenticado acessa.

### `POST /api/whatsapp/webhook` *(público)*

Validação:

- Header `X-Webhook-Token` deve ser igual a `process.env.UAZAPI_WEBHOOK_SECRET`. Se ausente/diferente → `401`.
- Body parseado com Zod (schema `uazapiInboundSchema` baseado na doc UazAPI).
- Eventos diferentes de `message.received` retornam `200` sem efeito.

Fluxo de mensagem entrante:

1. Idempotência: se já existe `messages.uazapi_msg_id` para este id, no-op (`200`).
2. Dentro de uma transação:
   - **Match lead** por `phone` normalizado (só dígitos). Se não bater, **auto-cria** lead com `phone`, `name = phone`, `source = 'whatsapp'`, `status = 'frio'`. Em caso de race condition (constraint `leads.phone UNIQUE` violada), refaz a query.
   - **Upsert conversation** por `phone`:
     - Não existe → INSERT com `queue = 'recepcao'`, `status = 'aguardando_atendimento'`, `origin_kind = 'organic'`.
     - Existe e está `encerrada` → UPDATE para `aguardando_atendimento`. (Reabertura automática.)
     - Existe e ativa → UPDATE só timestamps + `unread_count++`.
   - INSERT em `messages` com `direction = 'in'`, `kind` detectado pelo payload, `body`/`media_url` conforme tipo, `uazapi_msg_id`, `raw_payload`, `sent_at` do payload.
   - UPDATE `last_message_at = sent_at`, `last_inbound_at = sent_at`.
3. Sempre responde `200` no final (UazAPI retentaria infinitamente em 5xx).

### `GET /api/conversations`

Query params:

| Param | Tipo | Descrição |
|---|---|---|
| `queue` | `ia` \| `recepcao` \| `comercial` | filtro de fila |
| `status` | CSV de status | `aguardando_atendimento,em_atendimento,encerrada` |
| `expired24h` | bool | true → `status != encerrada AND last_inbound_at < now() - 24h` |
| `noResponse` | bool | true → `origin_kind = 'campaign' AND nenhuma msg in AND created_at < now() - 7d` (M = 7 dias, configurável via env) |
| `origin` | CSV de origem | `organic,campaign` |
| `campaignId` | uuid | filtra `origin_campaign_id` |
| `assignment` | `mine` \| `unassigned` \| `all` | `mine` = `assigned_to = req.user.id`; `unassigned` = `assigned_to IS NULL` |
| `q` | string | busca em `leads.name`, `phone`, `messages.body` (LIKE simples) |
| `page` | int ≥ 1 | default 1 |

Resposta:

```json
{
  "items": [{
    "id": "...",
    "phone": "...",
    "lead": { "id": "...", "name": "...", "vehiclePlate": "...", "vehicleModel": "...", "status": "morno" },
    "queue": "recepcao",
    "status": "aguardando_atendimento",
    "assignedTo": { "id": "...", "name": "..." } | null,
    "lastMessagePreview": "Quero saber o preço...",
    "lastMessageDirection": "in",
    "lastMessageAt": "2026-05-01T14:32:00Z",
    "unreadCount": 2,
    "originKind": "organic",
    "isExpired24h": false
  }],
  "total": 234,
  "page": 1,
  "pageSize": 50
}
```

`isExpired24h` é calculado na query (não armazenado).

### `GET /api/conversations/counts`

Retorna contadores para as tabs de fila (uso em polling rápido):

```json
{ "ia": 0, "recepcao": 14, "comercial": 3 }
```

Considera apenas conversas com `status != 'encerrada'`.

### `GET /api/conversations/:id`

Retorna a conversa completa, incluindo dados do lead expandidos.

### `GET /api/conversations/:id/messages`

Query params: `before` (ISO timestamp) para paginação reversa (scroll infinito).

```json
{ "items": [{ /* PublicMessage */ }], "hasMore": true }
```

Page size fixo: 50.

### `POST /api/conversations/:id/messages`

Envia mensagem. Body:

```json
{ "kind": "text" | "image" | "audio" | "video" | "document",
  "body": "...",       // obrigatório se kind=text
  "mediaUrl": "...",   // obrigatório se kind!=text
  "mediaMime": "..." }
```

Fluxo:

1. Busca conversa; 404 se não existir.
2. Chama `uazapiClient.sendMessage(...)`. Se falhar → `502` e nada é persistido.
3. INSERT em `messages` com `direction = 'out'`, `sent_by_user_id = req.user.id`, `uazapi_msg_id` da resposta, `sent_at = now()`.
4. UPDATE conversa: `last_message_at`, **auto-claim** se `assigned_to IS NULL` (vira `assigned_to = req.user.id`, `status = 'em_atendimento'`).

### `POST /api/conversations/:id/claim`

Vira o usuário logado dono da conversa, status passa pra `em_atendimento`. Idempotente.

### `POST /api/conversations/:id/queue`

Body: `{ "queue": "ia" | "recepcao" | "comercial" }`. Move conversa entre filas.

### `POST /api/conversations/:id/close`

Status → `encerrada`. (Quando cliente mandar nova mensagem, reabre automaticamente via webhook.)

### `POST /api/conversations/:id/read`

Zera `unread_count`. Chamado pelo frontend ao abrir a conversa.

### `GET /api/message-templates` / `POST` / `PATCH /:id` / `DELETE /:id`

CRUD simples de templates de resposta. Acessível por qualquer role autenticado. Sem RBAC adicional.

## Frontend

### Estrutura de arquivos

```
src/
  pages/whatsapp/
    WhatsappPage.tsx               # shell 3 colunas + roteamento de seleção
  features/whatsapp/
    api.ts                         # hooks TanStack Query
    QueueTabs.tsx                  # IA / Recepção / Comercial com contadores live
    FilterBar.tsx                  # status, origem, campanha, atribuição, busca
    ConversationList.tsx
    ConversationRow.tsx
    Thread.tsx
    MessageBubble.tsx
    DayDivider.tsx
    Composer.tsx
    EmojiPicker.tsx
    TemplatePicker.tsx
    MediaUpload.tsx
    LeadSidebar.tsx
    ChatHeader.tsx                 # nome + ações (Pegar/Mover/Encerrar)
    helpers.ts                     # normalizePhone, formatRelativeTime, detectKind
```

### Layout

3 colunas (proporção: 380px / flex / 340px):

- **Coluna 1 (lista):**
  - Header: título "Inbox" + botão filtros.
  - Tabs IA / Recepção / Comercial com contadores live (polling 5s).
  - Busca texto.
  - Filtros (chips multi-select): status (5), origem (2), atribuição (3), campanha (dropdown).
  - Lista paginada (50/page) ordenada por `last_message_at DESC`.
  - Cada linha: avatar, nome (ou phone), preview da última mensagem, hora relativa, indicador de dono ("Em atendimento por você" / "por X" / "Sem dono"), badge de não-lidas.

- **Coluna 2 (thread):**
  - Header: avatar + nome + telefone + resumo do veículo. Botões: "Pegar conversa" (se sem dono), "Mover ▾", "Encerrar".
  - Mensagens com bolhas dark (entrada → cinza escuro alinhado à esquerda; saída → verde-azulado escuro alinhado à direita). Day dividers ("HOJE", "ONTEM", "DD/MM").
  - Composer: 📎 anexar, 😊 emoji, ⚡ template, textarea (Enter envia, Shift+Enter quebra linha), botão circular Enviar.

- **Coluna 3 (sidebar lead):**
  - Cover: avatar grande, nome, telefone, badge de status do lead.
  - Seção Veículo (modelo, placa, última troca, km/dia).
  - Seção Atendimento (fila, dono, aberta desde).
  - Botões: "Editar lead →" (link pra `/cadastros` modo edição), "Histórico de campanhas" (placeholder até existir).

Estética: dark, inspirado em WhatsApp Web. Acento `--accent-bright: #4f8df0` (variação clara do `lubritec-blue`). Bolhas de mensagem com border-radius assimétrico (canto superior chanfrado, ao estilo WhatsApp).

### Polling com TanStack Query

```ts
useConversations(filters)       // refetchInterval: 5_000
useMessages(conversationId)     // refetchInterval: 2_500
useQueueCounts()                // refetchInterval: 5_000
```

Backend retorna `304 Not Modified` quando nada mudou (header `If-Modified-Since`). TanStack mantém os dados anteriores. Pause em background tab (`refetchIntervalInBackground: false`).

### Estado dos filtros em URL

Filtros persistem em URL params: `/whatsapp?queue=recepcao&status=aguardando_atendimento,em_atendimento&origin=campaign`. Atualização via `useSearchParams`. Compartilhamento e voltar do browser funcionam.

### Comportamentos

- Abrir conversa → `POST /conversations/:id/read` → zera `unread_count`.
- Auto-scroll pro final ao abrir e a cada nova mensagem entrante (se já estava no fim).
- Conversa que muda de fila some da aba atual; aparece na nova.
- "Pegar conversa" muda status pra `em_atendimento` + assigned_to=user.
- Send falha → toast de erro vermelho, mensagem não é persistida, usuário tenta de novo.

## Cliente UazAPI (server)

`server/services/uazapiClient.ts`:

```ts
class UazapiClient {
  async sendMessage(opts: SendMessageOpts): Promise<UazapiSendResponse> {
    const endpoint = opts.kind === 'text'
      ? '/v1/messages/text'
      : '/v1/messages/media';
    const res = await fetch(`${env.UAZAPI_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.UAZAPI_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instance_id: env.UAZAPI_INSTANCE_ID,
        to: opts.to,
        text: opts.text,
        media_url: opts.mediaUrl,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new UazapiError(res.status, await res.text());
    return res.json();
  }
}
```

**Upload de mídia (composer):** frontend faz upload **direto pro UazAPI** e recebe um `mediaUrl`, depois chama nosso `POST /api/conversations/:id/messages` apenas com `{ kind, mediaUrl, mediaMime }`. Backend é stateless quanto a mídia.

Se o UazAPI não suportar upload-then-send separado, fallback: nosso backend recebe via multer (memory storage, máx 16MB), repassa direto pro UazAPI sem persistir em disco. Decidir após ler doc do UazAPI durante implementação.

## Variáveis de ambiente

Adicionar em `.env.example`:

```
UAZAPI_BASE_URL=https://api.uazapi.com
UAZAPI_TOKEN=
UAZAPI_INSTANCE_ID=
UAZAPI_WEBHOOK_SECRET=
NO_RESPONSE_DAYS=7              # M dias para conversa de campanha virar "sem retorno"
```

## Testes

Mesmo padrão do Cadastros: Vitest + Supertest, schema `lubritec_test`, banco truncado entre testes.

| Arquivo | Cobertura |
|---|---|
| `whatsapp-webhook.test.ts` | Validação de secret (401), idempotência por `uazapi_msg_id`, auto-criação de lead, upsert de conversation, reabertura de `encerrada`, atualização de `last_inbound_at`, ignora eventos não-mensagem, race condition de telefone novo simultâneo |
| `conversations-list.test.ts` | Filtros (queue, status, expired24h, noResponse, origin, campaignId, assignment, q), paginação, ordenação, contadores `/counts` |
| `conversations-detail.test.ts` | GET conversa, GET messages com paginação reversa via `before` |
| `conversations-actions.test.ts` | Claim (idempotente), change-queue, close, read (zera unread) |
| `conversations-send.test.ts` | Send text + media com `uazapiClient` mockado (`vi.mock`), 502 quando UazAPI falha, persistência só após sucesso, auto-claim na primeira mensagem outbound |
| `message-templates.test.ts` | CRUD básico de templates |

**Mock do UazAPI:** `vi.mock('../services/uazapiClient', ...)` em todos os testes de envio. Não chamamos a API real.

**Fixtures de webhook:** `server/tests/fixtures/uazapi-inbound-text.json`, `uazapi-inbound-image.json`, `uazapi-inbound-audio.json` com payloads representativos.

**Frontend:** sem testes adicionais nesta v1. Coberto por smoke manual.

**Lint + type-check:** obrigatórios (mesmo padrão do Cadastros).

Meta de cobertura: ~30 testes novos.

## Performance

- Lista paginada (50/page).
- Messages paginadas por scroll infinito reverso (50 por chunk).
- `unread_count` armazenado, evita `COUNT(*)` em cada poll.
- Index `(queue, status, last_message_at DESC)` cobre query principal.
- Index `last_inbound_at WHERE status != 'encerrada'` cobre filtro `expired24h`.
- Index `(origin_kind, origin_campaign_id)` cobre filtros de origem.
- Volume estimado: 100-500 conversas ativas, 10k mensagens/mês — dentro do confortável pra um único Postgres.

## Segurança

- Webhook UazAPI valida secret no header `X-Webhook-Token`. Sem secret correto → 401.
- Composer e ações sob `authGuard`. `sent_by_user_id` registra quem mandou cada mensagem outbound.
- Sem RBAC adicional: qualquer role autenticado vê e responde qualquer conversa. Multi-tenant fica fora desta v1.
- Telefones e payloads logados em níveis discretos. `raw_payload jsonb` pode conter PII — não exibir em logs de produção.

## Fora de escopo (sub-projetos futuros)

- **IA de pré-qualificação** — sub-projeto separado. Fila "IA" fica vazia.
- **Disparo em massa de campanhas** — UI de blast + editor de template + agendamento. Schema já prepara `origin_campaign_id`.
- **Dashboard de funil** — métricas de conversão por fila/atendente.
- **Áudio gravado no composer** — exige permissão de microfone, encoding, preview.
- **Anotações internas / notas privadas** na conversa (visíveis só pra equipe).
- **Multi-instância WhatsApp** — uma só por enquanto.
- **Notificações desktop / mobile push** quando chega mensagem nova.
- **Multi-tenancy real** (RBAC por equipe) — fica pra quando virar SaaS multi-empresa.
- **SSE / WebSocket** — migração futura quando polling virar gargalo.

## Roadmap pós-MVP

1. ✅ Auth/RBAC
2. ✅ Cadastros (leads + import CSV)
3. **WhatsApp Inbox (este sub-projeto)**
4. Disparo em massa de campanhas + relatórios
5. IA de pré-qualificação (popula fila IA com bot)
6. Dashboard de funil
