import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { CampaignFunnel, DealStage, LossReason, PublicCampaign } from '@shared/types';
import { getCampaignById, getCampaignFunnel } from './campaignsService';

/**
 * Relatório de campanha: as MESMAS fases que o funil da tela conta, só que
 * nominais. A tela responde "quantos"; aqui respondemos "quem".
 *
 * A regra que não pode quebrar: a quantidade de linhas de uma fase tem que ser
 * igual ao número do card correspondente. Por isso a classificação abaixo
 * espelha getCampaignFunnelsBatch em vez de reinventar critérios — se um dia o
 * funil mudar, muda aqui junto (o teste de reconciliação avisa).
 *
 * As fases se sobrepõem de propósito: quem ganhou também aparece em
 * "respondidas" e em "enviados", exatamente como nos cards.
 */
export const CAMPAIGN_REPORT_PHASES = [
  'enviados',
  'falhas',
  'pulados',
  'pendentes',
  'respondidas',
  'sem_resposta',
  'em_negociacao',
  'ganho',
  'perdido',
] as const;

export type CampaignReportPhase = (typeof CAMPAIGN_REPORT_PHASES)[number];

/** Uma linha de cliente numa aba. Campos irrelevantes para a fase vêm nulos. */
export interface CampaignReportRow {
  leadId: string;
  leadName: string;
  cnpj: string | null;
  /** Telefone efetivamente usado no disparo; cai no cadastro se não houve envio. */
  phone: string | null;
  city: string | null;
  imbp: string | null;
  segment: string | null;
  sentAt: Date | null;
  failureReason: string | null;
  repliedAt: Date | null;
  dealStage: DealStage | null;
  proposalValue: number | null;
  lossReason: LossReason | null;
}

export interface CampaignReport {
  campaign: PublicCampaign;
  funnel: CampaignFunnel;
  phases: Record<CampaignReportPhase, CampaignReportRow[]>;
}

/** Etapas que o funil soma como "em negociação". */
const IN_DEAL_STAGES: DealStage[] = ['lead_no_comercial', 'proposta_enviada', 'em_negociacao'];

interface RecipientRow extends Record<string, unknown> {
  lead_id: string;
  lead_name: string;
  cnpj: string | null;
  phone: string | null;
  city: string | null;
  imbp: string | null;
  segment: string | null;
  status: string;
  sent_at: Date | null;
  failure_reason: string | null;
  replied_at: Date | null;
}

interface DealRow extends Record<string, unknown> {
  lead_id: string;
  lead_name: string;
  cnpj: string | null;
  phone: string | null;
  city: string | null;
  imbp: string | null;
  segment: string | null;
  sent_at: Date | null;
  stage: DealStage;
  proposal_value: string | null;
  loss_reason: LossReason | null;
}

function emptyPhases(): Record<CampaignReportPhase, CampaignReportRow[]> {
  return Object.fromEntries(
    CAMPAIGN_REPORT_PHASES.map((p) => [p, [] as CampaignReportRow[]]),
  ) as Record<CampaignReportPhase, CampaignReportRow[]>;
}

function toRow(r: RecipientRow): CampaignReportRow {
  return {
    leadId: r.lead_id,
    leadName: r.lead_name,
    cnpj: r.cnpj,
    phone: r.phone,
    city: r.city,
    imbp: r.imbp,
    segment: r.segment,
    sentAt: r.sent_at,
    failureReason: r.failure_reason,
    repliedAt: r.replied_at,
    dealStage: null,
    proposalValue: null,
    lossReason: null,
  };
}

function toDealReportRow(d: DealRow): CampaignReportRow {
  return {
    leadId: d.lead_id,
    leadName: d.lead_name,
    cnpj: d.cnpj,
    phone: d.phone,
    city: d.city,
    imbp: d.imbp,
    segment: d.segment,
    sentAt: d.sent_at,
    failureReason: null,
    repliedAt: null,
    dealStage: d.stage,
    proposalValue: d.proposal_value == null ? null : Number(d.proposal_value),
    lossReason: d.loss_reason,
  };
}

export async function buildCampaignReport(campaignId: string): Promise<CampaignReport> {
  // getCampaignById lança 404 — a validação de existência tem que vir antes de
  // gerar a planilha, senão o usuário baixa um arquivo vazio achando que a
  // campanha não teve destinatário.
  const [campaign, funnel] = await Promise.all([
    getCampaignById(campaignId),
    getCampaignFunnel(campaignId),
  ]);

  // replied_at = primeira mensagem inbound do lead DEPOIS do disparo. Mesmo
  // critério do funil (que só pergunta se existe), mas guardamos a data porque
  // a aba "Respondidas" mostra quando o cliente reagiu.
  const recipients = await db.execute<RecipientRow>(sql`
    SELECT
      cr.lead_id::text            AS lead_id,
      l.name                      AS lead_name,
      l.cnpj                      AS cnpj,
      COALESCE(cr.phone, l.phone) AS phone,
      l.city                      AS city,
      l.imbp                      AS imbp,
      l.segment                   AS segment,
      cr.status                   AS status,
      cr.sent_at                  AS sent_at,
      cr.failure_reason           AS failure_reason,
      (
        SELECT MIN(m.sent_at)
        FROM conversations c
        JOIN messages m ON m.conversation_id = c.id
        WHERE c.lead_id = cr.lead_id
          AND m.direction = 'in'
          AND m.sent_at > cr.sent_at
      ) AS replied_at
    FROM campaign_recipients cr
    JOIN leads l ON l.id = cr.lead_id
    WHERE cr.campaign_id = ${campaignId}::uuid
    ORDER BY l.name, cr.created_at
  `);

  // Negócios do lead, não do destinatário: uma campanha contínua reenfileira o
  // mesmo lead, e sem o DISTINCT o mesmo deal apareceria uma vez por disparo.
  const deals = await db.execute<DealRow>(sql`
    SELECT
      d.lead_id::text  AS lead_id,
      l.name           AS lead_name,
      l.cnpj           AS cnpj,
      l.phone          AS phone,
      l.city           AS city,
      l.imbp           AS imbp,
      l.segment        AS segment,
      d.stage          AS stage,
      d.proposal_value AS proposal_value,
      d.loss_reason    AS loss_reason,
      (
        SELECT MAX(cr.sent_at)
        FROM campaign_recipients cr
        WHERE cr.campaign_id = ${campaignId}::uuid AND cr.lead_id = d.lead_id
      ) AS sent_at
    FROM deals d
    JOIN leads l ON l.id = d.lead_id
    WHERE d.lead_id IN (
      SELECT DISTINCT cr.lead_id FROM campaign_recipients cr
      WHERE cr.campaign_id = ${campaignId}::uuid
    )
    ORDER BY l.name, d.created_at
  `);

  const phases = emptyPhases();

  // Um lead pode ter mais de um destinatário na mesma campanha (contínua). O
  // funil conta leads DISTINTOS em "respondidas", então dedupamos aqui também.
  const seenReplied = new Set<string>();
  const seenSilent = new Set<string>();

  for (const r of recipients.rows as RecipientRow[]) {
    const row = toRow(r);
    if (r.status === 'sent') phases.enviados.push(row);
    if (r.status === 'failed') phases.falhas.push(row);
    if (r.status === 'skipped') phases.pulados.push(row);
    if (r.status === 'pending') phases.pendentes.push(row);

    if (r.status !== 'sent') continue;
    if (r.replied_at) {
      if (!seenReplied.has(r.lead_id)) {
        seenReplied.add(r.lead_id);
        phases.respondidas.push(row);
      }
    } else if (!seenSilent.has(r.lead_id)) {
      seenSilent.add(r.lead_id);
      phases.sem_resposta.push(row);
    }
  }

  // Um lead que respondeu num disparo e ficou calado noutro é "respondida" —
  // a fase é do cliente, não da tentativa.
  phases.sem_resposta = phases.sem_resposta.filter((r) => !seenReplied.has(r.leadId));

  for (const d of deals.rows as DealRow[]) {
    const row = toDealReportRow(d);
    if (IN_DEAL_STAGES.includes(d.stage)) phases.em_negociacao.push(row);
    if (d.stage === 'ganho') phases.ganho.push(row);
    if (d.stage === 'perdido') phases.perdido.push(row);
  }

  return { campaign, funnel, phases };
}
