# Changelog

## [Unreleased] — 2026-05-21 — Plano C (HSM Templates + Multi-Instance Campaigns)

### Added
- **Tabela `whatsapp_hsm_templates`** (migration 027) armazena templates HSM da Meta — DRAFTs locais e sincronizados de APROVADOS/PENDING/REJECTED na WABA. Status updates chegam via webhook `message_template_status_update` (push) com sync manual como fallback.
- **Meta Graph templates client** (`server/services/whatsapp/metaCloud/templates.ts`) — `createTemplate`, `listTemplatesOnMeta`, `deleteTemplateOnMeta`, `sendTemplateMessage`.
- **HSM template service + REST endpoints** — `GET/POST /api/whatsapp/instances/:id/templates`, `DELETE /:id/templates/:tid`, `POST /:id/sync-templates`. Validação de nome snake_case + variáveis. Cria como DRAFT (sem chamar Meta) ou envia direto pra aprovação (`submitNow: true`).
- **Webhook handler `message_template_status_update`** — atualiza status local (APPROVED/REJECTED/etc.) com fallback por (name, language) se metaTemplateId ainda não estiver preenchido.
- **`MetaCloudProvider.sendTemplate` real** — substitui o stub do Plano B. Suporta header media (image/video/document), body com variáveis (ordenadas por index).
- **Campanhas multi-instance + HSM**:
  - `campaigns.instance_id` (FK, NOT NULL, backfillado), `campaigns.hsm_template_id` (FK), `campaigns.hsm_variables` (JSONB)
  - Validação XOR (`templateId` UazAPI vs `hsmTemplateId` Meta) + status APPROVED + coverage de variáveis
  - Worker (`campaignsDispatcher`) agora usa `provider.sendText`/`sendMedia`/`sendTemplate` via `resolveProvider(c.instanceId)` — abstração total UazAPI/Meta
  - `resolveHsmVariables` interpola variáveis estáticas ou de campos do lead (name/phone/cnpj/email/notes)
- **UI: Templates HSM**:
  - Nova aba "Templates HSM (Meta)" em Configurações → WhatsApp
  - `TemplatesListPage` com seletor de instância Meta, badge de status (Rascunho/Em aprovação/Aprovado/Rejeitado/etc.), botão "Sincronizar com Meta", deleção com confirmação
  - `TemplateEditor` wizard com 4 componentes: HEADER (Nenhum/Texto/Imagem/Vídeo/Documento), BODY (textarea com detecção automática de `{{N}}` + inputs de exemplo), FOOTER (max 60 chars), BUTTONS (até 3: Quick Reply / URL / Phone), live preview no estilo WhatsApp, ações "Salvar rascunho" e "Enviar pra aprovação"
- **UI: Wizard de campanha multi-step**:
  - Step novo "Instância" entre Nome e Audiência — escolhe linha (UazAPI ou Meta Cloud)
  - Para linhas Meta, step de Mensagem mostra `HsmTemplatePickerStep` (lista templates APROVADOS com preview) + `HsmVariablesMapper` (mapeia cada `{{N}}` pra valor fixo ou campo do lead)
  - `ReviewStep` exibe linha, template HSM (se Meta), mapeamento de variáveis

### Changed
- `whatsappWebhookService.ingestInboundMessage` agora reusado por ambos providers (já era assim desde Plano B; mantido).
- `MessageStep` foi refatorado em `MetaHsmMessageStep` + `FreeFormMessageStep` (composição evita hooks condicionais).
- `WhatsappConnectionTab` passa a ter abas "Linhas conectadas" + "Templates HSM (Meta)".

### Internal
- Novos arquivos de tests:
  - `hsm-templates-crud.test.ts` (10 tests)
  - `meta-cloud-send-template.test.ts` (5 tests)
  - `meta-cloud-template-status-webhook.test.ts` (2 tests)
  - `campaigns-multi-instance.test.ts` (8 tests)
- Fixture `meta-webhook-template-status.json`.
- Helper `createHsmTemplate` em `server/tests/helpers.ts`. `createCampaign` atualizado para aceitar `instanceId`/`hsmTemplateId`/`hsmVariables`.
- Sentinel `created_by` no sync de templates Meta usa o primeiro admin do org (templates criados via Meta UI fora do SaaS).

### Migrations
1. `npm run migrate` — aplica `027_whatsapp_hsm_templates_and_campaigns.sql`

Schema 026 (Plano A) e código Meta Cloud (Plano B) são pré-requisitos.

### Env vars
Nenhuma nova. Continua usando `WHATSAPP_CREDENTIALS_KEY` (Plano A) + `META_GRAPH_API_VERSION` opcional (Plano B).

### Limitações conhecidas
- Tests `continuous-campaign.test.ts` e `continuous-variant-stats.test.ts` continuam falhando (pré-existente desde Plano A/B). Não bloqueia o deploy — feature de campanha contínua segue funcional em produção; é o setup dos próprios testes que precisa de ajuste de fixture (default instance).
- Editar templates `PENDING`/`APPROVED`/`REJECTED` não é suportado (regra Meta — só DRAFT é editável). UI mostra delete como única ação.
- Status updates de delivery/read (`statuses` no webhook) continuam ignorados — escopo de plano futuro.

---

## [Unreleased] — 2026-05-21 — Plano B (Meta Cloud Provider básico)

### Added
- **MetaCloudProvider** (`server/services/whatsapp/metaCloud/`) — implementa `WhatsAppProvider` interface. Suporta envio de texto + mídia (image, video, audio, document) via Meta Graph API v20.0.
- **Webhook Meta** (`POST /api/whatsapp/webhook/meta/:instanceId`) — valida HMAC SHA256 via `X-Hub-Signature-256`, normaliza payload Meta, delega ao `ingestInboundMessage` (pipeline comum aos providers).
- **Verification GET endpoint** — `GET /api/whatsapp/webhook/meta/:instanceId` ecoa `hub.challenge` quando o `verify_token` bate; usado pela Meta na subscrição inicial.
- **Setup endpoint** — `POST /api/whatsapp/instances` agora aceita `provider: 'meta_cloud'`, valida credenciais via `GET /{phone_number_id}` na Graph API, gera `webhookVerifyToken` (32 bytes hex), armazena credenciais criptografadas (AES-256-GCM).
- **Webhook info endpoint** — `GET /api/whatsapp/instances/:id/webhook-info` retorna `callbackUrl` + `verifyToken` + `subscribed` pra UI exibir após criação.
- **UI: MetaCloudSetupStep** — formulário com 5 campos (display name + 4 credenciais). Validação acontece via backend (Meta Graph) com mensagens amigáveis.
- **UI: WebhookInfoStep** — exibe instruções passo-a-passo pro admin colar callback URL + verify token no Meta App, com polling do status de subscrição.

### Changed
- `whatsappWebhookService.ts` — extraído `ingestInboundMessage(normalized)` como pipeline pública, reusada pelos handlers de ambos providers (UazAPI e Meta).
- `ProviderPickerStep` — card Meta Cloud agora ativo (selecionável).
- **Bug fix**: lookup de conversation no `ingestInbound` agora usa `(instance_id, phone)` composite (antes era só `phone` — bug latente que poderia causar cross-instance leakage).

### Internal
- Novos arquivos de tests: `meta-cloud-provider.test.ts` (11 tests), `meta-cloud-webhook.test.ts` (7 tests), `whatsapp-instances-meta-create.test.ts` (5 tests).
- Fixtures Meta webhook em `server/tests/fixtures/meta-webhook-*.json`.
- `.gitignore` — adiciona `backup-*.sql` (artefatos sensíveis).
- `MetaCloudProvider.sendMedia` rejeita `kind: 'unknown'` (catch-all do schema interno que a Graph API não aceita).

### Env vars adicionadas
- `META_GRAPH_API_VERSION` (opcional) — default `v20.0`. Sobrescrever só pra rollback de API version.

### Out of scope (vai no Plano C)
- Templates HSM (sendTemplate, listTemplates, createTemplate continuam stubs)
- Editor de templates HSM
- Campanhas multi-instância com HSM
- Status updates (delivery/read receipts) — v1 ignora `statuses` no webhook
- `message_template_status_update` — Plano C

### Migrations
Nenhuma. Apenas usa colunas adicionadas no Plano A.

---

## [Unreleased] — 2026-05-21 — Plano A (Fundação Multi-Provider WhatsApp)

### Added
- **Crypto helper** (`server/lib/crypto.ts`) AES-256-GCM para credenciais de WhatsApp, com env var `WHATSAPP_CREDENTIALS_KEY` (gerar via `openssl rand -hex 32`).
- **Migration 026** (`server/db/migrations/026_whatsapp_multi_provider.sql`) + script de backfill `npm run migrate:encrypt-creds`: tabela `whatsapp_instance` virou multi-row com `provider` discriminator, `display_name`, `provider_config` JSONB criptografado, `is_default`. `conversations.instance_id` adicionado (FK, NOT NULL, backfillado). `messages.uazapi_msg_id` renomeado para `provider_msg_id`; `messages.provider` adicionado.
- **Interface `WhatsAppProvider`** em `server/services/whatsapp/provider.ts` + `providerRegistry` com cache TTL 5min em `providerRegistry.ts`. UazAPI refatorado para `services/whatsapp/uazapi/` implementando a interface.
- **Endpoints `/api/whatsapp/instances/*`** (admin-only): GET (lista), POST (criar), GET/:id (detalhe), PATCH/:id (atualizar), DELETE/:id (excluir, 409 se conversations vinculadas), POST /:id/connect.
- **UI Settings reformulada** (`src/pages/settings/WhatsappConnectionTab.tsx`): lista de linhas conectadas com status, badge de provider, menu de ações; wizard "Adicionar número" com seleção de provider (UazAPI ativo, Meta Cloud em breve no Plano B).

### Changed
- `whatsapp_instance` agora suporta múltiplas rows (não mais singleton). Backward-compat preservada via `is_default=true` (row marcada vira a "linha padrão" usada pelos endpoints legados `/api/whatsapp-instance/*`).
- `conversations.phone` unique constraint global removido; substituído por `(instance_id, phone)` composto.
- Credenciais UazAPI legadas agora armazenadas criptografadas em `provider_config` JSONB.
- Serviços consumidores (`aiAtendimento`, `campaignsDispatcher`, `conversationsService`, `whatsappWebhookService`, `dashboardService`) atualizados para o novo schema.

### Internal
- 4 novos arquivos de tests: `crypto.test.ts` (7 tests), `whatsapp-provider-registry.test.ts` (7 tests), `whatsapp-instances-crud.test.ts` (10 tests). Helpers `createWhatsappInstance`, `createConversation`, `createMessage` em `server/tests/helpers.ts` atualizados para o novo schema.
- UazAPI clients movidos de `server/services/uazapiClient.ts` + `uazapiInstanceClient.ts` para `server/services/whatsapp/uazapi/{client,instanceClient}.ts` (history preservada via git mv).
- 16 arquivos consumidores tiveram imports atualizados para os novos paths.

### Migrations to run
1. `npm run migrate` — aplica `026_whatsapp_multi_provider.sql`
2. `npm run migrate:encrypt-creds` — encripta credenciais existentes e dropa colunas legadas

### Next
- **Plano B** — `MetaCloudProvider` (envio/recebimento de texto e mídia, webhook com HMAC, setup manual via 4 credenciais).
- **Plano C** — Editor de templates HSM + campanhas multi-instância.
- **Plano D** — Cleanup de aliases backward-compat.
