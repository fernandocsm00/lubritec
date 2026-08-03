# UazAPI Multi-Linha — Recebimento por Instância (Etapa 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer mensagens recebidas de uma segunda linha UazAPI (ex.: "Lubritec Fixo") caírem na conversa da instância certa, coexistindo com a linha Meta Cloud padrão — sem quebrar o inbound atual.

**Architecture:** Hoje o inbound UazAPI é amarrado à linha padrão em dois pontos: (1) a autenticação do webhook (`loadValidWebhookTokens`) só conhece o token da linha padrão, e (2) `ingestInbound` força `getDefaultInstanceId()`. Vamos tornar ambos multi-instância: a validação passa a aceitar os tokens de **todas** as linhas UazAPI ativas, e o controller resolve **token → instanceId** e repassa pro `ingestInbound`, que tagueia a conversa na instância correta. O envio já é por-instância (`resolveProvider(conv.instanceId)`), então nada muda lá. Por fim, um script operacional re-criptografa o token da linha Fixo (hoje em texto puro) e registra o webhook dela na UazAPI.

**Tech Stack:** Express + Drizzle ORM + Postgres (Supabase, schema `lubritec`), Vitest + supertest, AES-256-GCM (`server/lib/crypto.ts`), UazAPI (uazapiGO em `oriondigital.uazapi.com`).

**Comandos:** testes `npm test` · typecheck `npm run lint` · migração N/A (sem mudança de schema).

**Contexto de estado (2026-08-03):** a linha "Lubritec Fixo" (row `be7c6133-1ff4-413a-a7cd-bd17e777e81b`) já foi adotada na Etapa 1 apontando pra instância `r842bde0e9e6b91` (`baseUrl=https://oriondigital.uazapi.com`, número `555421084500`), com **token em texto puro** e `webhookSynced=false`. Ver `memory/project_uazapi_multi_instance.md`.

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `server/services/whatsappInstanceService.ts` | `loadValidWebhookTokens` (multi-instância + provider-safe) + nova `resolveInstanceIdByWebhookToken` | Modificar |
| `server/services/whatsappWebhookService.ts` | `ingestInbound` aceita `instanceId` opcional | Modificar |
| `server/controllers/whatsappWebhookController.ts` | Resolve token→instância e repassa pro `ingestInbound` | Modificar |
| `server/tests/whatsapp-webhook-multi-instance.test.ts` | Testes unit + integração do roteamento multi-linha | Criar |
| `server/scripts/adoptUazapiInstance.ts` | One-off: re-criptografa token + registra webhook da linha adotada | Criar |

**Blast radius:** as mudanças só afetam o endpoint UazAPI (`POST /api/whatsapp/webhook`). O inbound Meta Cloud usa outro endpoint (`/api/whatsapp/webhook/meta/:id`) com validação própria — intocado.

---

### Task 0: Branch

- [ ] **Step 1: Criar branch a partir do estado atual**

Run:
```bash
cd /c/Saas_lubritec/lubritec-main
git checkout -b feat/uazapi-multi-instance-inbound
```
Expected: "Switched to a new branch 'feat/uazapi-multi-instance-inbound'"

---

### Task 1: `loadValidWebhookTokens` aceita todas as linhas UazAPI ativas (Gap B)

Hoje a função lê só a linha padrão via `loadDefaultRow()` e chama `uazCfg(row)`, que faz `uazapiConfigSchema.parse` — se a padrão for `meta_cloud` (caso atual), **lança exceção** e derruba o endpoint. Novo comportamento: varre todas as linhas `provider='uazapi'` não-arquivadas, parseia com `safeParse` (ignora as que não casam), e coleta `instanceToken` + `webhookSecret` decriptados, mais o env `UAZAPI_WEBHOOK_SECRET`.

**Files:**
- Modify: `server/services/whatsappInstanceService.ts` (import `and`; corpo de `loadValidWebhookTokens`, ~linhas 344-354)
- Test: `server/tests/whatsapp-webhook-multi-instance.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `server/tests/whatsapp-webhook-multi-instance.test.ts` com:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createWhatsappInstance } from './helpers';
import {
  loadValidWebhookTokens,
  resolveInstanceIdByWebhookToken,
} from '../services/whatsappInstanceService';

// Tokens em texto puro de propósito: decryptSecret faz passthrough de valores
// sem prefixo "enc:", então os testes não precisam da WHATSAPP_CREDENTIALS_KEY.
function uazCfg(instanceId: string, token: string, baseUrl = 'https://oriondigital.uazapi.com') {
  return {
    baseUrl,
    instanceId,
    instanceToken: token,
    webhookSecret: null,
    webhookUrl: null,
    webhookSynced: false,
  };
}

beforeEach(() => {
  delete process.env.UAZAPI_WEBHOOK_SECRET;
});

describe('loadValidWebhookTokens (multi-instância)', () => {
  it('inclui tokens de TODAS as linhas UazAPI ativas, não só a padrão', async () => {
    await createWhatsappInstance({
      provider: 'uazapi', isDefault: true, displayName: 'A',
      providerConfig: uazCfg('inst-A', 'token-A'),
    });
    await createWhatsappInstance({
      provider: 'uazapi', isDefault: false, displayName: 'B',
      providerConfig: uazCfg('inst-B', 'token-B'),
    });

    const tokens = await loadValidWebhookTokens();
    expect(tokens).toContain('token-A');
    expect(tokens).toContain('token-B');
  });

  it('NÃO lança quando a linha padrão é meta_cloud (parse UazAPI falharia)', async () => {
    await createWhatsappInstance({
      provider: 'meta_cloud', isDefault: true, displayName: 'Meta',
      providerConfig: { wabaId: 'w', phoneNumberId: 'p', accessToken: 'enc:x', appSecret: 'enc:y', webhookVerifyToken: 'v', webhookSubscribed: true },
    });
    const uaz = await createWhatsappInstance({
      provider: 'uazapi', isDefault: false, displayName: 'Fixo',
      providerConfig: uazCfg('inst-fixo', 'token-fixo'),
    });

    const tokens = await loadValidWebhookTokens();
    expect(tokens).toContain('token-fixo');
    expect(uaz.id).toBeDefined();
  });

  it('ignora linhas UazAPI arquivadas', async () => {
    await createWhatsappInstance({
      provider: 'uazapi', isDefault: true, displayName: 'Ativa',
      providerConfig: uazCfg('inst-ativa', 'token-ativa'),
    });
    await createWhatsappInstance({
      provider: 'uazapi', isArchived: true, displayName: 'Velha',
      providerConfig: uazCfg('inst-velha', 'token-velha'),
    });

    const tokens = await loadValidWebhookTokens();
    expect(tokens).toContain('token-ativa');
    expect(tokens).not.toContain('token-velha');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- whatsapp-webhook-multi-instance`
Expected: FAIL — `resolveInstanceIdByWebhookToken` não existe (erro de import) e/ou o teste meta_cloud lança no `uazCfg(row)` atual.

- [ ] **Step 3: Implementar (Gap B)**

Em `server/services/whatsappInstanceService.ts`, trocar o import do drizzle (linha 4):

```ts
import { eq, and } from 'drizzle-orm';
```

Substituir o corpo de `loadValidWebhookTokens` (atual ~linhas 344-354) por:

```ts
export async function loadValidWebhookTokens(): Promise<string[]> {
  // Multi-instância: aceita o token de QUALQUER linha UazAPI ativa (não só a
  // padrão). safeParse ignora linhas cujo providerConfig não é UazAPI (ex.:
  // meta_cloud) sem lançar.
  const rows = await db.select().from(whatsappInstance)
    .where(and(
      eq(whatsappInstance.provider, 'uazapi'),
      eq(whatsappInstance.isArchived, false),
    ));
  const tokens: string[] = [];
  for (const row of rows) {
    const parsed = uazapiConfigSchema.safeParse(row.providerConfig);
    if (!parsed.success) continue;
    if (parsed.data.webhookSecret) tokens.push(decryptSecret(parsed.data.webhookSecret));
    if (parsed.data.instanceToken) tokens.push(decryptSecret(parsed.data.instanceToken));
  }
  if (process.env.UAZAPI_WEBHOOK_SECRET) tokens.push(process.env.UAZAPI_WEBHOOK_SECRET);
  return tokens;
}
```

- [ ] **Step 4: Rodar (ainda falha só o resolve, mas os 3 de loadValidWebhookTokens passam se resolve existir)**

Nota: os testes deste arquivo importam `resolveInstanceIdByWebhookToken` (criada na Task 2). Enquanto ela não existir, o arquivo inteiro falha no import. Prossiga pra Task 2 e rode tudo junto no final da Task 2.

- [ ] **Step 5: Commit**

```bash
git add server/services/whatsappInstanceService.ts server/tests/whatsapp-webhook-multi-instance.test.ts
git commit -m "feat(whatsapp): loadValidWebhookTokens aceita todas as linhas UazAPI ativas"
```

---

### Task 2: `resolveInstanceIdByWebhookToken` (Gap C — parte 1)

Mapeia o token que chegou no webhook (instanceToken OU webhookSecret) pra qual linha UazAPI ele pertence. Retorna `null` se nenhum casar (ex.: token do env `UAZAPI_WEBHOOK_SECRET`, que não pertence a uma linha específica → cai no fallback default no controller).

**Files:**
- Modify: `server/services/whatsappInstanceService.ts` (nova função exportada, após `loadValidWebhookTokens`)
- Test: `server/tests/whatsapp-webhook-multi-instance.test.ts` (adicionar bloco)

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao mesmo arquivo de teste:

```ts
describe('resolveInstanceIdByWebhookToken', () => {
  it('mapeia o token pra instância dona', async () => {
    const a = await createWhatsappInstance({
      provider: 'uazapi', isDefault: true, displayName: 'A',
      providerConfig: uazCfg('inst-A', 'token-A'),
    });
    const b = await createWhatsappInstance({
      provider: 'uazapi', isDefault: false, displayName: 'B',
      providerConfig: uazCfg('inst-B', 'token-B'),
    });

    expect(await resolveInstanceIdByWebhookToken('token-A')).toBe(a.id);
    expect(await resolveInstanceIdByWebhookToken('token-B')).toBe(b.id);
  });

  it('retorna null pra token desconhecido', async () => {
    await createWhatsappInstance({
      provider: 'uazapi', isDefault: true, displayName: 'A',
      providerConfig: uazCfg('inst-A', 'token-A'),
    });
    expect(await resolveInstanceIdByWebhookToken('nao-existe')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- whatsapp-webhook-multi-instance`
Expected: FAIL — `resolveInstanceIdByWebhookToken` ainda não implementada.

- [ ] **Step 3: Implementar**

Em `server/services/whatsappInstanceService.ts`, adicionar após `loadValidWebhookTokens`:

```ts
/**
 * Mapeia um token de webhook (instanceToken OU webhookSecret) pra qual linha
 * UazAPI ativa ele pertence. Usado pra rotear inbound multi-linha pra instância
 * certa — sem isso o inbound cai sempre na linha padrão. Retorna null se nenhum
 * casar (ex.: token do env UAZAPI_WEBHOOK_SECRET, que não é de uma linha).
 */
export async function resolveInstanceIdByWebhookToken(token: string): Promise<string | null> {
  const rows = await db.select().from(whatsappInstance)
    .where(and(
      eq(whatsappInstance.provider, 'uazapi'),
      eq(whatsappInstance.isArchived, false),
    ));
  for (const row of rows) {
    const parsed = uazapiConfigSchema.safeParse(row.providerConfig);
    if (!parsed.success) continue;
    if (parsed.data.instanceToken && decryptSecret(parsed.data.instanceToken) === token) return row.id;
    if (parsed.data.webhookSecret && decryptSecret(parsed.data.webhookSecret) === token) return row.id;
  }
  return null;
}
```

- [ ] **Step 4: Rodar e ver passar (Tasks 1 + 2 completas)**

Run: `npm test -- whatsapp-webhook-multi-instance`
Expected: PASS — todos os testes de `loadValidWebhookTokens` e `resolveInstanceIdByWebhookToken`.

- [ ] **Step 5: Commit**

```bash
git add server/services/whatsappInstanceService.ts server/tests/whatsapp-webhook-multi-instance.test.ts
git commit -m "feat(whatsapp): resolveInstanceIdByWebhookToken mapeia token->instancia"
```

---

### Task 3: Rotear inbound pra instância certa (Gap C — parte 2)

`ingestInbound` passa a aceitar um `instanceId` opcional; se ausente, mantém o fallback `getDefaultInstanceId()` (backward-compat pra webhooks autenticados via env secret). O controller resolve o token→instância e repassa.

**Files:**
- Modify: `server/services/whatsappWebhookService.ts` (assinatura de `ingestInbound`, ~linhas 370-388)
- Modify: `server/controllers/whatsappWebhookController.ts` (import + chamada de `ingestInbound`, ~linhas 7 e 208)
- Test: `server/tests/whatsapp-webhook-multi-instance.test.ts` (bloco de integração)

- [ ] **Step 1: Escrever o teste de integração que falha**

Adicionar ao mesmo arquivo de teste (topo do arquivo, junto aos imports):

```ts
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db/client';
import { conversations } from '../db/schema';
import { eq } from 'drizzle-orm';

const app = createApp();

function inboundBody(messageid: string, sender: string) {
  return {
    EventType: 'messages',
    message: { messageid, sender, messageType: 'conversation', text: 'oi', timestamp: 1746115200 },
  };
}
```

E o bloco:

```ts
describe('POST /api/whatsapp/webhook — roteamento multi-instância', () => {
  it('inbound com token da linha B cria conversa na instância B (não na padrão A)', async () => {
    const a = await createWhatsappInstance({
      provider: 'uazapi', isDefault: true, displayName: 'A',
      providerConfig: uazCfg('inst-A', 'token-A'),
    });
    const b = await createWhatsappInstance({
      provider: 'uazapi', isDefault: false, displayName: 'B',
      providerConfig: uazCfg('inst-B', 'token-B'),
    });

    const res = await request(app)
      .post('/api/whatsapp/webhook?instanceToken=token-B')
      .send(inboundBody('MSG-B-1', '5511987650001@s.whatsapp.net'));
    expect(res.status).toBe(200);

    const [conv] = await db.select().from(conversations)
      .where(eq(conversations.phone, '5511987650001'));
    expect(conv).toBeDefined();
    expect(conv.instanceId).toBe(b.id);
    expect(conv.instanceId).not.toBe(a.id);
  });

  it('inbound com token desconhecido → 401', async () => {
    await createWhatsappInstance({
      provider: 'uazapi', isDefault: true, displayName: 'A',
      providerConfig: uazCfg('inst-A', 'token-A'),
    });
    const res = await request(app)
      .post('/api/whatsapp/webhook?instanceToken=token-ERRADO')
      .send(inboundBody('MSG-X', '5511987650002@s.whatsapp.net'));
    expect(res.status).toBe(401);
  });

  it('token do env UAZAPI_WEBHOOK_SECRET continua roteando pra linha padrão (backward-compat)', async () => {
    process.env.UAZAPI_WEBHOOK_SECRET = 'env-secret';
    const a = await createWhatsappInstance({
      provider: 'uazapi', isDefault: true, displayName: 'A',
      providerConfig: uazCfg('inst-A', 'token-A'),
    });

    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('X-Webhook-Token', 'env-secret')
      .send(inboundBody('MSG-ENV', '5511987650003@s.whatsapp.net'));
    expect(res.status).toBe(200);

    const [conv] = await db.select().from(conversations)
      .where(eq(conversations.phone, '5511987650003'));
    expect(conv.instanceId).toBe(a.id);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- whatsapp-webhook-multi-instance`
Expected: FAIL — o teste "cria conversa na instância B" falha (`conv.instanceId` === `a.id`, a padrão) porque `ingestInbound` ainda força `getDefaultInstanceId()`.

- [ ] **Step 3: Implementar — `ingestInbound` aceita instanceId**

Em `server/services/whatsappWebhookService.ts`, substituir a função `ingestInbound` (atual ~linhas 370-388) por:

```ts
export async function ingestInbound(
  m: InboundMessage,
  rawPayload: unknown,
  instanceId?: string,
): Promise<{ status: 'inserted' | 'duplicate' | 'ignored'; conversationId?: string; leadId?: string }> {
  // instanceId vem do controller (resolvido pelo token do webhook). Se ausente
  // (ex.: webhook autenticado via env UAZAPI_WEBHOOK_SECRET), cai na padrão.
  const resolvedInstanceId = instanceId ?? await getDefaultInstanceId();
  return ingestInboundMessage({
    instanceId: resolvedInstanceId,
    provider: 'uazapi',
    leadPhone: normalizePhone(m.from),
    leadName: m.contactName ?? undefined,
    kind: m.kind,
    text: m.text ?? undefined,
    mediaUrl: m.mediaUrl ?? undefined,
    mediaMime: m.mediaMime ?? undefined,
    providerMsgId: m.id,
    sentAt: m.timestamp,
    rawPayload,
  });
}
```

- [ ] **Step 4: Implementar — controller resolve token→instância**

Em `server/controllers/whatsappWebhookController.ts`, adicionar `resolveInstanceIdByWebhookToken` ao import existente (linha 7):

```ts
import { loadValidWebhookTokens, resolveInstanceIdByWebhookToken } from '../services/whatsappInstanceService';
```

Substituir a chamada de `ingestInbound` (linha ~208, dentro de `whatsappWebhookHandler`, logo após o `extractInbound`/bloco `debug.result = { kind: 'extracted', ... }`):

```ts
    // Roteia pra instância dona do token (multi-linha). `got` já foi validado
    // acima. Se não mapear (ex.: token do env), ingestInbound cai na padrão.
    const routedInstanceId = (await resolveInstanceIdByWebhookToken(got)) ?? undefined;
    const ingestResult = await ingestInbound(inbound, parsed.data, routedInstanceId);
```

(Substitui a linha atual `const ingestResult = await ingestInbound(inbound, parsed.data);`.)

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- whatsapp-webhook-multi-instance`
Expected: PASS — todos, incluindo os 3 de integração.

- [ ] **Step 6: Rodar a suíte de webhook existente (não-regressão)**

Run: `npm test -- whatsapp-webhook`
Expected: PASS — os testes antigos (`whatsapp-webhook.test.ts`) continuam verdes; eles autenticam via env `UAZAPI_WEBHOOK_SECRET`, que resolve `null` → default, preservando o comportamento.

- [ ] **Step 7: Commit**

```bash
git add server/services/whatsappWebhookService.ts server/controllers/whatsappWebhookController.ts server/tests/whatsapp-webhook-multi-instance.test.ts
git commit -m "feat(whatsapp): rotear inbound UazAPI pra instancia dona do token"
```

---

### Task 4: Script de adoção — re-criptografar token + registrar webhook

Operacional (roda 1x no servidor EasyPanel, onde existe `WHATSAPP_CREDENTIALS_KEY`). Fecha os dois pendentes da Etapa 1 pra linha Fixo: (a) troca o token de texto puro por `enc:` e (b) registra o webhook na UazAPI apontando pro nosso host, marcando `webhookSynced=true`. Idempotente. Sem teste unitário (padrão dos scripts em `server/scripts/`, ex.: `createAdmin.ts`, `encryptWhatsappCreds.ts`).

**Files:**
- Create: `server/scripts/adoptUazapiInstance.ts`

- [ ] **Step 1: Criar o script**

```ts
/**
 * Finaliza a adoção de uma instância UazAPI já existente numa linha do
 * LubriConnect: (1) re-criptografa o instanceToken (se estiver em texto puro)
 * e (2) registra o webhook na UazAPI apontando pro nosso host, marcando
 * webhookSynced=true.
 *
 * Roda no SERVIDOR (precisa de WHATSAPP_CREDENTIALS_KEY e APP_URL no env).
 * Idempotente: re-criptografa só se ainda não estiver "enc:"; re-registrar o
 * webhook é seguro.
 *
 * Uso:
 *   npx tsx server/scripts/adoptUazapiInstance.ts --row-id <uuid>
 */
import 'dotenv/config';
import { pool, SCHEMA_NAME } from '../db/client';
import { encryptSecret, isEncrypted, decryptSecret } from '../lib/crypto';
import { setWebhook } from '../services/whatsapp/uazapi/instanceClient';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function buildWebhookUrl(instanceToken: string): string {
  const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${appUrl}/api/whatsapp/webhook?instanceToken=${encodeURIComponent(instanceToken)}`;
}

async function run() {
  const rowId = arg('row-id');
  if (!rowId) {
    console.error('Uso: --row-id <uuid>');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ provider_config: Record<string, unknown> }>(
      `SELECT provider_config FROM ${SCHEMA_NAME}.whatsapp_instance WHERE id = $1`,
      [rowId],
    );
    if (rows.length === 0) {
      console.error(`Linha ${rowId} não encontrada.`);
      process.exit(1);
    }
    const cfg = rows[0].provider_config as Record<string, unknown>;
    const rawToken = cfg.instanceToken as string | null;
    if (!rawToken) {
      console.error('Linha sem instanceToken — nada a fazer.');
      process.exit(1);
    }

    // Token em claro pra falar com a UazAPI (decrypt faz passthrough se já claro).
    const tokenPlain = decryptSecret(rawToken);
    const baseUrl = (cfg.baseUrl as string) ?? 'https://api.uazapi.com';
    const webhookUrl = buildWebhookUrl(tokenPlain);

    // 1. Registra o webhook na UazAPI.
    await setWebhook(
      { baseUrl, token: tokenPlain },
      { url: webhookUrl, secret: tokenPlain, events: ['message.received'] },
    );
    console.log(`→ webhook registrado: ${webhookUrl}`);

    // 2. Re-criptografa o token se ainda estiver em texto puro + marca synced.
    const nextToken = isEncrypted(rawToken) ? rawToken : encryptSecret(tokenPlain);
    const nextCfg = { ...cfg, instanceToken: nextToken, webhookUrl, webhookSynced: true };

    await client.query(
      `UPDATE ${SCHEMA_NAME}.whatsapp_instance
         SET provider_config = $1::jsonb, updated_at = now() WHERE id = $2`,
      [JSON.stringify(nextCfg), rowId],
    );
    console.log(`✓ ${rowId}: token ${isEncrypted(rawToken) ? '(já cifrado)' : 'cifrado'}, webhookSynced=true`);
  } finally {
    client.release();
  }
}

run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: PASS (sem erros de tipo). `setWebhook`, `encryptSecret`, `isEncrypted`, `decryptSecret`, `pool`, `SCHEMA_NAME` já existem e são exportados.

- [ ] **Step 3: Commit**

```bash
git add server/scripts/adoptUazapiInstance.ts
git commit -m "chore(whatsapp): script pra registrar webhook + cifrar token de linha UazAPI adotada"
```

---

### Task 5: Verificação final + deploy + ativação

- [ ] **Step 1: Suíte completa + typecheck**

Run:
```bash
npm test
npm run lint
```
Expected: tudo PASS.

- [ ] **Step 2: Deploy do código** (EasyPanel — merge/push conforme fluxo do projeto). O código multi-instância PRECISA estar no ar ANTES de registrar o webhook (senão o inbound chega e é roteado errado/rejeitado).

- [ ] **Step 3: Ativar a linha Fixo** (no servidor, após deploy):

```bash
npx tsx server/scripts/adoptUazapiInstance.ts --row-id be7c6133-1ff4-413a-a7cd-bd17e777e81b
```
Expected: "webhook registrado" + "token cifrado, webhookSynced=true".

- [ ] **Step 4: Verificação manual (produção)**
  - Enviar uma mensagem de um celular de teste PRA o número `5554 2108-4500`.
  - Confirmar que a conversa aparece no Inbox vinculada à linha "Lubritec Fixo" (não à Distribuidora).
  - Confirmar no banco: `select instance_id from lubritec.conversations where phone = '<telefone_teste_canonico>'` → deve ser `be7c6133-...`.
  - Enviar uma mensagem PRA o número da Distribuidora (Meta Cloud) e confirmar que continua caindo na linha dela (não-regressão).
  - Confirmar que o token da linha Fixo agora está `enc:` no banco.

- [ ] **Step 5: Atualizar a memória do projeto** — em `memory/project_uazapi_multi_instance.md`, marcar Etapa 2 como concluída (Gap B + C fechados, webhook registrado, token re-cifrado) e ajustar o resumo em `MEMORY.md`.

---

## Riscos & Notas

- **Download de mídia inbound:** anexos (imagem/áudio) que a uazapiGO entrega por URL protegida podem exigir o token da instância pra baixar. Isso é ortogonal ao roteamento (já era assim na linha única) — se mídia da linha Fixo não renderizar, investigar o download com o token per-instância separadamente. Fora do escopo desta etapa.
- **IA de atendimento:** `processInboundWithAi` responde via caminho de envio por-instância (`resolveProvider(conv.instanceId)`), então a resposta da IA sai pela linha correta automaticamente. Verificar no smoke test se a linha Fixo estiver na fila IA.
- **Ordem de deploy:** registrar o webhook (Task 5 Step 3) SÓ depois do código no ar (Step 2). Inverter a ordem faria inbound chegar antes do roteamento existir.
- **Sem migração de schema:** nenhuma mudança em `schema.ts` nem migration nova.
```
