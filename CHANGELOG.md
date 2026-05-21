# Changelog

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
