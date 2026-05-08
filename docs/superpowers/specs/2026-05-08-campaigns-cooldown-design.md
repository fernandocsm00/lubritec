# Campanhas — Cooldown de 24h por lead

**Data:** 2026-05-08
**Módulo:** `server/services/campaigns*` + `src/features/campaigns/*`

## Contexto

Hoje uma campanha resolve sua audiência via filtro e materializa um `campaign_recipient` por lead. Não há proteção contra disparar para o mesmo lead em duas campanhas que rodam em paralelo. O cliente quer evitar que um lead receba mensagens de campanhas diferentes em janela curta — e também evitar conflito com atendimento humano/IA em curso.

## Decisões aprovadas

- **Critério de bloqueio:** lead em cooldown se **(A)** existe `messages.direction='out'` para alguma conversa do lead nos últimos 24h **OU** **(B)** existe `campaign_recipients` com `status='pending'` em outra campanha ativa (`status IN ('running','scheduled')`).
- **Escopo de "outbound":** qualquer mensagem outbound (campanha, operador no Inbox, IA) — origem não importa.
- **Feedback:** dry-run mostra contagem; recipients bloqueados viram `skipped` com `failure_reason='cooldown_24h'`; card e funil da campanha mostram subtotal dedicado; notificação proativa quando >10% da audiência for pulada por cooldown.

## Escopo

### 1. Predicado central

Novo `server/services/campaignsCooldown.ts`:

```ts
export const COOLDOWN_HOURS = 24;
export const COOLDOWN_REASON = 'cooldown_24h';

export interface CooldownBlock {
  leadId: string;
  reason: 'recent_outbound' | 'pending_other_campaign';
}

export async function filterEligibleLeads(
  leadIds: string[],
  opts: { excludeCampaignId?: string },
): Promise<{ eligible: string[]; blocked: CooldownBlock[] }>;
```

Implementação faz **uma única query** por chamada (CTE com EXISTS, sem N round-trips). Pseudocódigo:

```sql
WITH input(lead_id) AS (VALUES ...),
recent_out AS (
  SELECT DISTINCT c.lead_id
  FROM conversations c
  JOIN messages m ON m.conversation_id = c.id
  WHERE c.lead_id = ANY($leadIds)
    AND m.direction = 'out'
    AND m.sent_at > now() - interval '24 hours'
),
pending_active AS (
  SELECT DISTINCT cr.lead_id
  FROM campaign_recipients cr
  JOIN campaigns ca ON ca.id = cr.campaign_id
  WHERE cr.lead_id = ANY($leadIds)
    AND cr.status = 'pending'
    AND ca.status IN ('running','scheduled')
    AND ca.id <> $excludeCampaignId  -- omitido se null
)
SELECT i.lead_id,
       (i.lead_id IN (SELECT lead_id FROM recent_out)) AS recent_outbound,
       (i.lead_id IN (SELECT lead_id FROM pending_active)) AS pending_other
FROM input i;
```

A função classifica cada lead como `eligible` (nenhum dos dois true) ou em `blocked` com a primeira `reason` encontrada (precedência: `recent_outbound` > `pending_other_campaign` — mensagem real é prova mais forte que pendência).

### 2. Pontos de checagem

**(a) Audience dry-run** — `server/services/campaignsAudience.ts → dryRun()`

Mantém `total` (como hoje). Adiciona:

```ts
{
  total: number,
  eligible: number,
  blocked: { recentOutbound: number; pendingOtherCampaign: number },
  preview: [...]   // amostra apenas elegíveis
}
```

Resolve audiência → coleta leadIds → chama `filterEligibleLeads(leadIds, {})` → preenche os números. Tipo `CampaignDryRunResponse` em `shared/types.ts` ganha `eligible` e `blocked`.

**(b) Criação de campanha** — `server/services/campaignsService.ts → createCampaign()`

Após `resolveAudience(...)`, chama `filterEligibleLeads(leadIds, {})`. Materializa `campaign_recipients` em duas inserções na mesma transação:
- Elegíveis: `status: 'pending'`.
- Bloqueados: `status: 'skipped'`, `failure_reason: 'cooldown_24h'`. Já contabilizados em `campaigns.skipped_count` no insert (delta = bloqueados.length).

`audience_total` = total resolvido (inclui bloqueados) — mantém comparações no funil consistentes.

**(c) Dispatcher safety net** — `server/services/campaignsDispatcher.ts → sendOne()`

Imediatamente antes de `uazapiClient.sendMessage`, chama `filterEligibleLeads([r.leadId], { excludeCampaignId: c.id })`. Se bloqueado, marca recipient `skipped` com `cooldown_24h`, incrementa `skipped_count`, **não** envia. Cobre cooldown que ativou entre criação e dispatch (campanhas agendadas e contínuas).

**(d) Continuous campaign enrollment** — `server/services/continuousCampaign.ts`

Função de enrollment passa pela mesma checagem antes de criar o `campaign_recipient`. Lead bloqueado **não é enrolado** (em vez de virar `skipped`) — fica disponível para a próxima passagem de enrollment quando o cooldown expirar. Isso evita inflar permanentemente o `skipped` de uma campanha que nunca termina.

### 3. UI

**`AudienceStep.tsx`**

Linha extra abaixo do total quando `blocked.total > 0`:

```
Total: 142 · Elegíveis: 119 · Pulados por cooldown: 23
└─ 18 receberam mensagem nas últimas 24h
└─  5 já estão em outra campanha ativa
```

Cor `text-lc-amber`. Oculta toda a seção quando 0.

**`CampaignList.tsx` (card)**

Subtotal "Pulados por cooldown" abaixo de "Pulados", com ícone Clock. Renderiza só quando `>0`.

**`CampaignFunnel.tsx`**

Coluna de pulados detalha "Janela de 24h" vs "Outros". Backend fornece via `getCampaignFunnel()` (item 4).

**`RecipientsTable.tsx`**

Quando filtro = "skipped", coluna `failureReason` mostra label amigável: `cooldown_24h` → "Janela de 24h". Outros valores mantêm string original (erros do uazapi).

### 4. Funnel: `getCampaignFunnel()` ganha breakdown

Em `campaignsService.ts → getCampaignFunnel()`, no SELECT atual:

```sql
COUNT(*) FILTER (WHERE status='skipped' AND failure_reason='cooldown_24h')::int AS "skippedByCooldown",
COUNT(*) FILTER (WHERE status='skipped' AND (failure_reason IS NULL OR failure_reason <> 'cooldown_24h'))::int AS "skippedOther"
```

Tipo `CampaignFunnel` em `shared/types.ts` ganha `skippedByCooldown` e `skippedOther` (mantém `skipped` como soma para compat).

### 5. Notificação proativa "campaign_cooldown_high"

**Trigger:** ao final de `processCampaign(c)` no dispatcher, calcular ratio:

```sql
SELECT count(*) FROM campaign_recipients
WHERE campaign_id = $c.id AND status='skipped' AND failure_reason='cooldown_24h'
```

Se `ratio > 0.10 * c.audienceTotal` **E** `c.cooldownAlertSentAt IS NULL`, dispara notificação e seta `cooldown_alert_sent_at = now()`. Idempotente: uma só por campanha.

**Migration `025_campaigns_cooldown_alert.sql`:**

```sql
ALTER TABLE campaigns ADD COLUMN cooldown_alert_sent_at timestamptz;
```

**Notificação:** novo kind `campaign_cooldown_high` em `shared/types.ts`. Payload `{ campaignId, campaignName, skippedCount, audienceTotal, ratio }`. Deep-link `/campaigns/:id?recipientStatus=skipped`.

**Frontend:** `src/features/notifications/helpers.ts` ganha label "Muitos leads pulados por cooldown" + ícone Clock pro novo kind.

## Compatibilidade

- Campanhas existentes não recebem retroativamente o cooldown (recipients antigos não são reclassificados). A regra entra em vigor para criações e dispatches futuros.
- A constante `'cooldown_24h'` em `failure_reason` não colide com mensagens existentes (que são erros do uazapi, geralmente longos).
- `audience_total` mantém significado original (total resolvido); `skipped_count` continua sendo o total de skipped (cooldown + erros).

## Testes

`server/tests/campaigns-cooldown.test.ts` (novo) — 7 cenários:

1. Lead recebeu outbound (mensagem manual de operador) há 5h → bloqueado por `recent_outbound`.
2. Lead recebeu outbound há 25h → elegível.
3. Lead pendente em campanha `running` → bloqueado por `pending_other_campaign`.
4. Lead pendente em campanha `draft` → elegível (draft não conta).
5. Lead pendente em campanha `running` mas `excludeCampaignId` é essa mesma campanha → elegível.
6. `createCampaign` com leads mistos → elegíveis viram `pending`, bloqueados viram `skipped` com `failure_reason='cooldown_24h'`. `skipped_count` incrementado corretamente.
7. Dispatcher: lead estava elegível na criação, recebeu mensagem outbound antes do dispatch → recipient marcado `skipped` em vez de `sent`. `skipped_count` incrementa, `sent_count` não.

`server/tests/campaigns-dryrun.test.ts` (criar se não existe) — `eligible` e `blocked.{recentOutbound, pendingOtherCampaign}` corretos.

`server/tests/campaigns-funnel.test.ts` — atualizar para cobrir `skippedByCooldown` e `skippedOther`.

`server/tests/campaigns-cooldown-notification.test.ts` (novo) — 2 cenários:

1. Campanha com 100 leads, 15 bloqueados por cooldown no dispatcher → notificação `campaign_cooldown_high` criada uma vez.
2. Próxima passagem do dispatcher → notificação não é duplicada (`cooldown_alert_sent_at` populado).

## Fora de escopo

- Janela configurável por org/canal — `COOLDOWN_HOURS = 24` hardcoded.
- Reaproveitar leads bloqueados quando expira o cooldown — recipient `skipped` é terminal. Se o operador quer alcançá-los, cria nova campanha ou aguarda a contínua reenrolar automaticamente.
- Cooldown por canal (WhatsApp/e-mail) — só WhatsApp existe.
- Auditoria de bloqueios (log de quem foi bloqueado por quê) — recuperável da própria tabela `campaign_recipients` via `failure_reason`.
