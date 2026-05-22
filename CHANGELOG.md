# Changelog

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
