# WhatsApp Connection — Design

**Sub-projeto 6 do roadmap.** Página de gestão da instância UazAPI: conectar (com QR code), desconectar, apagar — substituindo a configuração estática via env vars por config persistida no DB e gerenciada pela UI. Construído sobre auth/RBAC + Cadastros + WhatsApp Inbox + Inside Sales.

## Objetivo

Dar ao admin (e comercial) controle total sobre a instância de WhatsApp do LubriConnect via UI: criar/parear instância nova com QR code, ver estado da conexão em tempo real, desconectar pra trocar de chip, e apagar credenciais quando necessário. Hoje a config é estática (env vars no `.env`) — qualquer mudança exige redeploy. A nova página torna a operação self-service.

Inspirado num padrão visto no projeto interno "command_center" (screenshot de referência), adaptado pra stack LubriConnect (Postgres puro, sem Supabase).

## Decisões fixadas (brainstorming)

- **Config no DB** (não em env vars). Env vars viram **bootstrap inicial** apenas: na primeira leitura, se DB vazio e env preenchidas, faz seed automático. Depois disso, DB é a fonte da verdade.
- **RBAC:** `admin` + `comercial` acessam a página. Recepção 403. **APAGAR é admin-only** (mesmo dentro da página).
- **Localização:** `/settings?tab=whatsapp` — Settings deixa de ser placeholder e ganha estrutura de tabs (preparada para futuras configs).
- **Webhook auto-config:** ao clicar CONECTAR, backend registra webhook URL + secret automaticamente no UazAPI. Sem botão de override no MVP.
- **Single-instance:** uma instância só. Schema é tabela single-row (UNIQUE INDEX em coluna constante).
- **Estado UazAPI é autoridade:** GET /status sempre consulta UazAPI primeiro; DB cacheia apenas o último resultado pra carregamento rápido.
- **Token nunca volta no response** — frontend só vê booleanos (`configured`, `webhookSynced`).
- **Refactor do `uazapiClient`:** vira async, lê config do DB. Shim de retrocompat preserva os testes existentes do WhatsApp Inbox.

## Schema

Migration `011_whatsapp_instance.sql`:

```sql
CREATE TABLE whatsapp_instance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton       boolean NOT NULL DEFAULT true,
  base_url        text NOT NULL,
  instance_id     text,
  instance_token  text,
  webhook_secret  text,
  webhook_url     text,
  webhook_synced  boolean NOT NULL DEFAULT false,
  phone_number    text,
  profile_name    text,
  last_status     text,
  last_status_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Single-row enforced via UNIQUE INDEX em coluna constante
CREATE UNIQUE INDEX idx_whatsapp_instance_singleton
  ON whatsapp_instance(singleton);
```

### Decisões importantes

- **Singleton via UNIQUE INDEX em `singleton boolean DEFAULT true`** — Postgres impede inserir uma 2ª linha. Sem necessidade de constraints complicadas.
- **Quase tudo nullable** exceto `base_url`, `singleton`, `webhook_synced` — fluxo de setup gradual:
  - Row criada com `base_url` (vem do env ou input do admin)
  - `instance_id`/`instance_token` preenchidos no connect
  - `webhook_*` preenchidos depois do connect bem-sucedido
  - `phone_number`/`profile_name` quando UazAPI confirma pareamento
- **`last_status` é cache informativo** — toda chamada GET /status pergunta ao UazAPI. DB guarda último resultado pra UI carregar rápido.
- **Sem coluna `is_active`** — ou existe row, ou não existe. APAGAR deleta a row.
- **`webhook_secret` separado de `instance_token`** — propósitos distintos: token autentica nossas chamadas pro UazAPI; webhook_secret autentica webhooks UazAPI→nós.

### Constantes compartilhadas

`shared/types.ts`:

```ts
export const INSTANCE_STATUSES = [
  'disconnected',
  'pairing',
  'connected',
  'error',
] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

export interface InstanceStatusResponse {
  configured: boolean;
  status: InstanceStatus;
  qrCode: string | null;
  phoneNumber: string | null;
  profileName: string | null;
  webhookSynced: boolean;
  baseUrl: string;
  lastStatusAt: string | null;
}
```

## Endpoints

Todos atrás de `authGuard` + `requireRole('admin', 'comercial')`. DELETE adicionalmente requer `admin`.

### `GET /api/whatsapp-instance`

Retorna `InstanceStatusResponse`. **Nunca** inclui `instance_token` ou `webhook_secret`.

Lógica:
1. Lê row do DB. Se vazio e env vars `UAZAPI_BASE_URL` + `UAZAPI_TOKEN` + `UAZAPI_INSTANCE_ID` + `UAZAPI_WEBHOOK_SECRET` todas preenchidas → seed automático (cria row, com `webhook_synced = true` se webhook secret vier do env).
2. Se row sem `instance_id` → retorna `configured: false`, `status: 'disconnected'`, frontend mostra empty state.
3. Se row com `instance_id` → consulta UazAPI `GET /instance/status`.
4. UazAPI responde com QR → status = `'pairing'`, `qrCode` preenchido.
5. UazAPI responde conectado → status = `'connected'`, atualiza `phone_number`/`profile_name`/`last_status` no DB.
6. UazAPI falha (timeout/5xx) → retorna `status: 'error'`. Row intacta, `last_status` mantém valor anterior.

### `POST /api/whatsapp-instance/connect`

Body opcional: `{ baseUrl?: string, instanceToken?: string }`. Se enviados, atualiza no DB antes do flow.

Lógica:
1. Garante que row existe (cria se vazio).
2. Se `instance_id` ainda vazio → chama UazAPI `POST /instance/init { name: 'lubritec' }` → recebe `instance_id` (e talvez `token`). Salva no DB.
3. Gera `webhook_secret` aleatório (`crypto.randomBytes(32).toString('hex')`) se ainda vazio.
4. Constrói `webhook_url = ${process.env.APP_URL}/api/whatsapp/webhook`.
5. Chama UazAPI `POST /instance/webhook { url, secret, events: ['message.received'] }`. Em sucesso: `webhook_synced = true`.
6. Chama UazAPI `GET /instance/qr` → retorna QR base64.
7. Atualiza `last_status = 'pairing'`, `last_status_at = now()`.
8. Retorna `InstanceStatusResponse` com QR.

Erros: qualquer falha do UazAPI → 502 com mensagem clara. Updates do DB são parciais (mantém o que conseguiu) — admin pode tentar de novo.

### `POST /api/whatsapp-instance/disconnect`

Sem body.

1. Lê row. Sem `instance_id` → 400 ("nada pra desconectar").
2. Chama UazAPI `POST /instance/logout`.
3. Atualiza `last_status = 'disconnected'`, limpa `phone_number`/`profile_name`.
4. **Não deleta row** — admin pode reconectar (re-pair) chamando connect novamente, mantendo o mesmo `instance_id`.
5. Retorna `InstanceStatusResponse` atualizada.

### `DELETE /api/whatsapp-instance`

Sem body. **`admin` apenas** (comercial recebe 403; UI esconde o botão pra ele).

1. Lê row. Vazia → 404.
2. Chama UazAPI `DELETE /instance` (best-effort — se falhar, ainda deleta local).
3. `DELETE FROM whatsapp_instance` — row some.
4. Retorna 204.

### Endpoints futuros (fora do MVP)

- `POST /api/whatsapp-instance/refresh-webhook` — re-registra webhook quando `APP_URL` muda. Por agora: APAGAR + CONECTAR.
- `POST /api/whatsapp-instance/config` — editar credenciais sem reconectar. Por agora: usa connect com `baseUrl`/`instanceToken`.

## Refactor do uazapiClient

Atual (`server/services/uazapiClient.ts`):

```ts
class UazapiClient {
  private get base() { return process.env.UAZAPI_BASE_URL ?? ''; }
  private get token() { return process.env.UAZAPI_TOKEN ?? ''; }
  private get instanceId() { return process.env.UAZAPI_INSTANCE_ID ?? ''; }
  async sendMessage(opts) { /* ... */ }
}
export const uazapiClient = new UazapiClient();
```

Novo:

```ts
async function loadInstanceConfig(): Promise<InstanceConfig> {
  const [row] = await db.select().from(whatsappInstance).limit(1);
  if (!row || !row.instanceId || !row.instanceToken) {
    throw new UazapiError(503, 'WhatsApp instance not configured');
  }
  return {
    baseUrl: row.baseUrl,
    instanceId: row.instanceId,
    token: row.instanceToken,
  };
}

export async function sendUazapiMessage(opts: SendMessageOpts): Promise<UazapiSendResponse> {
  const cfg = await loadInstanceConfig();
  // ... implementação atual com cfg.baseUrl/instanceId/token
}

// Backward-compat — preserva testes existentes do WhatsApp Inbox
export const uazapiClient = { sendMessage: sendUazapiMessage };
```

Resultado:
- `vi.mock('../services/uazapiClient', ...)` nos testes do WhatsApp Inbox continua funcionando intacto.
- Em produção, todo send agora consulta DB primeiro (1 SELECT extra, ~2ms — desprezível vs network UazAPI).
- Em dev sem instância configurada, `sendMessage` lança `UazapiError(503)` — caller traduz pra 502 (gateway unavailable). Comportamento já existente em `conversationsService.sendMessage`.

## Webhook handler refactor

Atual: `server/services/whatsappWebhookService.ts` lê `process.env.UAZAPI_WEBHOOK_SECRET`.

Novo:
1. Lê secret do DB primeiro (`whatsappInstance.webhookSecret`).
2. Se DB vazio (instância nunca configurada via UI), cai pro env var.
3. Sem secret em lugar nenhum → 401 sempre.
4. Token recebido vs secret ativo → equality check.

Cobre transição: dev-mode com env vars funcionando, produção com config via UI.

## Frontend

### Estrutura de arquivos

```
src/
  pages/settings/
    SettingsPage.tsx                    # vira shell com tabs (substitui placeholder)
    WhatsappConnectionTab.tsx           # conteúdo da tab
  features/settings/whatsapp/
    api.ts                              # hooks TanStack Query
    types.ts                            # re-exports
    InstanceStatusCard.tsx              # estado central (empty/pairing/connected/error)
    ConnectionControls.tsx              # CONECTAR / DESCONECTAR / APAGAR
    StatusBadges.tsx                    # CANAL CONECTADO/DESCONECTADO + WEBHOOK
    QrDisplay.tsx                       # QR base64 + helper text
    ConfirmDeleteDialog.tsx             # confirmação destrutiva
```

### Estados visuais

**A — Sem instância (`configured: false`):** badges (CANAL DESCONECTADO + WEBHOOK INATIVO) + botão único CONECTAR INSTÂNCIA + empty state ("Pronto para conectar").

**B — Pareando (`status: 'pairing'`):** badges (PAREANDO + WEBHOOK ATIVO) + botões DESCONECTAR/APAGAR + QR code grande (256x256) + helper de instruções (1. Abra WhatsApp, 2. Configurações > Aparelhos conectados, 3. Conectar um aparelho).

**C — Conectado (`status: 'connected'`):** badges (CANAL CONECTADO + WEBHOOK ATIVO) + botões DESCONECTAR/APAGAR + card de info (profileName, phoneNumber, conectado desde X, última verificação relativa).

**D — Erro (`status: 'error'`):** badge ❌ ERRO DE CONEXÃO (vermelho) + botões + mensagem "Falha ao consultar UazAPI. Tentando novamente…" + tooltip explicativo.

Indicador discreto **"● Credenciais protegidas no servidor"** (verde) abaixo dos botões em todos os estados — análogo ao "PROXY SEGURO" do screenshot, adaptado ao stack Lubritec (sem Supabase).

### Modal de APAGAR

```
Apagar instância de WhatsApp?

Esta ação:
• Desconecta o WhatsApp
• Apaga a instância no UazAPI
• Limpa as credenciais salvas

Conversas históricas continuam disponíveis no inbox.
Para reconectar, será necessário escanear o QR novamente.

[Cancelar] [Apagar]                      ← Apagar = destructive
```

Sem input de texto — clique duplo (botão + confirmação) basta.

### Polling com TanStack Query

```ts
function useInstanceStatus() {
  return useQuery({
    queryKey: ['whatsapp-instance'],
    queryFn: () => api<InstanceStatusResponse>('/whatsapp-instance'),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === 'pairing') return 2_000;
      if (status === 'connected') return 30_000;
      return 5_000;
    },
    refetchIntervalInBackground: false,
  });
}
```

### Mutations

```ts
useConnect()         // POST /connect → invalida ['whatsapp-instance']
useDisconnect()      // POST /disconnect
useDelete()          // DELETE → invalida + força reload imediato
```

Toasts (sonner) em cada ação: "Conectando…", "Conectado!", "Desconectado", "Instância apagada", e versões de erro com mensagens claras.

### Settings shell

`SettingsPage.tsx` vira tabs container:

```tsx
<Tabs value={tab} onValueChange={setTab}>
  <TabsList>
    <TabsTrigger value="whatsapp">Conexão WhatsApp</TabsTrigger>
    {/* futuras */}
  </TabsList>
  <TabsContent value="whatsapp">
    <WhatsappConnectionTab />
  </TabsContent>
</Tabs>
```

URL: `/settings?tab=whatsapp` (default = whatsapp já que é a única). Padrão idêntico ao `/inside-sales?tab=...`.

### RBAC no frontend

- Sidebar: link "Configurações" visível pra admin + comercial (recepção esconde).
- Tab "Conexão WhatsApp" visível pra admin + comercial.
- Botão APAGAR + ConfirmDeleteDialog renderizados apenas se `useAuthStore.user.role === 'admin'`.
- Backend dobra a guarda — UI esconder não é segurança.

## Bootstrap (env vars como seed)

`.env.example` continua com:
```
UAZAPI_BASE_URL=https://api.uazapi.com
UAZAPI_TOKEN=
UAZAPI_INSTANCE_ID=
UAZAPI_WEBHOOK_SECRET=
```

Mas com nota nova:
> Estas variáveis são usadas como **seed inicial** quando o DB ainda não tem instância configurada. Após a primeira conexão pela UI (`/settings?tab=whatsapp`), o DB vira a fonte da verdade.

Em produção: pode subir o serviço com env vars vazias e configurar tudo pela UI.

## Testes

Atualizar `setup.ts` — incluir `whatsapp_instance` no TRUNCATE:

```ts
'TRUNCATE deal_activities, deals, message_templates, messages, conversations, leads, sessions, auth_tokens, users, whatsapp_instance RESTART IDENTITY CASCADE'
```

Helper em `server/tests/helpers.ts`:

```ts
createWhatsappInstance(opts?: { baseUrl?, instanceId?, instanceToken?, webhookSecret?, ... })
```

| Arquivo | Cobertura |
|---|---|
| `whatsapp-instance-status.test.ts` | 401 sem token, 403 pra recepção, GET retorna `configured: false` quando vazio, **seed automático** quando env vars preenchidas e DB vazio, GET com instance_id consulta UazAPI (mock), traduz erro UazAPI pra status='error' |
| `whatsapp-instance-connect.test.ts` | POST cria row, gera webhook_secret, chama UazAPI init+webhook+qr (mock), retorna QR. Idempotente: se já tem instance_id, reusa em vez de recriar |
| `whatsapp-instance-disconnect.test.ts` | POST chama UazAPI logout (mock), zera phone/profile, mantém row |
| `whatsapp-instance-delete.test.ts` | 403 pra comercial, DELETE chama UazAPI delete (mock), apaga row, 204 |
| `whatsapp-instance-rbac.test.ts` | Recepção 403 em todas, comercial OK em GET/connect/disconnect mas 403 no DELETE, admin OK em tudo |
| `uazapi-config-loader.test.ts` | Função `loadInstanceConfig`: lê do DB se existe, lança 503 se DB vazio e nenhum env, faz seed automático na primeira chamada |

**Mock UazAPI:** `vi.mock('../services/uazapiInstanceClient', ...)` em todos os testes de management. O `vi.mock('../services/uazapiClient', ...)` dos testes existentes do WhatsApp Inbox continua funcionando — shim preserva interface.

**Regression test obrigatório:** após Task de refactor do uazapiClient, rodar suite completa. Todos os 188 testes existentes precisam passar verde. Se algum quebrar, shim está incompleto.

**Frontend:** sem testes adicionais (consistente). Smoke manual.

Meta: ~20 testes novos.

## Estrutura do plano

Comparável aos outros sub-projetos. ~10 tasks (escopo focado).

**Backend (~5):**
1. Migration 011 + schema + types + setup truncate + helper de teste
2. uazapiInstanceClient (init, status, qr, logout, delete, set-webhook) com fixtures
3. whatsappInstanceService (orquestra DB + UazAPI calls + seed automático)
4. Refactor do uazapiClient.sendMessage pra DB-backed + shim de retrocompat → rodar full suite verificando 188+ testes verdes
5. Endpoints + RBAC + tests TDD

**Frontend (~4):**
6. Settings shell com tabs + RBAC sidebar
7. api.ts (TanStack hooks) + helpers + types
8. WhatsappConnectionTab com 3 estados (empty/pairing/connected) + StatusBadges + QrDisplay
9. ConnectionControls + ConfirmDeleteDialog + integração total

**Encerramento:**
10. README update + suite final

## Performance

- Single-row table: SELECT é O(1).
- Polling 2s durante pairing é alto, mas curto (usuário pareia em < 1min). Acceptable.
- Polling 30s em connected é leve.
- Cada GET /status faz 1 chamada externa pro UazAPI — mesmo padrão do polling do inbox.

## Segurança

- `requireRole('admin', 'comercial')` em todas as rotas; DELETE com `requireRole('admin')` adicional.
- `instance_token` e `webhook_secret` **nunca** voltam no response — apenas booleanos.
- Webhook handler valida secret recebido contra DB; sem secret configurado → 401.
- `crypto.randomBytes(32).toString('hex')` pra geração de `webhook_secret` — 64 chars hexa = 256 bits de entropia.
- Auditoria: `last_status_at` registra última verificação. Para v2: log de ações (quem conectou/desconectou/apagou e quando).

## Fora de escopo (futuros)

- Refresh webhook isolado — agora APAGAR + CONECTAR.
- Multi-instância — Lubritec hoje tem 1 número.
- Histórico de conexão/desconexão (uptime log).
- Notificações automáticas quando chip cai.
- Editar webhook URL manualmente — gerada de APP_URL.
- Configuração de eventos UazAPI personalizada — hardcoded `['message.received']`.
- Audit log de ações administrativas.

## Roadmap atualizado

1. ✅ Auth/RBAC
2. ✅ Cadastros
3. ✅ WhatsApp Inbox
4. ✅ Inside Sales
5. **WhatsApp Connection (este sub-projeto)**
6. Disparo em massa de campanhas
7. IA de pré-qualificação
8. Dashboard de Funil
