import { db } from '../db/client';
import { deals, dealActivities, leads, users, conversations, campaigns, campaignRecipients } from '../db/schema';
import {
  eq, and, or, ilike, desc, sql, inArray, gte, lte, isNull,
  type SQL,
} from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type {
  PublicDeal,
  PublicDealActivity,
  BoardResponse,
  DealStage,
  DealStageTotal,
  LossReason,
  LeadQualityFeedback,
  PublicLead,
} from '@shared/types';
import { DEAL_STAGES } from '@shared/types';
import { resolveQualificationCampaign } from './dealCampaign';

const HISTORY_PAGE_SIZE = 50;
const STALE_DAYS = 3;
const KANBAN_TERMINAL_VISIBLE_DAYS = 7;

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

interface RawDealRow {
  deal: typeof deals.$inferSelect;
  lead: typeof leads.$inferSelect | null;
  owner: typeof users.$inferSelect | null;
  enteredCurrentStageAt: Date;
  isStale: boolean;
  aiSummary: string | null;
  campaigns: Array<{ id: string; name: string; sentAt: string }>;
  cardCampaign: { id: string; name: string } | null;
}

function toPublic(row: RawDealRow): PublicDeal {
  const lead = row.lead!;
  return {
    id: row.deal.id,
    lead: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      cnpj: lead.cnpj,
      status: lead.status,
    },
    stage: row.deal.stage,
    proposalValue: row.deal.proposalValue == null ? null : Number(row.deal.proposalValue),
    lossReason: row.deal.lossReason,
    notes: row.deal.notes,
    owner: row.owner ? { id: row.owner.id, name: row.owner.name } : null,
    closedAt: row.deal.closedAt?.toISOString() ?? null,
    leadQualityFeedback: row.deal.leadQualityFeedback ?? null,
    leadQualityFeedbackAt: row.deal.leadQualityFeedbackAt?.toISOString() ?? null,
    isStale: Boolean(row.isStale),
    enteredCurrentStageAt: new Date(row.enteredCurrentStageAt).toISOString(),
    aiSummary: row.aiSummary,
    campaigns: row.campaigns ?? [],
    campaignId: row.cardCampaign?.id ?? null,
    campaignName: row.cardCampaign?.name ?? null,
    createdAt: row.deal.createdAt.toISOString(),
    updatedAt: row.deal.updatedAt.toISOString(),
  };
}

// Resumo das campanhas em que o lead do deal aparece como recipient com
// sent_at preenchido. Mesma forma usada em leadsService.ts.
//
// IMPORTANTE: Drizzle renderiza ${deals.leadId} dentro deste subquery de
// projeção JSON como "lead_id" sem qualificação, colidindo com cr.lead_id após
// o JOIN — gerando "column reference is ambiguous". Usamos sql.raw com o nome
// qualificado ("deals.lead_id") pra forçar a referencia certa. No EXISTS do
// filtro (contexto WHERE) ${deals.leadId} funciona normalmente.
const campaignsSql = sql<Array<{ id: string; name: string; sentAt: string }>>`COALESCE(
  (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'sentAt', cr.sent_at)
                   ORDER BY cr.sent_at DESC)
   FROM campaign_recipients cr
   JOIN campaigns c ON c.id = cr.campaign_id
   WHERE cr.lead_id = ${sql.raw('deals.lead_id')} AND cr.sent_at IS NOT NULL),
  '[]'::json
)`;

// Campanha DO CARD (deals.campaign_id, migration 049). sql.raw pelo mesmo
// motivo do campaignsSql: o Drizzle renderizaria a coluna sem qualificar.
const cardCampaignSql = sql<{ id: string; name: string } | null>`(
  SELECT json_build_object('id', ca.id, 'name', ca.name)
  FROM campaigns ca
  WHERE ca.id = ${sql.raw('deals.campaign_id')}
)`;

// Resumo mais recente da IA para o lead do deal (varre conversas do lead e
// pega o handoff_summary mais recente não-vazio). Surface fica no card do
// Inside Sales e na ficha do deal.
const aiSummarySql = sql<string | null>`(
  SELECT c.handoff_summary
  FROM ${conversations} c
  WHERE c.lead_id = ${deals.leadId}
    AND c.handoff_summary IS NOT NULL
    AND c.handoff_summary <> ''
  ORDER BY c.updated_at DESC
  LIMIT 1
)`;

// SQL fragment that resolves to the timestamp the deal entered its current
// stage. Falls back to created_at if no stage_changed/reactivated activity.
const enteredStageSql = sql<Date>`COALESCE(
  (
    SELECT MAX(da.created_at) FROM deal_activities da
    WHERE da.deal_id = ${deals.id}
      AND da.kind IN ('stage_changed', 'reactivated', 'created')
  ),
  ${deals.createdAt}
)`;

// SQL fragment computing isStale: true if no non-note activity in current
// stage for > STALE_DAYS days (and stage is active).
const isStaleSql = sql<boolean>`(
  ${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')
  AND COALESCE(
    (
      SELECT MAX(da.created_at) FROM deal_activities da
      WHERE da.deal_id = ${deals.id}
        AND da.kind != 'note_added'
        AND da.created_at >= COALESCE(
          (
            SELECT MAX(da2.created_at) FROM deal_activities da2
            WHERE da2.deal_id = ${deals.id}
              AND da2.kind IN ('stage_changed', 'reactivated', 'created')
          ),
          ${deals.createdAt}
        )
    ),
    ${deals.createdAt}
  ) < now() - interval '${sql.raw(String(STALE_DAYS))} days'
)`;

// ---------------------------------------------------------------------------
// listBoard — kanban
// ---------------------------------------------------------------------------

export async function listBoard(input: {
  ownerFilter: 'mine' | 'all' | 'unassigned' | string;
  q?: string;
  campaignIds?: string[];
  currentUserId: string;
}): Promise<BoardResponse> {
  const conds: SQL[] = [];

  if (input.ownerFilter === 'mine') {
    conds.push(eq(deals.ownerUserId, input.currentUserId));
  } else if (input.ownerFilter === 'unassigned') {
    conds.push(sql`${deals.ownerUserId} IS NULL`);
  } else if (input.ownerFilter !== 'all') {
    conds.push(eq(deals.ownerUserId, input.ownerFilter));
  }

  // Show: active stages OR (terminal AND closed_at within last 7 days). Perdido
  // por campanha encerrada vai direto pro Histórico: encerrar uma campanha grande
  // não pode inundar a coluna Perdido.
  conds.push(
    sql`(
      ${deals.stage} IN ('lead_no_comercial', 'proposta_enviada', 'em_negociacao')
      OR (
        ${deals.stage} IN ('ganho', 'perdido')
        AND ${deals.closedAt} > now() - interval '${sql.raw(String(KANBAN_TERMINAL_VISIBLE_DAYS))} days'
        AND ${deals.lossReason} IS DISTINCT FROM 'campanha_encerrada'
      )
    )`,
  );

  if (input.q) {
    const escaped = input.q.replace(/[%_\\]/g, '\\$&');
    const pat = `%${escaped}%`;
    const search = or(ilike(leads.name, pat), ilike(leads.phone, pat), ilike(leads.cnpj, pat));
    if (search) conds.push(search);
  }

  // O filtro de campanha fica SEPARADO das demais condições (owner/busca/stage)
  // pra que a lista de opções do dropdown seja calculada ignorando-o — senão,
  // ao selecionar uma campanha, as outras sumiriam do select.
  const campaignFilter = campaignAssociationFilter(input.campaignIds);

  const where = campaignFilter ? and(...conds, campaignFilter) : and(...conds);

  const rows = await db
    .select({
      deal: deals,
      lead: leads,
      owner: users,
      enteredCurrentStageAt: enteredStageSql,
      isStale: isStaleSql,
      aiSummary: aiSummarySql,
      campaigns: campaignsSql,
      cardCampaign: cardCampaignSql,
    })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(users, eq(deals.ownerUserId, users.id))
    .where(where)
    .orderBy(desc(deals.updatedAt));

  // Opções "Campanha do card": campanhas dos cards do escopo atual
  // (owner/busca/stage), SEM aplicar o filtro de campanha.
  const cardCampaigns = await db
    .selectDistinct({ id: campaigns.id, name: campaigns.name })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .innerJoin(campaigns, eq(campaigns.id, deals.campaignId))
    .where(and(...conds))
    .orderBy(campaigns.name);

  // Campanhas que DISPARARAM (recipient enviado) pra algum card do escopo, mas
  // que não são a campanha do card — grupo "Recebeu disparo". Cobre o caso do
  // re-disparo: uma lista nova sobre uma base já contatada não sobrescreve a
  // campanha do card, então nunca apareceria no grupo "Campanha do card". Aqui
  // ela vira selecionável.
  const recipientCampaignsRaw = await db
    .selectDistinct({ id: campaigns.id, name: campaigns.name })
    .from(deals)
    // leftJoin leads: as conds compartilhadas referenciam leads quando há busca (q).
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .innerJoin(
      campaignRecipients,
      and(
        eq(campaignRecipients.leadId, deals.leadId),
        sql`${campaignRecipients.sentAt} IS NOT NULL`,
      ),
    )
    .innerJoin(campaigns, eq(campaigns.id, campaignRecipients.campaignId))
    .where(and(...conds))
    .orderBy(campaigns.name);

  // Exclui as que já são campanha de algum card (o filtro casa card OU disparo,
  // então basta oferecê-las uma vez, no grupo "Campanha do card").
  const cardIds = new Set(cardCampaigns.map((c) => c.id));
  const recipientCampaigns = recipientCampaignsRaw.filter((c) => !cardIds.has(c.id));

  const stages: BoardResponse['stages'] = {
    lead_no_comercial: [],
    proposta_enviada: [],
    em_negociacao: [],
    ganho: [],
    perdido: [],
  };
  const totals: BoardResponse['totals'] = {
    lead_no_comercial: { count: 0, valueSum: 0 },
    proposta_enviada: { count: 0, valueSum: 0 },
    em_negociacao: { count: 0, valueSum: 0 },
    ganho: { count: 0, valueSum: 0 },
    perdido: { count: 0, valueSum: 0 },
  };

  for (const row of rows) {
    const pub = toPublic(row);
    stages[pub.stage].push(pub);
    totals[pub.stage].count += 1;
    totals[pub.stage].valueSum += pub.proposalValue ?? 0;
  }

  return { stages, totals, cardCampaigns, recipientCampaigns };
}

// Filtro por campanha: casa o card DA campanha (deals.campaign_id, o selo do
// card) OU cujo lead recebeu disparo dela (campaign_recipients com sent_at).
// Cobre os grupos "Campanha do card" e "Recebeu disparo". Retorna null quando
// não há filtro. Usado por listBoard e listHistory.
function campaignAssociationFilter(campaignIds: string[] | undefined): SQL | null {
  if (!campaignIds || campaignIds.length === 0) return null;
  const ids = sql.join(campaignIds.map((id) => sql`${id}`), sql`, `);
  return sql`(
    ${deals.campaignId} IN (${ids})
    OR EXISTS (
      SELECT 1 FROM campaign_recipients cr
      WHERE cr.lead_id = ${deals.leadId}
        AND cr.sent_at IS NOT NULL
        AND cr.campaign_id IN (${ids})
    )
  )`;
}

// ---------------------------------------------------------------------------
// listHistory
// ---------------------------------------------------------------------------

export async function listHistory(input: {
  ownerFilter: 'mine' | 'all' | 'unassigned' | string;
  q?: string;
  stage?: 'ganho' | 'perdido';
  lossReason?: LossReason;
  from?: Date;
  to?: Date;
  campaignIds?: string[];
  page?: number;
  currentUserId: string;
}): Promise<{ items: PublicDeal[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, input.page ?? 1);
  const conds: SQL[] = [];

  // Terminais fora da janela do Kanban — e os fechados por campanha encerrada,
  // que nunca passam pelo Kanban.
  conds.push(
    sql`${deals.stage} IN ('ganho', 'perdido') AND (
      ${deals.closedAt} <= now() - interval '${sql.raw(String(KANBAN_TERMINAL_VISIBLE_DAYS))} days'
      OR ${deals.lossReason} = 'campanha_encerrada'
    )`,
  );

  if (input.ownerFilter === 'mine') {
    conds.push(eq(deals.ownerUserId, input.currentUserId));
  } else if (input.ownerFilter === 'unassigned') {
    conds.push(sql`${deals.ownerUserId} IS NULL`);
  } else if (input.ownerFilter !== 'all') {
    conds.push(eq(deals.ownerUserId, input.ownerFilter));
  }
  if (input.stage) conds.push(eq(deals.stage, input.stage));
  if (input.lossReason) conds.push(eq(deals.lossReason, input.lossReason));
  if (input.from) conds.push(gte(deals.closedAt, input.from));
  if (input.to) conds.push(lte(deals.closedAt, input.to));

  if (input.q) {
    const escaped = input.q.replace(/[%_\\]/g, '\\$&');
    const pat = `%${escaped}%`;
    const search = or(ilike(leads.name, pat), ilike(leads.phone, pat), ilike(leads.cnpj, pat));
    if (search) conds.push(search);
  }

  const campaignFilter = campaignAssociationFilter(input.campaignIds);
  if (campaignFilter) conds.push(campaignFilter);

  const where = and(...conds);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .where(where);

  const rows = await db
    .select({
      deal: deals,
      lead: leads,
      owner: users,
      enteredCurrentStageAt: enteredStageSql,
      isStale: isStaleSql,
      aiSummary: aiSummarySql,
      campaigns: campaignsSql,
      cardCampaign: cardCampaignSql,
    })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(users, eq(deals.ownerUserId, users.id))
    .where(where)
    .orderBy(desc(deals.closedAt))
    .limit(HISTORY_PAGE_SIZE)
    .offset((page - 1) * HISTORY_PAGE_SIZE);

  return {
    items: rows.map(toPublic),
    total,
    page,
    pageSize: HISTORY_PAGE_SIZE,
  };
}

// ---------------------------------------------------------------------------
// getDealById
// ---------------------------------------------------------------------------

export async function getDealById(id: string): Promise<PublicDeal & { activities: PublicDealActivity[] }> {
  const [row] = await db
    .select({
      deal: deals,
      lead: leads,
      owner: users,
      enteredCurrentStageAt: enteredStageSql,
      isStale: isStaleSql,
      aiSummary: aiSummarySql,
      campaigns: campaignsSql,
      cardCampaign: cardCampaignSql,
    })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(users, eq(deals.ownerUserId, users.id))
    .where(eq(deals.id, id))
    .limit(1);

  if (!row) throw new HttpError(404, 'Deal not found');

  const acts = await db
    .select({ activity: dealActivities, actor: users })
    .from(dealActivities)
    .leftJoin(users, eq(dealActivities.actorUserId, users.id))
    .where(eq(dealActivities.dealId, id))
    .orderBy(desc(dealActivities.createdAt));

  const activities: PublicDealActivity[] = acts.map((a) => ({
    id: a.activity.id,
    dealId: a.activity.dealId,
    kind: a.activity.kind,
    actor: a.actor ? { id: a.actor.id, name: a.actor.name } : null,
    metadata: (a.activity.metadata as Record<string, unknown>) ?? {},
    createdAt: a.activity.createdAt.toISOString(),
  }));

  return { ...toPublic(row), activities };
}

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
      campaigns: campaignsSql,
      cardCampaign: cardCampaignSql,
    })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(users, eq(deals.ownerUserId, users.id))
    .where(eq(deals.leadId, leadId))
    // Com card por campanha, um lead pode ter mais de um aberto: prefere o
    // ABERTO mais recente; se todos fechados, o FECHADO mais recentemente (não
    // o criado mais recentemente — um card antigo reaberto e fechado de novo
    // tarde é mais atual que um card novo fechado cedo). `false` ordena antes
    // de `true`, então NOT-terminal (false) vem primeiro.
    .orderBy(
      sql`(${deals.stage} IN ('ganho', 'perdido'))`,
      desc(sql`CASE WHEN ${deals.stage} IN ('ganho', 'perdido') THEN ${deals.closedAt} ELSE ${deals.createdAt} END`),
    )
    .limit(1);

  if (!row) return null;
  return toPublic(row);
}

// Cards ABERTOS do lead, mais recente primeiro. A barra lateral da Inbox usa
// pra alternar quando o lead tem card em mais de uma campanha.
export async function listOpenDealsByLead(leadId: string): Promise<PublicDeal[]> {
  const rows = await db
    .select({
      deal: deals,
      lead: leads,
      owner: users,
      enteredCurrentStageAt: enteredStageSql,
      isStale: isStaleSql,
      aiSummary: aiSummarySql,
      campaigns: campaignsSql,
      cardCampaign: cardCampaignSql,
    })
    .from(deals)
    .leftJoin(leads, eq(deals.leadId, leads.id))
    .leftJoin(users, eq(deals.ownerUserId, users.id))
    .where(and(eq(deals.leadId, leadId), sql`${deals.stage} NOT IN ('ganho', 'perdido')`))
    .orderBy(desc(deals.createdAt));
  return rows.map(toPublic);
}

// ---------------------------------------------------------------------------
// Mutations (todas registram activity no log)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logActivity(tx: any, opts: {
  dealId: string;
  kind: import('@shared/types').DealActivityKind;
  actorUserId: string | null;
  metadata?: Record<string, unknown>;
}) {
  await tx.insert(dealActivities).values({
    dealId: opts.dealId,
    kind: opts.kind,
    actorUserId: opts.actorUserId,
    metadata: opts.metadata ?? {},
  });
}

export async function createDeal(input: {
  leadId: string;
  proposalValue?: number | null;
  ownerUserId: string | null;       // aceita null (Pull model)
  source: 'manual' | 'auto_image' | 'ai_qualified';
}): Promise<PublicDeal> {
  const openStage = sql`${deals.stage} NOT IN ('ganho', 'perdido')`;

  // Manual (vendedor): lead com card aberto → devolve o mais recente. Na mão
  // nunca nasce um segundo card; card manual é sempre sem campanha.
  if (input.source === 'manual') {
    const [open] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.leadId, input.leadId), openStage))
      .orderBy(desc(deals.createdAt))
      .limit(1);
    if (open) return getDealById(open.id);
  }

  // Automático (IA, imagem): o card é da campanha do último disparo vigente.
  // Um card aberto por (lead, campanha); "sem campanha" é um balde próprio.
  const campaignId = input.source === 'manual'
    ? null
    : await resolveQualificationCampaign(input.leadId);
  const sameBucket = and(
    eq(deals.leadId, input.leadId),
    campaignId === null ? isNull(deals.campaignId) : eq(deals.campaignId, campaignId),
  );

  const [active] = await db.select({ id: deals.id }).from(deals).where(and(sameBucket, openStage)).limit(1);
  if (active) return getDealById(active.id);

  let initialStage: DealStage = 'lead_no_comercial';
  if (input.source === 'manual') {
    // Recompra: lead que já teve card (todos fechados) é cliente conhecido e
    // entra direto em negociação.
    const [anyDeal] = await db.select({ id: deals.id }).from(deals).where(eq(deals.leadId, input.leadId)).limit(1);
    if (anyDeal) initialStage = 'em_negociacao';
  } else {
    // IA/imagem não reabrem ciclo no MESMO balde: card fechado desta campanha
    // (ou sem campanha) volta como está — evita card fantasma. Balde diferente
    // (campanha nova) abre card novo: é o card por campanha.
    const [closed] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(sameBucket)
      .orderBy(desc(deals.createdAt))
      .limit(1);
    if (closed) return getDealById(closed.id);
  }

  // Captura stage anterior do lead pra audit trail.
  const [leadBefore] = await db
    .select({ flowStage: leads.flowStage })
    .from(leads)
    .where(eq(leads.id, input.leadId))
    .limit(1);

  let dealId: string;
  try {
    dealId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(deals)
        .values({
          leadId: input.leadId,
          stage: initialStage,
          proposalValue: input.proposalValue == null ? null : String(input.proposalValue),
          ownerUserId: input.ownerUserId,       // pode ser null agora
          campaignId,
        })
        .returning({ id: deals.id });
      await logActivity(tx, {
        dealId: created.id,
        kind: 'created',
        // Sem actor humano quando source e automatizada (ai_qualified, auto_image)
        actorUserId: input.source === 'manual' ? input.ownerUserId : null,
        metadata: { source: input.source, campaignId },
      });
      // Promove lead pra handed_off quando deal é criado (não regride 'lost').
      await tx
        .update(leads)
        .set({ flowStage: 'handed_off', updatedAt: new Date() })
        .where(and(eq(leads.id, input.leadId), sql`${leads.flowStage} <> 'lost'`));
      return created.id;
    });
  } catch (err) {
    // Duas qualificações simultâneas do mesmo lead na mesma campanha: o índice
    // único barra a segunda — devolve o card que a primeira criou.
    const pgErr = ((err as { cause?: unknown })?.cause ?? err) as { code?: string };
    if (pgErr?.code !== '23505') throw err;
    const [winner] = await db.select({ id: deals.id }).from(deals).where(and(sameBucket, openStage)).limit(1);
    if (!winner) throw err;
    return getDealById(winner.id);
  }

  // Audit trail fora do tx.
  if (leadBefore && leadBefore.flowStage !== 'handed_off' && leadBefore.flowStage !== 'lost') {
    const { recordTransition } = await import('./stageTransitions');
    await recordTransition({
      leadId: input.leadId,
      fromStage: leadBefore.flowStage as PublicLead['flowStage'],
      toStage: 'handed_off',
      source: 'deal_created',
      metadata: { dealId, source: input.source, ownerUserId: input.ownerUserId },
    });
  }

  return getDealById(dealId);
}

export async function updateDeal(input: {
  id: string;
  actorUserId: string;
  proposalValue?: number | null;
  notes?: string | null;
  ownerUserId?: string | null;
}): Promise<PublicDeal> {
  const [current] = await db.select().from(deals).where(eq(deals.id, input.id)).limit(1);
  if (!current) throw new HttpError(404, 'Deal not found');

  await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (input.proposalValue !== undefined) {
      const newVal = input.proposalValue == null ? null : String(input.proposalValue);
      const oldVal = current.proposalValue;
      if (newVal !== oldVal) {
        patch.proposalValue = newVal;
        await logActivity(tx, {
          dealId: input.id,
          kind: 'value_changed',
          actorUserId: input.actorUserId,
          metadata: {
            from: oldVal == null ? null : Number(oldVal),
            to: newVal == null ? null : Number(newVal),
          },
        });
      }
    }

    if (input.notes !== undefined && input.notes !== current.notes) {
      patch.notes = input.notes;
      await logActivity(tx, {
        dealId: input.id,
        kind: 'note_added',
        actorUserId: input.actorUserId,
        metadata: { note: input.notes ?? '' },
      });
    }

    if (input.ownerUserId !== undefined && input.ownerUserId !== current.ownerUserId) {
      patch.ownerUserId = input.ownerUserId;
      await logActivity(tx, {
        dealId: input.id,
        kind: 'owner_changed',
        actorUserId: input.actorUserId,
        metadata: {
          fromUserId: current.ownerUserId,
          toUserId: input.ownerUserId,
        },
      });
    }

    if (Object.keys(patch).length > 1) {
      await tx.update(deals).set(patch).where(eq(deals.id, input.id));
    }
  });

  return getDealById(input.id);
}

/**
 * O card do Inside Sales segue o dono da conversa. Chamado toda vez que a
 * conversa ganha ou troca de dono (pegar, atribuir, primeira resposta, template).
 * Até 28/09/2026 os dois donos eram campos sem ligação: a IA criava o card sem
 * dono, o vendedor assumia a conversa e o card ficava "Sem dono" pra sempre.
 *
 * - Só o card ABERTO do lead; ganho/perdido é histórico e não muda.
 * - O card acompanha quando está sem dono ou com quem era dono da conversa até
 *   agora. Se alguém deu o card a outra pessoa direto no Inside Sales, essa
 *   escolha é respeitada.
 * - Conversa ficando sem dono não chega aqui: o card mantém o dono.
 */
export async function syncDealOwnerWithConversation(input: {
  leadId: string;
  /** Dono da conversa ANTES da mudança (null = não tinha). */
  fromOwnerId: string | null;
  toOwnerId: string;
  actorUserId: string | null;
}): Promise<void> {
  // Com card por campanha o lead pode ter mais de um card aberto: a regra vale
  // pra cada um, independentemente.
  const cards = await db
    .select({ id: deals.id, ownerUserId: deals.ownerUserId })
    .from(deals)
    .where(and(eq(deals.leadId, input.leadId), sql`${deals.stage} NOT IN ('ganho', 'perdido')`));

  for (const card of cards) {
    if (card.ownerUserId === input.toOwnerId) continue;
    if (card.ownerUserId !== null && card.ownerUserId !== input.fromOwnerId) continue;

    await db.transaction(async (tx) => {
      // Compare-and-set: se alguém mudou o dono do card entre a leitura e aqui,
      // não sobrescreve.
      const [updated] = await tx
        .update(deals)
        .set({ ownerUserId: input.toOwnerId, updatedAt: new Date() })
        .where(and(
          eq(deals.id, card.id),
          card.ownerUserId === null ? isNull(deals.ownerUserId) : eq(deals.ownerUserId, card.ownerUserId),
        ))
        .returning({ id: deals.id });
      if (!updated) return;
      await logActivity(tx, {
        dealId: card.id,
        kind: 'owner_changed',
        actorUserId: input.actorUserId,
        metadata: { fromUserId: card.ownerUserId, toUserId: input.toOwnerId, via: 'conversation' },
      });
    });
  }
}

export async function changeStage(input: {
  id: string;
  actorUserId: string;
  stage: DealStage;
  lossReason?: LossReason;
  leadQualityFeedback?: LeadQualityFeedback;
}): Promise<PublicDeal> {
  const [current] = await db.select().from(deals).where(eq(deals.id, input.id)).limit(1);
  if (!current) throw new HttpError(404, 'Deal not found');

  if (input.stage === 'perdido' && !input.lossReason) {
    throw new HttpError(400, 'lossReason is required when moving to perdido');
  }
  if (input.stage === 'ganho' && current.proposalValue == null) {
    throw new HttpError(400, 'proposalValue is required before marking as ganho');
  }
  // NOVO: feedback obrigatório ao mover pra ganho/perdido
  if ((input.stage === 'ganho' || input.stage === 'perdido') && !input.leadQualityFeedback) {
    throw new HttpError(400, 'leadQualityFeedback is required when moving to ganho/perdido');
  }
  if (input.stage === current.stage) {
    return getDealById(input.id);
  }

  const isTerminalNow = current.stage === 'ganho' || current.stage === 'perdido';
  const movingToActive =
    input.stage === 'lead_no_comercial' ||
    input.stage === 'proposta_enviada' ||
    input.stage === 'em_negociacao';
  const reactivating = isTerminalNow && movingToActive;

  // Invariante "1 card ativo por (lead, campanha)": reabrir um card fechado
  // quando já há outro ATIVO da mesma campanha (ou do balde sem campanha)
  // violaria o índice parcial. Barra com erro amigável em vez de 500.
  if (reactivating) {
    const [otherActive] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(
        eq(deals.leadId, current.leadId),
        current.campaignId === null ? isNull(deals.campaignId) : eq(deals.campaignId, current.campaignId),
        sql`${deals.id} <> ${input.id}`,
        sql`${deals.stage} NOT IN ('ganho', 'perdido')`,
      ))
      .limit(1);
    if (otherActive) {
      throw new HttpError(409, 'Este lead já tem um negócio ativo desta campanha. Use o card ativo ou feche-o antes de reabrir este.');
    }
  }

  await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = {
      stage: input.stage,
      updatedAt: new Date(),
    };
    // closed_at: set when entering terminal, clear when leaving terminal
    if (input.stage === 'ganho' || input.stage === 'perdido') {
      patch.closedAt = new Date();
    } else {
      patch.closedAt = null;
    }
    // loss_reason: set when going to perdido, clear otherwise
    patch.lossReason = input.stage === 'perdido' ? input.lossReason : null;

    // NOVO: gravar feedback
    if (input.leadQualityFeedback) {
      patch.leadQualityFeedback = input.leadQualityFeedback;
      patch.leadQualityFeedbackAt = new Date();
      patch.leadQualityFeedbackBy = input.actorUserId;
    }

    await tx.update(deals).set(patch).where(eq(deals.id, input.id));

    if (reactivating) {
      await logActivity(tx, {
        dealId: input.id,
        kind: 'reactivated',
        actorUserId: input.actorUserId,
        metadata: { from: current.stage, to: input.stage },
      });
    } else {
      await logActivity(tx, {
        dealId: input.id,
        kind: 'stage_changed',
        actorUserId: input.actorUserId,
        metadata: { from: current.stage, to: input.stage },
      });
    }

    if (input.stage === 'ganho') {
      await logActivity(tx, {
        dealId: input.id,
        kind: 'won',
        actorUserId: input.actorUserId,
        metadata: { value: Number(current.proposalValue) },
      });
    }
    if (input.stage === 'perdido') {
      await logActivity(tx, {
        dealId: input.id,
        kind: 'lost',
        actorUserId: input.actorUserId,
        metadata: { reason: input.lossReason },
      });
    }

    // NOVO: activity de quality_feedback
    if (input.leadQualityFeedback) {
      await logActivity(tx, {
        dealId: input.id,
        kind: 'quality_feedback',
        actorUserId: input.actorUserId,
        metadata: { feedback: input.leadQualityFeedback },
      });
    }
  });

  return getDealById(input.id);
}

export async function deleteDeal(id: string): Promise<void> {
  const [row] = await db.delete(deals).where(eq(deals.id, id)).returning({ id: deals.id });
  if (!row) throw new HttpError(404, 'Deal not found');
}

export async function reactivateDeal(input: {
  dealId: string;
  actorUserId: string;
}): Promise<PublicDeal> {
  const [current] = await db.select().from(deals).where(eq(deals.id, input.dealId)).limit(1);
  if (!current) throw new HttpError(404, 'Deal not found');
  if (current.stage !== 'ganho' && current.stage !== 'perdido') {
    return getDealById(input.dealId);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(deals)
      .set({
        stage: 'proposta_enviada',
        closedAt: null,
        lossReason: null,
        updatedAt: new Date(),
      })
      .where(eq(deals.id, input.dealId));
    await logActivity(tx, {
      dealId: input.dealId,
      kind: 'reactivated',
      actorUserId: input.actorUserId,
      metadata: { from: current.stage, to: 'proposta_enviada' },
    });
  });

  return getDealById(input.dealId);
}
