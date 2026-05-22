# Spec — WhatsApp Multi-Provider (UazAPI + Meta Cloud API)

**Data:** 2026-05-21
**Autor:** Fernando (Orion Digital) + Claude
**Projeto:** LubriConnect (SaaS Lubritec)
**Status:** Aprovado para implementação

---

## 1. Contexto e objetivo

Hoje o LubriConnect tem uma **única instância de WhatsApp** conectada via UazAPI (não-oficial, pareamento por QR). A row única na tabela `whatsapp_instance` carrega credenciais UazAPI hard-coded no schema.

A Lubritec quer **suporte multi-provider**: o admin escolhe na hora de adicionar uma nova linha se ela será conectada via **UazAPI** (atual) ou via **WhatsApp Cloud API oficial da Meta**. Múltiplas linhas de cada tipo podem coexistir no mesmo SaaS.

A Cloud API entra como provedor **completo** (não só pra campanhas): envia, recebe, e responde no inbox — exatamente como a UazAPI faz hoje, com as restrições oficiais da Meta (janela 24h, templates HSM aprovados para mensagens fora da janela).

**Princípio arquitetural central:** todo o código upstream (inbox, campanhas, webhook ingest, IA) fica provider-agnostic através de uma interface `WhatsAppProvider`. Cada provedor é um módulo isolado e testável.

---

## 2. Arquitetura geral

### 2.1 Nova estrutura de pastas

```
server/services/whatsapp/
  ├── provider.ts            # interface WhatsAppProvider + types comuns
  ├── providerRegistry.ts    # resolve provider por instance_id (lê DB, cacheia)
  ├── ingestInbound.ts       # pipeline comum: lead → conversation → message → IA
  ├── uazapi/
  │   ├── client.ts          # refactor de services/uazapiClient.ts atual
  │   ├── instanceClient.ts  # refactor de services/uazapiInstanceClient.ts
  │   ├── webhookHandler.ts  # extraído de services/whatsappWebhookService.ts
  │   └── provider.ts        # UazapiProvider implements WhatsAppProvider
  └── metaCloud/
      ├── client.ts          # fetch wrapper p/ graph.facebook.com
      ├── instanceClient.ts  # validação de credenciais, status
      ├── webhookHandler.ts  # valida HMAC, parseia payload, normaliza
      ├── templates.ts       # CRUD HSM via Graph API + sync status
      └── provider.ts        # MetaCloudProvider implements WhatsAppProvider
```

### 2.2 Interface `WhatsAppProvider`

```ts
export type ProviderKind = 'uazapi' | 'meta_cloud';

export interface WhatsAppProvider {
  readonly kind: ProviderKind;
  readonly instanceId: string;  // UUID nosso, não da Meta/Uaz

  // Status
  getStatus(): Promise<ProviderStatus>;
  connect(): Promise<ProviderStatus>;
  disconnect(): Promise<void>;

  // Envio
  sendText(opts: SendTextOpts): Promise<SendResult>;
  sendMedia(opts: SendMediaOpts): Promise<SendResult>;
  sendTemplate(opts: SendTemplateOpts): Promise<SendResult>;

  // Templates HSM (Meta only; Uaz retorna [])
  listTemplates(): Promise<TemplateRecord[]>;
  createTemplate(input: TemplateInput): Promise<TemplateRecord>;
  deleteTemplate(name: string, language: string): Promise<void>;

  // Capabilities (UI usa pra mostrar/esconder controles)
  capabilities(): ProviderCapabilities;
}

export interface ProviderCapabilities {
  freeFormText: boolean;             // Uaz: sempre. Meta: só dentro janela 24h.
  requiresApprovedTemplate: boolean; // Meta: true para fora-da-janela
  supportsMedia: boolean;
  supportsButtons: boolean;          // Meta: true via HSM; Uaz: limitado
}

export interface SendResult {
  providerMsgId: string;
  rawPayload: unknown;
}

export interface SendTemplateOpts {
  to: string;
  templateName: string;
  language: string;
  variables: Array<{ index: number; value: string }>;
  headerMedia?: { kind: 'image' | 'video' | 'document'; url: string };
}
```

### 2.3 Provider registry

```ts
// server/services/whatsapp/providerRegistry.ts
const cache = new Map<string, { provider: WhatsAppProvider; expiresAt: number }>();
const TTL_MS = 5 * 60 * 1000;

export async function resolveProvider(instanceId: string): Promise<WhatsAppProvider> {
  const hit = cache.get(instanceId);
  if (hit && hit.expiresAt > Date.now()) return hit.provider;

  const [row] = await db.select().from(whatsappInstance)
    .where(eq(whatsappInstance.id, instanceId)).limit(1);
  if (!row) throw new HttpError(404, 'Instance not found');

  const cfg = decryptProviderConfig(row.provider, row.providerConfig);
  const provider = row.provider === 'uazapi'
    ? new UazapiProvider(row.id, cfg)
    : new MetaCloudProvider(row.id, cfg);

  cache.set(instanceId, { provider, expiresAt: Date.now() + TTL_MS });
  return provider;
}

export function invalidateProvider(instanceId: string): void {
  cache.delete(instanceId);
}

export async function resolveDefaultProvider(): Promise<WhatsAppProvider> {
  const [row] = await db.select().from(whatsappInstance)
    .where(eq(whatsappInstance.isDefault, true)).limit(1);
  if (!row) throw new HttpError(503, 'No default WhatsApp instance configured');
  return resolveProvider(row.id);
}
```

`invalidateProvider` é chamado ao editar credenciais (PATCH /instances/:id) ou deletar.

---

## 3. Schema do banco

Migration: `server/db/migrations/012_whatsapp_multi_provider.sql`.

### 3.1 `whatsapp_instance` — virar multi-row + provider

```sql
ALTER TABLE whatsapp_instance DROP COLUMN singleton;

ALTER TABLE whatsapp_instance
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'uazapi'
    CHECK (provider IN ('uazapi','meta_cloud')),
  ADD COLUMN display_name TEXT NOT NULL DEFAULT 'Linha principal',
  ADD COLUMN provider_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT false;

-- Migra credenciais UazAPI para provider_config (criptografadas)
UPDATE whatsapp_instance SET
  provider_config = jsonb_build_object(
    'baseUrl', base_url,
    'instanceId', instance_id,
    'instanceToken', instance_token,  -- ATENÇÃO: precisa script Node pra criptografar
    'webhookSecret', webhook_secret,
    'webhookUrl', webhook_url,
    'webhookSynced', webhook_synced
  ),
  is_default = true;

ALTER TABLE whatsapp_instance
  DROP COLUMN base_url,
  DROP COLUMN instance_id,
  DROP COLUMN instance_token,
  DROP COLUMN webhook_secret,
  DROP COLUMN webhook_url,
  DROP COLUMN webhook_synced;

CREATE UNIQUE INDEX idx_whatsapp_instance_default
  ON whatsapp_instance ((is_default)) WHERE is_default = true;
```

**Schema final em Drizzle:**
```ts
export const whatsappInstance = pgTable('whatsapp_instance', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider', { enum: ['uazapi', 'meta_cloud'] }).notNull(),
  displayName: text('display_name').notNull(),
  phoneNumber: text('phone_number'),
  profileName: text('profile_name'),
  providerConfig: jsonb('provider_config').notNull().default({}),
  isDefault: boolean('is_default').notNull().default(false),
  isArchived: boolean('is_archived').notNull().default(false),
  lastStatus: text('last_status'),
  lastStatusAt: timestamp('last_status_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**`provider_config` shape por provider** (validado por zod em runtime):
```ts
// UazAPI
{ baseUrl: string, instanceId: string|null, instanceToken: string /*enc*/,
  webhookSecret: string|null, webhookUrl: string|null, webhookSynced: boolean }

// Meta Cloud
{ wabaId: string, phoneNumberId: string, businessId?: string,
  accessToken: string /*enc*/, appSecret: string /*enc*/,
  webhookVerifyToken: string }
```

### 3.2 Criptografia de credenciais

Novo módulo `server/lib/crypto.ts`:
- AES-256-GCM, chave em env `WHATSAPP_CREDENTIALS_KEY` (32 bytes hex).
- Formato armazenado: `enc:<iv_b64>:<tag_b64>:<ciphertext_b64>`.
- Migration tem script TypeScript que roda **antes** do drop de colunas: lê valores plaintext, criptografa, escreve no JSONB.
- Adicionar `WHATSAPP_CREDENTIALS_KEY` no `.env.example` com instrução de gerar via `openssl rand -hex 32`.

### 3.3 `conversations` — adicionar `instance_id`

```sql
ALTER TABLE conversations ADD COLUMN instance_id UUID
  REFERENCES whatsapp_instance(id) ON DELETE RESTRICT;

UPDATE conversations SET instance_id = (
  SELECT id FROM whatsapp_instance WHERE is_default LIMIT 1
);

ALTER TABLE conversations ALTER COLUMN instance_id SET NOT NULL;

ALTER TABLE conversations DROP CONSTRAINT conversations_phone_key;
CREATE UNIQUE INDEX idx_conversations_instance_phone
  ON conversations(instance_id, phone);
```

### 3.4 `messages` — generalizar id externo + provider

```sql
ALTER TABLE messages RENAME COLUMN uazapi_msg_id TO provider_msg_id;
ALTER TABLE messages ADD COLUMN provider TEXT NOT NULL DEFAULT 'uazapi'
  CHECK (provider IN ('uazapi','meta_cloud'));
ALTER TABLE messages DROP CONSTRAINT messages_uazapi_msg_id_key;
CREATE UNIQUE INDEX idx_messages_provider_msgid
  ON messages(provider, provider_msg_id) WHERE provider_msg_id IS NOT NULL;
```

### 3.5 Nova tabela `whatsapp_hsm_templates`

```sql
CREATE TABLE whatsapp_hsm_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES whatsapp_instance(id) ON DELETE CASCADE,
  meta_template_id TEXT,
  name TEXT NOT NULL,
  language TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION')),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED','PAUSED','DISABLED')),
  components JSONB NOT NULL,
  variable_count INT NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_hsm_instance_name_lang
  ON whatsapp_hsm_templates(instance_id, name, language);
CREATE INDEX idx_hsm_status ON whatsapp_hsm_templates(status);
```

### 3.6 `campaigns` — aceitar instância + HSM

```sql
ALTER TABLE campaigns
  ADD COLUMN instance_id UUID REFERENCES whatsapp_instance(id) ON DELETE RESTRICT,
  ADD COLUMN hsm_template_id UUID REFERENCES whatsapp_hsm_templates(id) ON DELETE RESTRICT,
  ADD COLUMN hsm_variables JSONB DEFAULT '[]'::jsonb;

UPDATE campaigns SET instance_id = (SELECT id FROM whatsapp_instance WHERE is_default LIMIT 1);
ALTER TABLE campaigns ALTER COLUMN instance_id SET NOT NULL;

-- Constraint de app (validada no service): exatamente um de
-- template_id (free-form Uaz) OU hsm_template_id (Meta) deve ser non-null.
```

`hsm_variables` shape:
```json
[
  {"index": 1, "source": "static", "value": "Lubritec"},
  {"index": 2, "source": "lead_field", "value": "name"}
]
```
Campaign worker substitui `{{1}}, {{2}}` no momento do envio resolvendo cada source.

---

## 4. Fluxo de conexão de números (Settings UI + backend)

### 4.1 Página `/settings/whatsapp` (reformulada)

Lista de cards (uma row por linha conectada). Cada card mostra:
- Indicador de status (🟢 conectado / 🟡 pareando / 🔴 erro / ⚫ desconectado)
- Nome de exibição (`display_name`)
- Provider badge (UazAPI / Meta Cloud)
- Número (`phone_number`)
- Ações (botão `⚙️` abre drawer com Reconectar, Logout, Definir como padrão, Excluir/Arquivar)

Botão `[+ Adicionar número]` no topo direito abre wizard.

### 4.2 Wizard — Step 1: escolher provider

Modal com 2 cards. UazAPI vs Meta Cloud, com bullets descritivos e botão `Selecionar` em cada.

### 4.3 Step 2A: UazAPI

Formulário curto (nome, URL UazAPI default do env, admin token) → `POST /api/whatsapp/instances` → backend cria row, chama `initInstance`, retorna `instanceId` UazAPI → UI transita pra view de QR (polling em `GET /api/whatsapp/instances/:id` igual hoje, escopado ao novo `:id`).

### 4.4 Step 2B: Meta Cloud

Formulário com:
- `display_name`
- `waba_id`
- `phone_number_id`
- `access_token` (Permanent Access Token — System User)
- `app_secret`

Tooltips com link pra docs Meta. Botão `[Validar e salvar]`:

1. Backend cria row com `provider='meta_cloud'`, config criptografada, `phone_number=null`.
2. Chama `GET https://graph.facebook.com/v20.0/{phone_number_id}?fields=display_phone_number,verified_name` com Bearer token.
3. Em erro Meta: HTTP 422 com mensagem amigável (`"Token inválido"`, `"Phone Number ID não encontrado"`); row é deletada.
4. Em sucesso: salva `phone_number` e `profile_name`, gera `webhookVerifyToken` aleatório (32 bytes hex) no `provider_config`.
5. Retorna pra UI: status + URL do webhook + verify token.

### 4.5 Step 3: cadastrar webhook na Meta (instruções)

Tela mostra ao admin os valores que ele precisa colar no Meta App → Webhooks:
- **Callback URL:** `https://lubriconnect.com.br/api/whatsapp/webhook/meta/{instanceId}`
- **Verify Token:** `<webhookVerifyToken gerado>`
- **Eventos para inscrever:** `messages`, `message_template_status_update`

Quando o admin clica "Subscribe" na Meta, ela chama nosso GET handler — se o token bater, a inscrição é confirmada. UI tem botão `[Verificar webhook]` que faz polling em `GET /api/whatsapp/instances/:id` esperando `provider_config.webhookSubscribed=true` (flag setada quando recebemos o primeiro hit válido).

### 4.6 Endpoints REST

```
GET    /api/whatsapp/instances                       # lista
POST   /api/whatsapp/instances                       # cria
GET    /api/whatsapp/instances/:id                   # status detalhado
PATCH  /api/whatsapp/instances/:id                   # display_name, is_default
POST   /api/whatsapp/instances/:id/connect           # Uaz: gera QR. Meta: re-valida.
POST   /api/whatsapp/instances/:id/disconnect
DELETE /api/whatsapp/instances/:id                   # 409 se há conversations vinculadas
POST   /api/whatsapp/instances/:id/sync-templates    # Meta only
GET    /api/whatsapp/instances/:id/webhook-info      # URL+verify token (Meta)

# Templates HSM
GET    /api/whatsapp/instances/:id/templates         # lista local (com filter status)
POST   /api/whatsapp/instances/:id/templates         # cria (DRAFT ou PENDING)
PATCH  /api/whatsapp/instances/:id/templates/:tid    # edita DRAFT
DELETE /api/whatsapp/instances/:id/templates/:tid    # delete (Meta + local)
POST   /api/whatsapp/instances/:id/templates/:tid/submit  # DRAFT → enviar pra aprovação
```

**Aliases de retrocompatibilidade** (mantidos por 1 release, depois removidos):
- `GET /api/whatsapp/instance/status` → redireciona pra `GET /instances/<id default>`
- `POST /api/whatsapp/instance/connect` → `POST /instances/<id default>/connect`

### 4.7 RBAC

Todas as rotas exigem `role='admin'` (middleware `requireAdmin` existente). Operadores veem read-only.

### 4.8 Validações

- `is_default = true` em no máximo uma row (unique index parcial).
- Excluir instância com conversations vinculadas: HTTP 409 sugerindo arquivar.
- Phone Number ID Meta único entre instâncias Meta (sem duplicata acidental).
- `provider_config` validado por zod schema por provider antes de salvar.

---

## 5. Webhook Meta (recebimento e validação)

### 5.1 Rotas

```ts
// server/routes/whatsappWebhook.ts
router.get('/meta/:instanceId', metaWebhookVerify);
router.post('/meta/:instanceId', metaWebhookHandler);
```

### 5.2 Middleware de raw body

Só pra essa rota — precisamos do raw body pra calcular HMAC:
```ts
app.use('/api/whatsapp/webhook/meta', express.json({
  verify: (req, _res, buf) => { (req as any).rawBody = buf; }
}));
```

### 5.3 GET handler (verificação Meta)

```ts
async function metaWebhookVerify(req, res) {
  const { instanceId } = req.params;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const instance = await loadInstance(instanceId);
  if (!instance || instance.provider !== 'meta_cloud') return res.sendStatus(404);
  const cfg = decryptProviderConfig('meta_cloud', instance.providerConfig);

  if (mode === 'subscribe' && token === cfg.webhookVerifyToken) {
    // Marca webhookSubscribed=true no provider_config
    await markWebhookSubscribed(instanceId);
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}
```

### 5.4 POST handler (mensagens + status)

```ts
async function metaWebhookHandler(req, res) {
  const { instanceId } = req.params;
  const instance = await loadInstance(instanceId);
  if (!instance || instance.provider !== 'meta_cloud') return res.sendStatus(404);

  // Valida HMAC
  const sig = req.headers['x-hub-signature-256'] as string | undefined;
  const cfg = decryptProviderConfig('meta_cloud', instance.providerConfig);
  const expected = 'sha256=' + crypto
    .createHmac('sha256', cfg.appSecret)
    .update((req as any).rawBody)
    .digest('hex');
  if (!sig || !timingSafeEqualHex(sig, expected)) {
    return res.sendStatus(401);
  }

  // Ack imediato — Meta tem timeout curto e não retenta se demorar
  res.sendStatus(200);

  // Processa async
  processMetaWebhook(instanceId, req.body).catch((err) =>
    logger.error('[meta-webhook] processing failed', { instanceId, err })
  );
}
```

### 5.5 Normalização do payload

`processMetaWebhook` extrai cada item de `entry[].changes[]`:

- `field === 'messages'` →
  - Para cada `value.messages[]`, mapeia tipo (text/image/video/audio/document → kind correspondente; button/interactive → kind=text com label do botão; demais → ignora com warning) e baixa mídia via `GET /{media_id}` quando aplicável.
  - Chama `ingestInboundMessage({ instanceId, leadPhone, kind, text, mediaUrl, providerMsgId, sentAt, rawPayload, provider: 'meta_cloud' })`.

- `field === 'message_template_status_update'` → atualiza `whatsapp_hsm_templates.status` da row com `meta_template_id` correspondente, salva `rejection_reason` se houver.

- `field === 'messages'` com `value.statuses[]` (delivery/read receipts) → **v1 ignora** (escopo); v2 atualiza `messages.status`.

### 5.6 Pipeline comum `ingestInboundMessage`

Extraído do `whatsappWebhookService.ts` atual e generalizado. Recebe payload normalizado, faz:
1. Upsert lead por telefone (cria com `flow_stage='incomplete'` se novo).
2. Upsert conversation por `(instance_id, lead_phone)`.
3. Insert message com `provider` setado.
4. Atualiza `last_message_at`, `last_inbound_at` da conversation.
5. Dispara IA de qualificação se habilitada (`org_settings.ai_enabled`).
6. Dispara triggers de pipeline (auto-resposta, etc.).

Esse pipeline é **idêntico** pros dois providers — o handler de cada provider só normaliza pro shape esperado.

---

## 6. Editor de templates HSM (Meta Cloud)

### 6.1 Página `/settings/whatsapp/templates`

Dropdown no topo seleciona qual instância Meta (só essas aparecem). Lista templates da instância com:
- Nome, linguagem, categoria
- Status badge (DRAFT cinza, PENDING amarelo, APPROVED verde, REJECTED vermelho com motivo no hover)
- Última sincronização (`last_synced_at`)
- Ações: Editar (só DRAFT), Duplicar, Excluir

Botão `[+ Novo template]` abre wizard.

### 6.2 Wizard de criação

Campos:
- **Nome** (snake_case, validação inline contra `/^[a-z0-9_]+$/`)
- **Idioma** (dropdown pt_BR, en_US, es_LA, etc.)
- **Categoria** (MARKETING / UTILITY / AUTHENTICATION)
- **Header** (opcional): Nenhum | Texto | Imagem | Vídeo | Documento
- **Body** (obrigatório, max 1024 chars): textarea com detecção automática de `{{N}}` e captura de exemplos
- **Footer** (opcional, max 60 chars)
- **Buttons** (opcional, até 3): Quick Reply / URL / Phone

**Preview ao vivo** renderiza o template no formato visual WhatsApp.

Ações:
- `[Salvar rascunho]` → POST com `status='DRAFT'`, sem chamar Meta.
- `[Enviar pra aprovação]` → POST + chama `POST /{waba_id}/message_templates`, salva `meta_template_id` e `status='PENDING'`.

### 6.3 Payload Meta

```json
{
  "name": "boas_vindas_pos_troca",
  "language": "pt_BR",
  "category": "MARKETING",
  "components": [
    {"type": "HEADER", "format": "TEXT", "text": "Olá {{1}}"},
    {"type": "BODY", "text": "Sua troca de óleo na {{2}} foi um sucesso...",
     "example": {"body_text": [["João", "Lubritec"]]}},
    {"type": "FOOTER", "text": "Lubritec - 30 anos cuidando do seu motor"},
    {"type": "BUTTONS", "buttons": [
      {"type": "QUICK_REPLY", "text": "Quero o desconto"},
      {"type": "URL", "text": "Saiba mais", "url": "https://lubritec.com.br/promo"}
    ]}
  ]
}
```

### 6.4 Sincronização de status

**Push (preferencial):** webhook `message_template_status_update` da Meta atualiza row local automaticamente.

**Pull (fallback):** botão "Sincronizar templates" chama `GET /{waba_id}/message_templates?fields=...&limit=200` e faz upsert. Útil pra recuperar templates criados direto na Meta UI ou se webhook falhou.

### 6.5 Edição/exclusão

- **DRAFT:** edição livre, sem chamada à Meta.
- **PENDING / APPROVED:** edição **bloqueada** pela Meta. UI mostra "Duplicar e editar" como alternativa.
- **REJECTED:** UI mostra `rejection_reason` e oferece "Editar e reenviar" — que internamente cria um novo template com sufixo `_v2`.
- **Excluir:** chama `DELETE /{waba_id}/message_templates?name=...` e remove row local.

---

## 7. Envio de mensagens via Meta (`metaCloud/client.ts`)

### 7.1 Texto livre (só janela 24h)

```
POST https://graph.facebook.com/v20.0/{phone_number_id}/messages
Authorization: Bearer {accessToken}

{
  "messaging_product": "whatsapp",
  "to": "5511999999999",
  "type": "text",
  "text": {"body": "..."}
}
```

### 7.2 Mídia

```json
{
  "messaging_product": "whatsapp",
  "to": "5511999999999",
  "type": "image",
  "image": {"link": "https://...", "caption": "..."}
}
```

Tipos suportados: `image`, `video`, `audio`, `document`.

### 7.3 Template HSM

```json
{
  "messaging_product": "whatsapp",
  "to": "5511999999999",
  "type": "template",
  "template": {
    "name": "boas_vindas_pos_troca",
    "language": {"code": "pt_BR"},
    "components": [
      {"type": "body", "parameters": [
        {"type": "text", "text": "João"},
        {"type": "text", "text": "Lubritec"}
      ]}
    ]
  }
}
```

### 7.4 Tratamento de erros

- HTTP 200 → extrai `messages[0].id` (formato `wamid.xxx`) e retorna como `providerMsgId`.
- HTTP 401 → credencial inválida; marca instance como `error`, notifica admin.
- HTTP 470 ou erro code 131047 → **fora da janela 24h** tentando texto livre; throw `OutOfSessionWindowError`.
- HTTP 429 → rate limit; aplica backoff exponencial (reusa `lib/retry.ts`).
- HTTP 5xx → retry 3x com backoff.

### 7.5 Detecção da janela 24h

Composer e campaign worker olham `conversations.last_inbound_at`:
```ts
const inWindow = lastInboundAt && (Date.now() - lastInboundAt.getTime() < 24 * 3600 * 1000);
```

Se `instance.provider === 'meta_cloud' && !inWindow`, **texto livre bloqueado** — UI exige seleção de template HSM.

---

## 8. Mudanças no Inbox

### 8.1 Listagem de conversas

`conversations` agora vem com `instance_id`. Adicionar filtro/coluna mostrando o nome da linha (`display_name`) e badge do provider. UI:
- Sidebar lateral com filtro "Linha: [Todas ▼]" (default todas).
- Cada row na lista mostra mini-badge da linha pra contexto rápido.

### 8.2 Composer

Ao abrir uma conversation, composer resolve o provider via `resolveProvider(conversation.instance_id)`:

- **UazAPI:** comportamento atual. Texto livre + mídia + templates (free-form) disponíveis sempre.
- **Meta Cloud dentro da janela 24h:** texto livre + mídia + templates HSM (`APPROVED`) disponíveis.
- **Meta Cloud fora da janela:** textarea desabilitada com tooltip "Janela de 24h expirada — use um template aprovado". Só botão "Selecionar template HSM" disponível, que abre seletor com inputs pras variáveis e renderização ao vivo.

Botão de envio chama `provider.sendText` / `sendMedia` / `sendTemplate` conforme o caso. Resultado vai pro `messages` table com `provider` setado.

### 8.3 Histórico

Cada balão de mensagem mostra mini-ícone do provider (discreto, no canto) pra rastreabilidade quando houve troca de linha. Mensagens antigas (pré-migration) ficam todas marcadas `provider='uazapi'` (default da migration).

---

## 9. Mudanças em Campanhas

### 9.1 Wizard de criação

Novo Step 0 (logo após nome/descrição): **escolher linha de envio**.

Dropdown lista todas as instâncias não-arquivadas com indicador de provider e status. Selecionar uma instância filtra:
- Se UazAPI → próximo step é o editor de texto livre + seletor de `message_templates` (free-form, comportamento atual).
- Se Meta Cloud → próximo step é o seletor de templates HSM (`status='APPROVED'`) com mapeamento de variáveis.

### 9.2 Mapeamento de variáveis HSM

Para cada `{{N}}` detectado no template selecionado, UI mostra uma linha:

```
{{1}}: ( ) Valor fixo: [______]
       (•) Campo do lead: [Nome ▼]
```

Campos do lead disponíveis: `name`, `cnpj`, `phone`, `notes`, e qualquer custom field futuro.

Salvo em `campaigns.hsm_variables`.

### 9.3 Campaign worker

Ao processar cada destinatário:
1. Resolve provider via `resolveProvider(campaign.instance_id)`.
2. Se Meta + campaign tem `hsm_template_id`:
   - Resolve cada variável usando `hsm_variables` (static ou lookup no lead).
   - Chama `provider.sendTemplate({ to, templateName, language, variables: [...] })`.
3. Se UazAPI + campaign tem `template_id` (free-form):
   - Substitui placeholders no texto e chama `provider.sendText({ to, text })` (comportamento atual).
4. Salva resultado em `campaign_recipients.status` (sent/failed/...) + `provider_msg_id`.

### 9.4 Validação de pré-envio

Antes de "Disparar campanha":
- Se Meta: verificar que template ainda está `APPROVED` (sync rápido) e que todos os `hsm_variables` estão mapeados.
- Verificar que a instância está `connected`.
- Se alguma falha: bloqueia disparo com mensagem específica.

---

## 10. Plano de migração e rollout

### 10.1 Ordem das mudanças (cada item = 1 PR)

1. **PR 1 — Crypto helper + env var.** Adiciona `lib/crypto.ts` e `WHATSAPP_CREDENTIALS_KEY`. Sem mudança de comportamento.

2. **PR 2 — Migration 012.** Schema multi-provider. Inclui script TypeScript pra criptografar o instance_token UazAPI existente antes do DROP COLUMN. Roda em staging primeiro com snapshot do DB de produção.

3. **PR 3 — `WhatsAppProvider` interface + refactor UazAPI.** Move `uazapiClient.ts` e `uazapiInstanceClient.ts` pra `services/whatsapp/uazapi/` e implementa `UazapiProvider`. Cria `providerRegistry`. **Sem mudança de comportamento externo** — tudo segue funcionando via `resolveDefaultProvider()`. Os tests existentes (`whatsapp-instance-*.test.ts`) viram smoke tests dessa camada.

4. **PR 4 — Endpoints multi-instance + UI Settings.** Novas rotas `/api/whatsapp/instances`. Frontend reformula `/settings/whatsapp`. Aliases backward-compatible nas rotas antigas. Conexão UazAPI multi-linha já funciona aqui.

5. **PR 5 — `MetaCloudProvider` (sem templates).** Implementa connect, validação de creds, envio de texto/mídia, webhook GET+POST com HMAC, normalização de payload, `ingestInboundMessage` generalizado. Permite conectar uma linha Meta e usar inbox normalmente (texto livre dentro janela 24h).

6. **PR 6 — Templates HSM.** Tabela `whatsapp_hsm_templates`, editor wizard, sync via API + webhook `message_template_status_update`. Permite enviar templates pela Meta no inbox (composer adaptado).

7. **PR 7 — Campanhas multi-instance + HSM.** Wizard atualizado com escolha de linha, mapeamento de variáveis, worker adaptado.

8. **PR 8 — Cleanup.** Remove aliases de rotas antigas. Remove código morto. Atualiza documentação.

### 10.2 Testes

Cada PR vem com testes correspondentes:
- **PR 2:** test idempotência da migration; verifica que a row existente continua válida.
- **PR 3:** test do `UazapiProvider` (refactor preserva comportamento); test do `providerRegistry` (cache, invalidação).
- **PR 5:** test do `MetaCloudProvider` com fixtures de payload Meta (criar em `tests/fixtures/meta-*.json`); test do HMAC; test do GET verify; test de `OutOfSessionWindowError`.
- **PR 6:** test do editor (parsing de `{{N}}`, validação de exemplos); test de sync de status via webhook.
- **PR 7:** test do worker com instância Meta (substituição de variáveis); test do bloqueio quando template não está APPROVED.

Todos os testes existentes precisam continuar passando em cada PR.

### 10.3 Riscos e mitigações

| Risco | Mitigação |
|------|-----------|
| Migration corrompe creds UazAPI existentes | Backup do DB antes; script de criptografia roda em transação; staging primeiro |
| Webhook Meta cai e perde mensagens | Meta retenta por 7 dias com backoff; se cair, sync via `GET /messages` na próxima reconexão (futuro) |
| Token Meta expira | Permanent Access Token (System User) não expira; revogação manual marca instance como `error` |
| Templates rejeitados sem motivo claro | Mostrar `rejection_reason` da Meta; link pra docs de policy |
| Confusão admin entre linhas | Nome de exibição obrigatório, badges visuais em todos os lugares, `is_default` marca a "principal" |

### 10.4 Variáveis de ambiente novas

```
# Required
WHATSAPP_CREDENTIALS_KEY=<openssl rand -hex 32>

# Opcional (default usado se Meta instance for criada sem)
META_GRAPH_API_VERSION=v20.0
```

### 10.5 Documentação para o admin (Lubritec)

Criar `docs/whatsapp-cloud-api-setup.md` com:
- Passo a passo no Meta Business Manager (criar WABA, adicionar número, criar App, gerar System User Token, capturar IDs).
- Como configurar webhook na Meta App.
- Diferenças operacionais entre UazAPI e Cloud (janela 24h, templates, custos).
- Troubleshooting comum.

---

## 11. Out of scope (v1)

Itens conscientemente não incluídos nesta entrega — virarão specs próprios depois:

- **Embedded Signup da Meta** (fluxo "Login with Facebook" pra conectar WABA sem credenciais manuais). Exige cadastro como Tech Provider + Meta App em review. Manual basta pra Lubritec.
- **Delivery/read receipts** (`statuses` no webhook Meta). Não bloqueia operação inicial.
- **Multi-WABA por instância Meta** (uma instância = um phone_number_id; suficiente).
- **Migração de números UazAPI → Meta** com preservação de histórico. Hoje é manualmente: criar nova linha Meta, arquivar a UazAPI, comunicar clientes.
- **Cost tracking** (custo por conversa Meta no dashboard). Pode ser adicionado lendo `conversations.origin` + flag de janela.
- **Custom audiences / segmentation** avançada nas campanhas. Comportamento atual de "lista de destinatários" continua.

---

## 12. Aceite

Implementação considera-se concluída quando:

- [ ] Migration 012 roda com sucesso em staging e produção sem perda de dados.
- [ ] Linha UazAPI existente (Lubritec) continua funcionando sem qualquer intervenção do usuário final.
- [ ] Admin consegue adicionar uma segunda linha UazAPI e ela aparece no inbox.
- [ ] Admin consegue adicionar uma linha Meta Cloud, validar credenciais, configurar webhook e enviar/receber mensagens.
- [ ] Admin consegue criar um template HSM no editor, enviar pra aprovação, e ver o status atualizar via webhook.
- [ ] Campanha por instância Meta com template HSM dispara corretamente, com variáveis substituídas.
- [ ] Campanha por instância UazAPI (free-form) continua funcionando como antes.
- [ ] Composer no inbox bloqueia texto livre em conversation Meta fora da janela 24h e exige template.
- [ ] Webhook Meta valida HMAC corretamente; payloads sem assinatura ou com assinatura inválida retornam 401.
- [ ] Todos os testes existentes continuam passando + novos testes específicos cobertos.
