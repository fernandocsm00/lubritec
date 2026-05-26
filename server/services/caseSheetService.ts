import { db } from '../db/client';
import {
  aiCallLogs, leads, deals, campaigns, conversations, messages,
} from '../db/schema';
import { eq, and, ne, desc, asc } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type {
  PublicCaseSheet, QualificationPath, QuestionAnswer,
  LossReason, DealStage, LeadQualityFeedback,
} from '@shared/types';

// Entradas com este modelo sao stubs gravados pelo requestReanalysis — nao sao
// decisoes reais da IA e devem ser filtradas tanto da ficha quanto das metricas
// pra nao virar "decisao corrente" enganosa.
export const REANALYSIS_STUB_MODEL = 'reanalysis-stub';

export async function getCaseSheet(leadId: string): Promise<PublicCaseSheet> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new HttpError(404, 'Lead not found');

  // Ultima decisao da IA (mais recente). Filtra stubs de reanalise pra
  // nao virar "decisao corrente" do lead.
  const [aiLog] = await db.select().from(aiCallLogs)
    .where(and(
      eq(aiCallLogs.leadId, leadId),
      eq(aiCallLogs.humanIntent, false),
      ne(aiCallLogs.model, REANALYSIS_STUB_MODEL),
    ))
    .orderBy(desc(aiCallLogs.createdAt))
    .limit(1);

  // Conversa de origem (se houver)
  const [conv] = await db.select().from(conversations)
    .where(eq(conversations.leadId, leadId))
    .orderBy(asc(conversations.createdAt))
    .limit(1);

  // Campanha de origem (do aiLog ou da conversa)
  const campaignId = aiLog?.campaignId ?? conv?.originCampaignId ?? null;
  let campaignName: string | null = null;
  let qualificationQuestion: string | null = null;
  let campaignMessageBody: string | null = null;
  if (campaignId) {
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    if (camp) {
      campaignName = camp.name;
      qualificationQuestion = camp.qualificationQuestion;
      campaignMessageBody = camp.messageBody;
    }
  }

  // Primeira resposta inbound do lead (se houver conversa)
  let firstInboundReply: string | null = null;
  if (conv) {
    const [firstIn] = await db.select({ body: messages.body }).from(messages)
      .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, 'in')))
      .orderBy(asc(messages.sentAt))
      .limit(1);
    firstInboundReply = firstIn?.body ?? null;
  }

  // Deal (se houver)
  const [deal] = await db.select().from(deals).where(eq(deals.leadId, leadId)).limit(1);

  return {
    leadId,
    leadName: lead.name,
    aiCallLogId: aiLog?.id ?? null,
    qualified: aiLog?.qualified ?? null,
    qualificationPath: (aiLog?.qualificationPath ?? null) as QualificationPath | null,
    decisionReason: aiLog?.decisionReason ?? null,
    questionsAnswers: (aiLog?.questionsAnswers as QuestionAnswer[] | null) ?? [],
    promptVersion: aiLog?.promptVersion ?? null,
    decidedAt: aiLog?.createdAt?.toISOString() ?? null,
    model: aiLog?.model ?? null,
    campaignId,
    campaignName,
    qualificationQuestion,
    campaignMessageBody,
    firstInboundReply,
    dealId: deal?.id ?? null,
    dealStage: (deal?.stage as DealStage | null) ?? null,
    dealValue: deal?.proposalValue == null ? null : Number(deal.proposalValue),
    dealLossReason: (deal?.lossReason as LossReason | null) ?? null,
    leadQualityFeedback: (deal?.leadQualityFeedback as LeadQualityFeedback | null) ?? null,
    leadQualityFeedbackAt: deal?.leadQualityFeedbackAt?.toISOString() ?? null,
    closedNoDealAt: lead.closedNoDealAt?.toISOString() ?? null,
    closedNoDealReason: lead.closedNoDealReason ?? null,
    closedNoDealQuality: (lead.closedNoDealQuality as LeadQualityFeedback | null) ?? null,
  };
}

/**
 * Reanálise (admin only) — não sobrescreve; cria nova ai_call_log com
 * marcador no decisionReason indicando "Reanálise solicitada por <admin>".
 *
 * MVP: não chama o Gemini de novo — apenas registra a solicitação como log.
 * Versão futura: re-roda o pipeline com o prompt atual.
 */
export async function requestReanalysis(input: {
  leadId: string;
  adminUserId: string;
  reason: string;
}): Promise<void> {
  // No MVP, só registra como uma entrada manual em ai_call_logs marcada com prompt_version='reanalysis-stub'.
  // Futuro: re-roda o pipeline da IA. Por enquanto, expor a entrada como histórico.
  await db.insert(aiCallLogs).values({
    leadId: input.leadId,
    conversationId: null,
    model: REANALYSIS_STUB_MODEL,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    qualified: false,
    humanIntent: false,
    decisionReason: `[REANÁLISE SOLICITADA] ${input.reason}`,
    promptVersion: REANALYSIS_STUB_MODEL,
  });
}
