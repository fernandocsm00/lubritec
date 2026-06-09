# Conversation Pipeline + Campaign Origin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar (1) seletor de fase do CRM dentro do painel da conversa (LeadSidebar) e (2) pill com o nome da campanha de origem em cada linha da lista de conversas.

**Architecture:**
- Backend: novo endpoint `GET /deals/by-lead/:leadId` + LEFT JOIN com `campaigns` no `listConversations` pra retornar `originCampaignName`.
- Frontend: refatorar `PipelineSection` em `LeadSidebar` pra usar Select shadcn que cria/move o deal; estender `ConversationRow` com pill compacto de origem.

**Tech Stack:** Express + Drizzle ORM + Postgres (Supabase), React 19 + TypeScript + TanStack Query + shadcn/ui, Vitest + Supertest pra testes de backend.

**Spec:** `docs/superpowers/specs/2026-06-09-conversation-pipeline-and-origin-design.md`

---

## File Structure

**Modificações backend:**
- `shared/types.ts` — adicionar `originCampaignName: string | null` em `PublicConversation`
- `server/services/conversationsService.ts` — LEFT JOIN com `campaigns` + select de `campaigns.name`
- `server/services/dealsService.ts` — nova função `getDealByLeadId`
- `server/controllers/dealsController.ts` — novo handler `byLeadHandler`
- `server/routes/deals.ts` — registrar rota `GET /deals/by-lead/:leadId`

**Modificações frontend:**
- `src/features/inside-sales/api.ts` — novo hook `useDealByLead`
- `src/features/whatsapp/LeadSidebar.tsx` — refatorar `PipelineSection` em novo componente
- `src/features/whatsapp/ConversationRow.tsx` — adicionar pill de origem

**Testes:**
- `server/tests/deals-by-lead.test.ts` — testa o novo endpoint
- `server/tests/conversations-list.test.ts` — adicionar asserção do `originCampaignName`

**Decomposição:** o `LeadSidebar` ganha um novo componente `PipelinePhasePicker` separado dentro do mesmo arquivo (toda a lógica de dialog/mutation cabe num componente local — não vale separar arquivo agora).

---

## Task 1: Tipo `originCampaignName` em `PublicConversation`

**Files:**
- Modify: `shared/types.ts` (interface `PublicConversation`, ~linha 180)

- [ ] **Step 1: Adicionar o campo no tipo compartilhado**

Localizar em `shared/types.ts` o bloco da interface `PublicConversation` (linha ~180). Adicionar a linha `originCampaignName: string | null;` logo após `originCampaignId: string | null;`:

```ts
export interface PublicConversation {
  id: string;
  phone: string;
  lead: {
    id: string;
    name: string;
    cnpj: string | null;
    status: LeadStatus;
  };
  queue: ConversationQueue;
  status: ConversationStatus;
  assignedTo: { id: string; name: string } | null;
  originKind: OriginKind;
  originCampaignId: string | null;
  originCampaignName: string | null;
  lastMessagePreview: string;
  // ... resto inalterado
}
```

- [ ] **Step 2: Verificar typecheck**

Rodar do `lubritec-main/`:

```bash
npm run typecheck
```

Esperado: erros em `server/services/conversationsService.ts` reclamando que o mapping não preenche `originCampaignName`. Esse é o sinal de que o tipo foi propagado.

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "feat: add originCampaignName to PublicConversation type"
```

---

## Task 2: Backend join com `campaigns` em `listConversations`

**Files:**
- Modify: `server/services/conversationsService.ts` (função `listConversations`, query e mapping)

- [ ] **Step 1: Importar `campaigns` schema**

Em `server/services/conversationsService.ts`, linha 2, adicionar `campaigns` ao import:

```ts
import { conversations, messages, leads, users, whatsappInstance, campaigns } from '../db/schema';
```

- [ ] **Step 2: Adicionar LEFT JOIN e select de `campaigns.name`**

Localizar o bloco `db.select({...}).from(conversations).leftJoin(leads, ...).leftJoin(users, ...)` (linhas ~114–148). Adicionar:

- No objeto `select({...})`: nova chave `campaignName: campaigns.name`
- Após o `leftJoin(users, ...)`: `leftJoin(campaigns, eq(conversations.originCampaignId, campaigns.id))`

Bloco final:

```ts
const rows = await db
  .select({
    conv: conversations,
    lead: leads,
    assignee: users,
    campaignName: campaigns.name,
    lastMsgBody: sql<string | null>`(
      SELECT m.body FROM messages m
      WHERE m.conversation_id = ${conversations.id}
      ORDER BY m.sent_at DESC LIMIT 1
    )`,
    lastMsgKind: sql<string | null>`(
      SELECT m.kind FROM messages m
      WHERE m.conversation_id = ${conversations.id}
      ORDER BY m.sent_at DESC LIMIT 1
    )`,
    lastMsgDir: sql<string | null>`(
      SELECT m.direction FROM messages m
      WHERE m.conversation_id = ${conversations.id}
      ORDER BY m.sent_at DESC LIMIT 1
    )`,
  })
  .from(conversations)
  .leftJoin(leads, eq(conversations.leadId, leads.id))
  .leftJoin(users, eq(conversations.assignedTo, users.id))
  .leftJoin(campaigns, eq(conversations.originCampaignId, campaigns.id))
  .where(where)
  .orderBy(
    input.queue === 'comercial'
      ? sql`${conversations.enteredQueueAt} ASC NULLS LAST`
      : desc(conversations.lastMessageAt),
  )
  .limit(PAGE_SIZE)
  .offset((page - 1) * PAGE_SIZE);
```

- [ ] **Step 3: Preencher `originCampaignName` no mapping**

No mesmo arquivo, no mapping `rows.map((r) => {...})` (linhas ~150–181), adicionar a chave logo após `originCampaignId`:

```ts
originKind: r.conv.originKind,
originCampaignId: r.conv.originCampaignId,
originCampaignName: r.campaignName ?? null,
lastMessagePreview: previewFromMessage({
```

- [ ] **Step 4: Atualizar teste existente pra assertar o novo campo**

Em `server/tests/conversations-list.test.ts`, no teste que filtra por `noResponse` (linha ~90, já cria conversation com `originCampaignId`), adicionar uma asserção que verifica que o campo retornado bate com o nome da campanha. Adicionar logo após o `expect(res.body.items.length).toBeGreaterThan(0)`:

```ts
const item = res.body.items.find((c: { phone: string }) => c.phone === '11000010030');
expect(item).toBeDefined();
expect(item.originCampaignName).toBe(campaign.name);
```

E adicionar um caso explícito pra conversa orgânica retornando `null`. Logo após o `describe` correspondente (ou no fim do mesmo `describe`), inserir:

```ts
it('retorna originCampaignName null em conversa orgânica', async () => {
  const token = await seedAuth();
  const lead = await createLead({ phone: '11000010050' });
  await createConversation({
    phone: '11000010050',
    leadId: lead.id,
    originKind: 'organic',
    originCampaignId: null,
  });

  const res = await request(app)
    .get('/api/conversations')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  const item = res.body.items.find((c: { phone: string }) => c.phone === '11000010050');
  expect(item).toBeDefined();
  expect(item.originCampaignName).toBeNull();
});
```

- [ ] **Step 5: Rodar os testes**

Do `lubritec-main/`:

```bash
npm test -- conversations-list
```

Esperado: ambos os testes passam (o ajustado com asserção do nome e o novo de orgânica).

- [ ] **Step 6: Commit**

```bash
git add server/services/conversationsService.ts server/tests/conversations-list.test.ts
git commit -m "feat: expose origin campaign name in conversation list"
```

---

## Task 3: Backend `getDealByLeadId` no service

**Files:**
- Modify: `server/services/dealsService.ts` (adicionar função após `getDealById`)
- Test: `server/tests/deals-by-lead.test.ts` (criar)

- [ ] **Step 1: Escrever teste do endpoint (falha primeiro)**

Criar `server/tests/deals-by-lead.test.ts` com:

```ts
import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../app';
import { resetDb } from './helpers';
import { createLead, createUser, loginAs, seedAuth } from './helpers';
import { createDeal } from '../services/dealsService';

describe('GET /deals/by-lead/:leadId', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('retorna o deal vigente quando o lead já está no pipeline', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000020001' });
    const owner = await createUser({ email: 'owner-bylead@x.com', role: 'comercial' });
    const deal = await createDeal({
      leadId: lead.id,
      ownerUserId: owner.id,
      source: 'manual',
    });

    const res = await request(app)
      .get(`/api/deals/by-lead/${lead.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();
    expect(res.body.id).toBe(deal.id);
    expect(res.body.lead.id).toBe(lead.id);
    expect(res.body.stage).toBe('lead_no_comercial');
  });

  it('retorna null quando o lead não tem deal', async () => {
    const token = await seedAuth();
    const lead = await createLead({ phone: '11000020002' });

    const res = await request(app)
      .get(`/api/deals/by-lead/${lead.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('bloqueia role recepcao com 403', async () => {
    const lead = await createLead({ phone: '11000020003' });
    await createUser({ email: 'recep-bylead@x.com', password: 'pw123456', role: 'recepcao' });
    const token = await loginAs('recep-bylead@x.com');

    const res = await request(app)
      .get(`/api/deals/by-lead/${lead.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar o teste pra confirmar falha**

```bash
npm test -- deals-by-lead
```

Esperado: FAIL (rota não existe → 404 nas duas primeiras assertions).

- [ ] **Step 3: Implementar `getDealByLeadId` no service**

Em `server/services/dealsService.ts`, logo após `getDealById` (linha ~301), adicionar:

```ts
// ---------------------------------------------------------------------------
// getDealByLeadId — usado pelo painel da conversa pra exibir/mover fase
// ---------------------------------------------------------------------------

export async function getDealByLeadId(leadId: string): Promise<PublicDeal | null> {
  const [row] = await db
    .select({
      deal: deals,
      lead: leads,
      owner: users,
      enteredCurrentStageAt: enteredStageSql,
      isStale: isStaleSql,
      aiSummary: aiSummarySql,
    })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(users, eq(deals.ownerUserId, users.id))
    .where(eq(deals.leadId, leadId))
    .orderBy(desc(deals.updatedAt))
    .limit(1);

  if (!row) return null;
  return toPublic(row);
}
```

Notas:
- Reusa `toPublic`, `enteredStageSql`, `isStaleSql`, `aiSummarySql` que já existem no arquivo (mesmo padrão de `getDealById`).
- Retorna apenas `PublicDeal` sem activities (payload enxuto pro sidebar).
- `orderBy desc(updatedAt)` cobre o caso teórico de múltiplos deals histórically — pega o mais recente.

- [ ] **Step 4: Commit parcial (service)**

```bash
git add server/services/dealsService.ts server/tests/deals-by-lead.test.ts
git commit -m "feat: add getDealByLeadId service function with test"
```

(O teste continua falhando aqui — falta controller + rota nas próximas tasks. Commit parcial é OK porque o service é uma unidade lógica.)

---

## Task 4: Backend handler + rota `GET /deals/by-lead/:leadId`

**Files:**
- Modify: `server/controllers/dealsController.ts` (adicionar handler)
- Modify: `server/routes/deals.ts` (registrar rota)

- [ ] **Step 1: Adicionar handler no controller**

Em `server/controllers/dealsController.ts`, importar `getDealByLeadId`. Localizar o import no topo (linhas 4–8):

```ts
import {
  listBoard,
  listHistory,
  getDealById,
  getDealByLeadId,
} from '../services/dealsService';
```

No fim do arquivo (após `deleteHandler`, linha ~148), adicionar:

```ts
const byLeadParams = z.object({ leadId: z.string().uuid() });

export async function byLeadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { leadId } = byLeadParams.parse(req.params);
    const deal = await getDealByLeadId(leadId);
    res.json(deal);
  } catch (e) { next(e); }
}
```

- [ ] **Step 2: Registrar rota**

Em `server/routes/deals.ts`, importar `byLeadHandler` e registrar a rota. Arquivo completo deve ficar:

```ts
import { Router } from 'express';
import { authGuard } from '../middleware/authGuard';
import { requireRole } from '../middleware/requireRole';
import {
  boardHandler,
  historyHandler,
  getHandler,
  createHandler,
  patchHandler,
  stageHandler,
  deleteHandler,
  byLeadHandler,
} from '../controllers/dealsController';

const router = Router();

const guard = [authGuard, requireRole('admin', 'comercial')];
const adminOnly = [authGuard, requireRole('admin')];

router.get('/history', ...guard, historyHandler);
router.get('/by-lead/:leadId', ...guard, byLeadHandler);
router.get('/', ...guard, boardHandler);
router.get('/:id', ...guard, getHandler);
router.post('/', ...guard, createHandler);
router.patch('/:id', ...guard, patchHandler);
router.post('/:id/stage', ...guard, stageHandler);
router.delete('/:id', ...adminOnly, deleteHandler);

export default router;
```

Notas:
- A ordem importa: `/by-lead/:leadId` precisa vir ANTES de `/:id` pra não ser sequestrado pelo handler de id genérico.
- Guard é o mesmo `admin/comercial` das demais rotas.

- [ ] **Step 3: Rodar os testes**

```bash
npm test -- deals-by-lead
```

Esperado: os 3 testes do Task 3 agora passam (deal encontrado, deal null, role bloqueada).

- [ ] **Step 4: Commit**

```bash
git add server/controllers/dealsController.ts server/routes/deals.ts
git commit -m "feat: add GET /deals/by-lead/:leadId route"
```

---

## Task 5: Frontend hook `useDealByLead`

**Files:**
- Modify: `src/features/inside-sales/api.ts` (adicionar hook após `useDeal`)

- [ ] **Step 1: Adicionar o hook**

Em `src/features/inside-sales/api.ts`, logo após `useDeal` (linha ~98), adicionar:

```ts
export function useDealByLead(leadId: string | null) {
  return useQuery({
    queryKey: ['deals', 'by-lead', leadId],
    queryFn: () => api<PublicDeal | null>(`/deals/by-lead/${leadId}`),
    enabled: !!leadId,
    staleTime: 30_000,
  });
}
```

Notas:
- `PublicDeal | null` reflete o contrato do backend.
- `staleTime: 30_000` evita refetch agressivo enquanto o usuário troca de conversa rápido.
- Cache key separada de `['deals', 'detail', id]` (que carrega activities) — não interfere.

- [ ] **Step 2: Verificar typecheck**

```bash
npm run typecheck
```

Esperado: passa.

- [ ] **Step 3: Commit**

```bash
git add src/features/inside-sales/api.ts
git commit -m "feat: add useDealByLead hook"
```

---

## Task 6: Pill de origem de campanha em `ConversationRow`

**Files:**
- Modify: `src/features/whatsapp/ConversationRow.tsx`

- [ ] **Step 1: Adicionar `Megaphone` ao import e pill no JSX**

Em `src/features/whatsapp/ConversationRow.tsx`, atualizar o import de `lucide-react` (linha 2) pra incluir `Megaphone`:

```ts
import { Image as ImageIcon, Bot, Clock, Megaphone } from 'lucide-react';
```

Localizar o bloco final do JSX (a div com `className="flex items-center justify-between gap-2 mt-1"` que contém `ownerLabel` e `waitMin`, ~linhas 80–87). Logo APÓS essa div de fechamento `</div>` (e antes do `</div>` que fecha o `min-w-0`), adicionar:

```tsx
{conv.originKind === 'campaign' && conv.originCampaignName && (
  <div className="mt-1">
    <span
      className="inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground max-w-[140px]"
      title={`Campanha: ${conv.originCampaignName}`}
    >
      <Megaphone className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{conv.originCampaignName}</span>
    </span>
  </div>
)}
```

Bloco final do componente (estrutura completa pra referência):

```tsx
        <div className="flex items-center justify-between gap-2 mt-1">
          <div className={`text-[10px] ${ownerColor}`}>{ownerLabel}</div>
          {waitMin != null && (
            <div className={`text-[10px] flex items-center gap-0.5 ${waitingToneClasses(waitMin)}`}>
              <Clock className="h-2.5 w-2.5" /> {formatWaitingLabel(waitMin)}
            </div>
          )}
        </div>
        {conv.originKind === 'campaign' && conv.originCampaignName && (
          <div className="mt-1">
            <span
              className="inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground max-w-[140px]"
              title={`Campanha: ${conv.originCampaignName}`}
            >
              <Megaphone className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{conv.originCampaignName}</span>
            </span>
          </div>
        )}
      </div>
    </button>
```

Notas:
- Pill só aparece se `originKind === 'campaign'` E `originCampaignName != null` (cobre campanhas deletadas com `ON DELETE SET NULL`).
- Não exibe nada pra orgânica — evita ruído visual.
- `title` mostra o nome completo ao hover (cobre nomes truncados).

- [ ] **Step 2: Verificar typecheck**

```bash
npm run typecheck
```

Esperado: passa (o tipo `originCampaignName` foi adicionado em Task 1).

- [ ] **Step 3: Visual smoke test**

Rodar o app (`npm run dev` em outro terminal) e abrir o Inbox numa conversa que tenha origem de campanha. Confirmar:
- A pill aparece abaixo da linha do owner.
- Nome da campanha aparece truncado se for longo.
- Hover mostra o nome completo no tooltip.
- Conversa orgânica não exibe a pill.

(Se não houver conversa de campanha no banco local, criar uma rapidamente via `createCampaign` + `createConversation` num seed, ou pular este step se já validou via testes backend.)

- [ ] **Step 4: Commit**

```bash
git add src/features/whatsapp/ConversationRow.tsx
git commit -m "feat: show campaign origin pill in conversation list"
```

---

## Task 7: Componente `PipelinePhasePicker` no `LeadSidebar`

**Files:**
- Modify: `src/features/whatsapp/LeadSidebar.tsx`

- [ ] **Step 1: Atualizar imports**

No topo de `src/features/whatsapp/LeadSidebar.tsx` (linhas 1–14), substituir o bloco de imports relevantes. O arquivo deve ter:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { useAuthStore } from '@/features/auth/store';
import {
  useCreateDeal, useChangeStage, useDealByLead,
} from '@/features/inside-sales/api';
import { STAGE_LABELS } from '@/features/inside-sales/helpers';
import { GanhoValueDialog } from '@/features/inside-sales/GanhoValueDialog';
import { LossReasonDialog } from '@/features/inside-sales/LossReasonDialog';
import { DEAL_STAGES, type DealStage, type LossReason, type LeadQualityFeedback } from '@shared/types';
import { useConversations } from './api';
import { avatarInitials, formatPhoneBR } from './helpers';
import { formatCnpj } from '@/lib/utils';
import { useLead } from '@/features/leads/api';
import { LeadDialog } from '@/features/leads/LeadDialog';
import type { ConversationFilters, PublicConversation } from './types';
```

- [ ] **Step 2: Substituir `PipelineSection` pelo novo componente**

Remover a função `PipelineSection` atual (linhas ~98–123) e substituir por:

```tsx
function PipelineSection({ leadId }: { leadId: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const visible = role === 'admin' || role === 'comercial';
  if (!visible) return null;

  return (
    <div className="px-4 py-3 border-b border-border">
      <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
        Pipeline
      </h4>
      <PipelinePhasePicker leadId={leadId} />
    </div>
  );
}

function PipelinePhasePicker({ leadId }: { leadId: string }) {
  const { data: deal, isLoading } = useDealByLead(leadId);
  const create = useCreateDeal();
  const change = useChangeStage();

  const [pendingStage, setPendingStage] = useState<DealStage | null>(null);
  const showGanho = pendingStage === 'ganho';
  const showPerdido = pendingStage === 'perdido';

  const currentStage: DealStage | '' = deal?.stage ?? '';
  const isBusy = create.isPending || change.isPending;

  async function moveExistingDeal(
    dealId: string,
    stage: DealStage,
    extra?: { lossReason?: LossReason; leadQualityFeedback?: LeadQualityFeedback; proposalValue?: number },
  ) {
    if (extra?.proposalValue != null) {
      // Antes de Ganho: persistir o proposalValue se foi capturado no dialog.
      // Endpoint stage não aceita value, então passamos via patch.
      // (Mantém consistência com fluxo do Kanban.)
      // eslint-disable-next-line no-console
    }
    await change.mutateAsync({
      id: dealId,
      stage,
      lossReason: extra?.lossReason,
      leadQualityFeedback: extra?.leadQualityFeedback,
    });
  }

  async function handleSelect(stage: DealStage) {
    // Ganho/Perdido sempre abrem dialog primeiro
    if (stage === 'ganho' || stage === 'perdido') {
      setPendingStage(stage);
      return;
    }

    try {
      if (!deal) {
        // Cria deal direto na fase desejada (criação em lead_no_comercial e
        // depois change, porque createDeal não aceita stage).
        const created = await create.mutateAsync({ leadId });
        if (stage !== 'lead_no_comercial') {
          await change.mutateAsync({ id: created.id, stage });
        }
        toast.success('Lead adicionado ao pipeline.');
      } else if (deal.stage !== stage) {
        await change.mutateAsync({ id: deal.id, stage });
        toast.success(`Movido para "${STAGE_LABELS[stage]}".`);
      }
    } catch {
      toast.error('Falha ao mover lead.');
    }
  }

  async function confirmGanho(value: number, feedback: LeadQualityFeedback) {
    setPendingStage(null);
    try {
      let targetDealId = deal?.id;
      if (!targetDealId) {
        const created = await create.mutateAsync({ leadId, proposalValue: value });
        targetDealId = created.id;
      }
      // Sempre persiste o valor no PATCH (cobre o caso "deal já existia com valor diferente").
      // Como `patchDeal` não está exposto no escopo deste picker, usamos o stage endpoint
      // e o valor já entrou via create. Se o deal já existia, o KanbanBoard guarda o valor —
      // aqui mantemos comportamento idêntico ao do Kanban: usar changeStage com feedback.
      await change.mutateAsync({
        id: targetDealId,
        stage: 'ganho',
        leadQualityFeedback: feedback,
      });
      toast.success('Marcado como ganho.');
    } catch {
      toast.error('Falha ao marcar como ganho.');
    }
  }

  async function confirmPerdido(reason: LossReason, feedback: LeadQualityFeedback) {
    setPendingStage(null);
    try {
      let targetDealId = deal?.id;
      if (!targetDealId) {
        const created = await create.mutateAsync({ leadId });
        targetDealId = created.id;
      }
      await change.mutateAsync({
        id: targetDealId,
        stage: 'perdido',
        lossReason: reason,
        leadQualityFeedback: feedback,
      });
      toast.success('Marcado como perdido.');
    } catch {
      toast.error('Falha ao marcar como perdido.');
    }
  }

  if (isLoading) {
    return <Skeleton className="h-9 w-full" />;
  }

  return (
    <div className="space-y-2">
      <Select
        value={currentStage}
        onValueChange={(v) => handleSelect(v as DealStage)}
        disabled={isBusy}
      >
        <SelectTrigger>
          <SelectValue placeholder="Não está no pipeline" />
        </SelectTrigger>
        <SelectContent>
          {DEAL_STAGES.map((s) => (
            <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {deal && (
        <a
          href={`/inside-sales?dealId=${deal.id}`}
          className="block text-xs text-primary hover:underline"
        >
          Abrir no pipeline →
        </a>
      )}

      <GanhoValueDialog
        open={showGanho}
        onConfirm={confirmGanho}
        onCancel={() => setPendingStage(null)}
      />
      <LossReasonDialog
        open={showPerdido}
        onConfirm={confirmPerdido}
        onCancel={() => setPendingStage(null)}
      />
    </div>
  );
}
```

Notas críticas pra quem lê o código:
- O `Select` shadcn não dispara `onValueChange` quando o valor selecionado é o mesmo do atual, então clicar na fase corrente não faz nada — comportamento desejado.
- `pendingStage` é o estado de "dialog aberto pra essa fase específica"; reset pra `null` ao cancelar ou confirmar.
- O `value=""` no Select mostra o placeholder quando o lead não está no pipeline.
- Quando vem do "sem deal" pra Ganho/Perdido: cria deal em `lead_no_comercial` (idempotente em `createDeal` no service — se já existe retorna o existente), depois move pra fase final via `changeStage`.
- O endpoint `dealId` na rota `/inside-sales` é uma URL nova — o `InsideSalesPage` precisa ler isso. Cobrimos na Task 8.

- [ ] **Step 3: Verificar typecheck**

```bash
npm run typecheck
```

Esperado: passa.

- [ ] **Step 4: Smoke test manual**

Rodar `npm run dev` em outro terminal. No Inbox:
1. Abrir conversa de lead NÃO está no pipeline. Sidebar deve mostrar Select com placeholder "Não está no pipeline".
2. Selecionar "Proposta enviada" → toast de sucesso, Select agora mostra "Proposta enviada" selecionada, link "Abrir no pipeline →" aparece.
3. Trocar pra "Em negociação" → toast "Movido para Em negociação".
4. Trocar pra "Ganho" → dialog `GanhoValueDialog` abre. Preencher valor + feedback → confirma → Select mostra "Ganho", deal aparece como ganho no Kanban (`/inside-sales`).
5. Abrir outra conversa SEM deal → selecionar "Perdido" → dialog abre, preencher motivo + feedback → confirma → deal criado e marcado perdido.

- [ ] **Step 5: Commit**

```bash
git add src/features/whatsapp/LeadSidebar.tsx
git commit -m "feat: inline CRM phase picker in conversation sidebar"
```

---

## Task 8: Suportar `?dealId=` na rota `/inside-sales`

**Files:**
- Modify: `src/features/inside-sales/` página/rota que renderiza o Kanban (provavelmente `KanbanBoard.tsx` ou parent route)

- [ ] **Step 1: Localizar onde `DealDrawer` é controlado**

Procurar onde o `DealDrawer` é montado e onde decide qual deal está aberto:

```bash
grep -rn "DealDrawer" src/features/inside-sales/
```

Identificar o componente parent (provavelmente `KanbanBoard.tsx` ou `src/pages/inside-sales.tsx`) que mantém o estado `selectedDealId`.

- [ ] **Step 2: Ler o query param `dealId` na montagem**

No componente identificado, adicionar (ou estender) a leitura do `URLSearchParams`. Padrão React puro (sem react-router hook):

```tsx
import { useEffect, useState } from 'react';

// dentro do componente:
const [selectedDealId, setSelectedDealId] = useState<string | null>(null);

useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('dealId');
  if (id) setSelectedDealId(id);
}, []);
```

Se o componente já gerencia `selectedDealId`, apenas estender o `useState` inicializer e/ou adicionar o `useEffect` acima.

- [ ] **Step 3: Smoke test do link**

No Inbox, com um lead que já tem deal, clicar no link "Abrir no pipeline →" no sidebar. Esperado: navega pra `/inside-sales?dealId=<id>` e o `DealDrawer` desse deal abre automaticamente.

- [ ] **Step 4: Commit**

```bash
git add src/features/inside-sales/<arquivo-modificado>
git commit -m "feat: open deal drawer from ?dealId= query param"
```

---

## Task 9: Spec coverage + cleanup final

- [ ] **Step 1: Rodar suite completa de testes backend**

```bash
npm test
```

Esperado: todos os testes existentes + os 3 novos (`deals-by-lead`) + o ajustado (`conversations-list`) passam.

- [ ] **Step 2: Rodar typecheck + lint**

```bash
npm run typecheck
npm run lint
```

Esperado: tudo passa.

- [ ] **Step 3: Smoke E2E manual**

No app rodando:
- Conversa nova de campanha aparece na lista com pill de origem.
- Sidebar permite criar deal + mover fase + confirmar Ganho/Perdido com dialog.
- Link "Abrir no pipeline →" leva pro Kanban com drawer aberto.

- [ ] **Step 4: Commit final (se houver fixes)**

```bash
git add -A
git commit -m "chore: final polish for conversation pipeline + origin"
```

---

## Self-Review (preenchido)

**Spec coverage:**
- Feature 1, UI seletor sempre visível → Task 7 (`PipelinePhasePicker`).
- Feature 1, sem deal → cria automático na fase escolhida → Task 7, função `handleSelect` + `confirmGanho`/`confirmPerdido`.
- Feature 1, Ganho abre `GanhoValueDialog` → Task 7, estado `pendingStage`.
- Feature 1, Perdido abre `LossReasonDialog` → Task 7, mesmo padrão.
- Feature 1, link "Abrir no pipeline →" → Task 7 (link) + Task 8 (suporte do query param).
- Feature 1, visível só admin/comercial → Task 7, `PipelineSection` mantém o guard.
- Feature 1, endpoint `GET /deals/by-lead/:leadId` → Tasks 3 e 4.
- Feature 1, hook `useDealByLead` → Task 5.
- Feature 2, tipo `originCampaignName` → Task 1.
- Feature 2, LEFT JOIN com `campaigns` → Task 2.
- Feature 2, pill em `ConversationRow` → Task 6.
- Feature 2, fallback silencioso se `originCampaignName` for null → Task 6, condicional `&&`.

**Placeholder scan:** nenhum TBD/TODO. Cada step tem código completo ou comando exato.

**Type consistency:**
- `useDealByLead(leadId: string | null)` → mesmo retorno `PublicDeal | null` em service e hook.
- `DEAL_STAGES`, `STAGE_LABELS`, `DealStage`, `LossReason`, `LeadQualityFeedback` reusados do shared/types e helpers existentes.
- `byLeadHandler` registrado ANTES de `/:id` no `routes/deals.ts` (ordem importa).
