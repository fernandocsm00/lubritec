# Botão "Retentar BrasilAPI falhou"

**Data:** 2026-06-09
**Status:** Aprovado em brainstorming, aguardando plano

## Contexto

O fix do User-Agent (commit `40d4c24`) resolve o 403 da BrasilAPI daqui pra frente. Mas leads que já foram tentados ANTES do fix ficaram com `result_status='api_error'` em `enrichment_job_leads` e o badge "BrasilAPI falhou". Hoje a única forma de retentá-los é:

- **Lead a lead**: abrir cada um e clicar "Buscar telefone (BrasilAPI)" — inviável em volume.
- **"Iniciar enriquecimento"**: cria um novo job que pega TODOS os incompletes — desperdiça ~21s × N pra retentar uma fração pequena. Se há 1000 incompletes mas só 47 são api_error, leva 6h pra "retentar os 47".

Este botão atalha: cria um job que snapshota APENAS os leads que valem retentativa (api_error transiente).

## Comportamento

Novo botão "Retentar BrasilAPI falhou" no `BulkEnrichmentDialog`, ao lado do "Iniciar enriquecimento". Visível só quando não há job ativo.

Click → cria job novo que processa apenas leads com:

1. `flow_stage = 'incomplete'`
2. Pelo menos uma linha em `enrichment_job_leads` com `result_status = 'api_error'`
3. `cnpj IS NOT NULL` E `length(cnpj) = 14`

### Estados

- **Sem job ativo + há candidatos**: cria job em `running`, toast "Retentando N leads com erro BrasilAPI."
- **Sem job ativo + zero candidatos**: 400 do backend → toast "Nenhum lead com erro BrasilAPI pra retentar agora."
- **Job ativo**: 409 → toast "Já existe um job em andamento." (mesma mensagem do botão Iniciar; UI já desabilita o botão quando `isActive`, então 409 é só fallback de segurança contra duplo-clique).

## Escolhas de produto (e por que não)

- **Mostrar contagem antes do clique** ("Retentar 47…"): exigiria query extra a cada poll do dialog (3s aberto, 30s fechado) — custo alto, valor de UX baixo. Botão estático.
- **Incluir `phone_not_in_brasilapi`** (CNPJ ativo na Receita mas sem telefone público): a Receita atualiza raramente; retentar antes de X dias é desperdiçar quota. Fora de escopo — vira feature separada "rechecar mensalmente".
- **Incluir `cnpj_not_found` / `cnpj_inactive`**: permanente. Não faz sentido retentar.
- **Auto-retry transparente** (sem clique humano): exige backoff, max attempts, política de "transiente vs permanente" mais robusta. Vira spec maior; este botão é a versão mínima.

## Arquitetura

### Backend — service

Nova função em `server/services/enrichmentJobs.ts`:

```ts
export async function startRetryApiErrorJob(userId: string): Promise<PublicEnrichmentJob>
```

Comportamento:
1. Carrega job ativo via `loadActiveRow()`. Se existe, throws `HttpError(409, 'Já existe um job de enriquecimento em andamento')` — mesma mensagem de `startBulkEnrichment`.
2. Query candidatos:
   ```sql
   SELECT DISTINCT l.id
   FROM leads l
   JOIN enrichment_job_leads ejl ON ejl.lead_id = l.id
   WHERE l.flow_stage = 'incomplete'
     AND l.cnpj IS NOT NULL
     AND length(l.cnpj) = 14
     AND ejl.result_status = 'api_error'
   ```
   `DISTINCT` porque um lead pode ter múltiplas tentativas falhas em jobs diferentes.
3. Se zero candidatos → throws `HttpError(400, 'Nenhum lead com erro BrasilAPI pra retentar')`.
4. Cria job com `status='running'`, `totalLeads=count`, `startedAt=now`, `createdByUserId=userId`.
5. Insere snapshot em `enrichment_job_leads` em chunks de 500 (mesmo padrão de `startBulkEnrichment`).
6. Retorna o `PublicEnrichmentJob` (via `buildPublic`).

### Backend — controller + rota

Em `server/controllers/leadsController.ts`:

```ts
export async function bulkEnrichRetryFailedHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await startRetryApiErrorJob(req.user!.userId);
    res.json(job);
  } catch (e) { next(e); }
}
```

Em `server/routes/leads.ts`, registrar antes de `/:id` na seção "Bulk enrichment routes":

```ts
router.post('/enrich-bulk/retry-failed', authGuard, requireRole('admin'), bulkEnrichRetryFailedHandler);
```

### Frontend — hook

Em `src/features/leads/api.ts`, novo hook análogo a `useStartBulkEnrichment`:

```ts
export function useRetryFailedBulkEnrichment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<PublicEnrichmentJob>('/leads/enrich-bulk/retry-failed', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads', 'bulk-enrich'] });
    },
  });
}
```

### Frontend — UI

Em `BulkEnrichmentDialog`:

- Novo botão "Retentar BrasilAPI falhou" no footer, ao lado de "Iniciar enriquecimento".
- Variant `outline` (secundário).
- Visível na mesma condição de "Iniciar enriquecimento" (`!isActive`).
- `disabled={retry.isPending || start.isPending}`.
- Click → chama o novo hook → toast de sucesso ou erro 400/409 com mensagem traduzida.

## Casos de borda

- **Lead com api_error de job antigo + complete depois (via individual enrich button ou edição manual)**: o filtro `flow_stage='incomplete'` exclui esses naturalmente.
- **Lead com múltiplas entradas em `enrichment_job_leads` — algumas api_error, outras phone_found**: `DISTINCT` no SELECT pega o lead UMA vez. O snapshot insere uma nova linha pendente; o worker processa normal.
- **Lead com api_error em job que foi `cancelled`**: ainda elegível pra retry (o cancelamento do job não invalida o lead).
- **CPF que caiu em api_error de algum jeito**: o filtro `length(cnpj)=14` exclui.

## Testes

Backend (`server/tests/retry-api-error.test.ts` — novo):

1. **`409 se job ativo`** — pre-cria job, chama `startRetryApiErrorJob`, espera 409.
2. **`400 se zero api_error`** — sem candidatos, espera 400 "Nenhum lead com erro BrasilAPI pra retentar".
3. **`pega só os api_error incompletos com CNPJ`** — seeda: 2 leads api_error+incompleto, 1 lead api_error+complete (já foi promovido), 1 lead cnpj_not_found+incompleto, 1 lead phone_not_in_brasilapi+incompleto, 1 lead com CPF api_error+incompleto. Espera job com `totalLeads=2`.
4. **`lead com múltiplas tentativas (api_error em job A, api_error em job B) entra UMA vez`** — DISTINCT funciona.
5. **`cria job em running com createdByUserId correto`**.
6. **`leads do snapshot ficam status=pending em enrichment_job_leads`**.

E2E API (`server/tests/leads-api.test.ts` ou novo `server/tests/retry-api-error-api.test.ts`):

7. **`POST /api/leads/enrich-bulk/retry-failed sem auth → 401`**.
8. **`POST com role recepcao → 403`**.
9. **`POST com admin + candidatos → 200 com JSON do job`**.

## Arquivos afetados

**Backend:**
- `server/services/enrichmentJobs.ts` — nova função `startRetryApiErrorJob`
- `server/controllers/leadsController.ts` — novo handler `bulkEnrichRetryFailedHandler`
- `server/routes/leads.ts` — registrar `POST /enrich-bulk/retry-failed`

**Frontend:**
- `src/features/leads/api.ts` — novo hook `useRetryFailedBulkEnrichment`
- `src/features/leads/BulkEnrichmentDialog.tsx` — botão novo no footer

**Testes:**
- `server/tests/retry-api-error.test.ts` (novo)

## Fora de escopo

- Auto-retry transparente com backoff (vira spec separada).
- Re-check periódico de `phone_not_in_brasilapi` (idem).
- Mostrar contagem de candidatos no botão antes do clique.
- Botão pra retentar leads de UM job específico (ex: "do job de 2026-06-08"). Hoje só "todos os api_error pendentes globais".
