# Auto-disparo de enriquecimento pós-importação de CSV

**Data:** 2026-06-09
**Status:** Aprovado em brainstorming, aguardando plano

## Contexto

Hoje a importação de CSV (`leadsImport.ts`) insere leads imediatamente. Leads sem telefone ficam `flow_stage='incomplete'` e dependem de um job de enriquecimento BrasilAPI, que **só roda quando algum admin clica manualmente em "Iniciar enriquecimento"**. Resultado prático: leads novos sem telefone ficam parados até alguém lembrar de disparar o worker. O auto-disparo elimina esse esquecimento — toda importação dispara (ou anexa a) um job em background, sem fricção extra.

Fora de escopo desta entrega: IA buscando telefone no Google (fallback quando BrasilAPI falha). Será brainstormado separadamente.

## Comportamento

Logo após `importLeadsFromCsv` commitar a transação:

1. Conta quantos leads novos ficaram `flow_stage='incomplete'`.
2. **Se zero**: não dispara nada. UX idêntica à atual.
3. **Se há novos incompletos**:
   - **Sem job ativo** (nenhum em `pending`/`running`/`paused`) → cria um novo job via `startBulkEnrichment(userId)`. Snapshot atual cobre TODOS os incompletes com CNPJ (14 dig) — bom efeito colateral: zera dívida antiga.
   - **Com job ativo** → **anexa** os IDs dos novos incompletos a `enrichment_job_leads` (status='pending'), e soma no `total_leads` do job. Worker continua tickando normalmente.

CPFs (11 dígitos) não são enriquecíveis pela BrasilAPI — `appendLeadsToActiveJob` e `startBulkEnrichment` filtram por `length(cnpj)=14`, então CPFs ficam silenciosamente fora do snapshot mesmo se o caller passar IDs deles.

## Arquitetura

### Novo serviço: `appendLeadsToActiveJob`

Em `server/services/enrichmentJobs.ts`:

```ts
export async function appendLeadsToActiveJob(
  leadIds: string[],
): Promise<{ jobId: string; appended: number } | null>;
```

Comportamento:
- Carrega o job ativo via `loadActiveRow()` (status em `pending`, `running`, `paused`).
- Retorna `null` se não existe.
- Filtra `leadIds` pra incluir apenas leads onde `cnpj IS NOT NULL` e `length(cnpj)=14` e `flow_stage='incomplete'`.
- Dedupe contra `enrichment_job_leads` (não anexa leads que já estão no snapshot do job — defesa contra race entre 2 imports simultâneos).
- Insere os novos rows com `status='pending'`, em chunks de 500 (mesmo padrão de `startBulkEnrichment`).
- Bump `total_leads` em `enrichment_jobs` pelo número anexado.
- Tudo dentro de uma transação.
- Retorna `{ jobId, appended }` com o count efetivamente anexado (pode ser zero se todos os IDs já estavam no snapshot ou foram filtrados).

### Novo serviço: `triggerAutoEnrichment`

Em `server/services/leadsImport.ts` (ou um novo `enrichmentTrigger.ts` se preferível) — função pequena, pode viver no arquivo do import já que é o único caller:

```ts
async function triggerAutoEnrichment(
  newLeadIds: string[],
  userId: string,
): Promise<EnrichmentTriggerResult | null>;
```

Onde `EnrichmentTriggerResult`:

```ts
type EnrichmentTriggerResult = {
  jobId: string;
  mode: 'started' | 'appended';
  newLeadsQueued: number;
  estimatedMinutes: number;
};
```

Lógica:
1. Tenta `appendLeadsToActiveJob(newLeadIds)`.
2. Se retorno foi `null` (sem job ativo) → chama `startBulkEnrichment(userId)`. Resultado: `mode='started'`, `newLeadsQueued` = `totalLeads` retornado pelo job (cobre backlog + novos).
3. Se retorno foi `{ jobId, appended }` → `mode='appended'`, `newLeadsQueued=appended`.
4. `estimatedMinutes = Math.ceil((newLeadsQueued * ENRICHMENT_TICK_MS) / 60_000)`.
5. **Try/catch envolvendo TUDO**: qualquer erro é logado (`console.error`) e a função retorna `null`. O import NUNCA falha por causa do auto-disparo.

### Modificação em `importLeadsFromCsv`

Hoje a assinatura recebe `(buf, _opts)`. Vamos adicionar `userId` ao opts:

```ts
export async function importLeadsFromCsv(
  buf: Buffer,
  opts: { throttleMs?: number; userId?: string } = {},
): Promise<ImportReport>
```

`userId` é o id do admin que está importando — controller passa via `req.user!.userId`. É opcional pra preservar backwards-compat com testes existentes (sem `userId`, auto-disparo é pulado silenciosamente).

Após o loop `tryEnrollSafe` (best-effort fora do tx):

```ts
let enrichmentTriggered: EnrichmentTriggerResult | null = null;
const newIncompleteIds = newLeads
  .filter((l) => l.stage === 'incomplete')
  .map((l) => l.id);
if (opts.userId && newIncompleteIds.length > 0) {
  enrichmentTriggered = await triggerAutoEnrichment(newIncompleteIds, opts.userId);
}
return { inserted, updated, skipped: 0, rejected, enrichmentTriggered };
```

### Modificação no tipo `ImportReport`

Em `shared/types.ts`, adicionar campo opcional:

```ts
export interface ImportReport {
  inserted: number;
  updated: number;
  skipped: number;
  rejected: { line: number; reason: string }[];
  enrichmentTriggered?: {
    jobId: string;
    mode: 'started' | 'appended';
    newLeadsQueued: number;
    estimatedMinutes: number;
  } | null;
}
```

### Modificação no controller

`server/controllers/leadsController.ts` (handler de import) — passa `req.user!.userId` no `opts`:

```ts
const report = await importLeadsFromCsv(buffer, { userId: req.user!.userId });
```

### Modificação no frontend

Em `src/features/leads/` (página de import — verificar nome exato durante implementação):

- Após receber `ImportReport`, se `enrichmentTriggered != null`:
  - **Mode `started`**: toast verde "Importação OK. {newLeadsQueued} leads na fila de enriquecimento — conclui em ~{estimatedMinutes}min."
  - **Mode `appended`**: toast verde "Importação OK. {newLeadsQueued} leads anexados ao job de enriquecimento em andamento."

Não cria UI nova além do toast — a tela `/cadastros` já mostra status do job ativo.

## Erros & edge cases

- **Importação só com leads completos** (todos têm telefone): `newIncompleteIds` é vazio, auto-disparo pulado. Response sem `enrichmentTriggered`.
- **Importação só com CPFs incompletos**: leads viram `incomplete` no banco, mas `appendLeadsToActiveJob` filtra por `length(cnpj)=14`. `newLeadsQueued` será 0 — auto-disparo é "pulado" mas retorna `{ mode, jobId, newLeadsQueued: 0, estimatedMinutes: 0 }` quando há job ativo. Quando não há, `startBulkEnrichment` ainda assim cria o job se houver outros backlog incompletos. Se não houver nenhum CNPJ incompleto na base, `startBulkEnrichment` joga 400 ("Nenhum lead incompleto…") — capturado pelo try/catch, retorna `null`, import OK.
- **Importação durante job paused**: trata como "ativo" → anexa. Worker retoma os novos quando admin clica "resume".
- **Race entre 2 imports simultâneos**: cada um chama `triggerAutoEnrichment`. Caso 1: ambos veem nenhum job → ambos tentam `startBulkEnrichment`, segundo recebe 409 ("Já existe um job em andamento") — try/catch captura, retorna `null`. Aceitável: um dos imports não vê o `enrichmentTriggered`, mas os leads dele entram no snapshot do job criado pelo outro. Caso 2: ambos veem job ativo → ambos anexam, dedupe garante que cada lead entra só uma vez.
- **Importação gigante** (10k novos incompletos) + job rodando (5k já snapshotado): anexa todos, total_leads vai pra 15k. ~88h de tick. Admin vê estimativa no toast e pode pausar/cancelar pela UI existente.
- **Lead criado como `incomplete` que depois é editado manualmente com telefone antes do worker tickar**: worker já trata isso (`already_has_phone` em `processNextEnrichment`). Sem mudança.

## Testes

Backend (`server/tests/leads-import-auto-enrichment.test.ts` ou estender o existente):

1. **`não dispara quando todos os novos leads têm phone`** — import com phone, `enrichmentTriggered` não presente / null.
2. **`cria job novo quando não há job ativo`** — import só com CNPJ, response inclui `enrichmentTriggered.mode === 'started'`, job em `running` no banco.
3. **`anexa ao job ativo`** — pre-cria job em `running` com 3 leads, importa 2 novos, response `mode === 'appended'`, `newLeadsQueued === 2`, `total_leads` do job vai pra 5.
4. **`dedupe não anexa leads já no snapshot`** — pre-cria job que já contém o lead X; importação que "atualiza" X não anexa de novo.
5. **`CPF puro é filtrado`** — import só com CPFs, `newLeadsQueued === 0` (ou `enrichmentTriggered === null` se nenhum CNPJ no banco).
6. **`auto-disparo NUNCA falha o import`** — mocka `startBulkEnrichment` pra throw; response ainda 200 com `enrichmentTriggered: null`.
7. **`anexa funciona com job paused`** — pre-cria job pausado, anexa OK, total_leads bumpado.

## Fora de escopo

- Toggle de admin pra desabilitar auto-disparo. YAGNI — se incomodar, paramos depois.
- Notificação WebSocket "X leads anexados ao seu job" em tempo real. Toast da resposta já cobre.
- Histórico de "jobs criados por import vs. manuais". Não há valor de produto agora.
- IA Google fallback. Será brainstormado separadamente.

## Arquivos afetados

**Backend:**
- `shared/types.ts` — adicionar `enrichmentTriggered` opcional em `ImportReport`
- `server/services/enrichmentJobs.ts` — nova função `appendLeadsToActiveJob`
- `server/services/leadsImport.ts` — adicionar `opts.userId`, função local `triggerAutoEnrichment`, chamada pós-tx
- `server/controllers/leadsController.ts` — passar `req.user!.userId` no opts

**Frontend:**
- página/component de import de leads — toast usando `report.enrichmentTriggered`

**Testes:**
- `server/tests/leads-import-auto-enrichment.test.ts` (novo)
