import { db } from '../db/client';
import { conversations, messages, leads } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { generateReplyDetailed, type GeminiMessage } from './geminiClient';
import { recordAiCall } from './aiMetrics';
import { uazapiClient } from './whatsapp/uazapi/client';
import { loadOrgSettingsRow } from './orgSettingsService';
import { recordTransition } from './stageTransitions';
import { emitNotification } from './notifications';
import type { OrgSettings } from '../db/schema';

const MAX_HISTORY = 20;
const QUALIFY_TAG = '[QUALIFICADO]';
const NOT_QUALIFY_TAG = '[NAO_QUALIFICADO]';

/**
 * Detecta se o cliente quer falar com humano. Porta a heurística do APP_ORION.
 */
export function detectHumanIntent(text: string): boolean {
  const normalized = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const patterns = [
    /\bfalar\s*(com\s*)?(um\s*)?(humano|atendente|pessoa|operador|gente)\b/,
    /\bquero\s*(um\s*)?(humano|atendente|pessoa|operador)\b/,
    /\bpreciso\s*(de\s*)?(um\s*)?(humano|atendente|pessoa|operador)\b/,
    /\bnao\s*quero\s*(falar\s*com\s*)?(ia|robo|bot|maquina|inteligencia artificial)\b/,
    /\bpara\s*de\s*(ia|robo|bot)\b/,
    /\batendimento\s*humano\b/,
    /\bme\s*transfira\b/,
    /\btransferir\s*(para\s*)?(humano|atendente|pessoa)\b/,
    /\bchega\s*de\s*(ia|robo|bot)\b/,
    /\bsair\s*d(a|o)\s*(ia|robo|bot|atendimento automatico)\b/,
    /\bnao\s*quero\s*(conversar|falar)\s*(com\s*)?(robo|ia|bot|maquina)\b/,
  ];
  return patterns.some((p) => p.test(normalized));
}

/**
 * Monta o system prompt da IA a partir do briefing salvo em org_settings.
 * Estrutura inspirada no APP_ORION mas adaptada pra single-tenant Lubritec.
 */
export function buildSystemPrompt(s: OrgSettings, leadName: string | null, leadPhone: string | null): string {
  const sections: string[] = [];

  sections.push('# IDENTIDADE');
  sections.push(`Voce e ${s.aiAgentName}, atendente virtual de IA da empresa ${s.aiBusinessName}.`);

  if (s.aiBusinessDesc.trim() || s.aiProducts.trim()) {
    sections.push('', '# SOBRE A EMPRESA');
    if (s.aiBusinessDesc.trim()) sections.push(s.aiBusinessDesc.trim());
    if (s.aiProducts.trim()) sections.push(`Produtos e servicos: ${s.aiProducts.trim()}`);
    if (s.aiTargetAudience.trim()) sections.push(`Publico-alvo: ${s.aiTargetAudience.trim()}.`);
    if (s.aiBusinessHours.trim()) sections.push(`Horario de atendimento: ${s.aiBusinessHours.trim()}.`);
  }

  sections.push('', '# OBJETIVO');
  sections.push(s.aiObjective.trim() || 'Qualificar o lead e agendar contato com o comercial.');

  sections.push('', '# TOM E COMUNICACAO');
  sections.push(`Tom: ${s.aiTone.trim()}.`);

  sections.push('', '# REGRAS OBRIGATORIAS');
  sections.push('- Responda SEMPRE em portugues do Brasil.');
  sections.push('- Seja direto e objetivo. Mensagens curtas (max 3 paragrafos).');
  sections.push('- Nao invente informacoes que nao estejam no seu contexto. Se nao souber, diga que vai verificar.');
  sections.push('- Nunca mencione que voce e uma IA, automacao, bot, ou detalhes tecnicos internos.');
  if (s.aiDontTalk.trim()) sections.push(`- NAO FALAR sobre: ${s.aiDontTalk.trim()}`);
  if (s.aiAlwaysAsk.trim()) sections.push(`- SEMPRE perguntar (quando ainda nao souber): ${s.aiAlwaysAsk.trim()}`);

  sections.push('', '# QUALIFICACAO DO LEAD');
  sections.push(`Considere o lead QUALIFICADO quando: ${s.aiQualifyWhen.trim()}.`);
  sections.push(
    `Quando voce julgar o lead QUALIFICADO, termine sua resposta com a tag exata ${QUALIFY_TAG} ` +
    `(em uma linha separada no final). Essa tag NAO sera mostrada ao cliente — e usada internamente ` +
    `pra mover a conversa pro time comercial.`,
  );
  sections.push(
    `Se o lead for claramente fora do perfil ou nao tiver interesse, termine com ${NOT_QUALIFY_TAG} (mesmo padrao).`,
  );
  sections.push('Se ainda nao deu pra decidir, NAO inclua nenhuma tag — continue a conversa normalmente.');

  if (leadName || leadPhone) {
    sections.push('', '# CONTEXTO DO LEAD ATUAL');
    if (leadName) sections.push(`Nome do contato: ${leadName}.`);
    if (leadPhone) sections.push(`Telefone: ${leadPhone}.`);
  }

  return sections.join('\n');
}

/**
 * Parse das tags de qualificacao no final da resposta. Retorna a resposta
 * limpa (sem a tag) + decisao.
 */
export function parseQualificationTag(reply: string): {
  cleanReply: string;
  qualification: 'qualified' | 'not_qualified' | null;
} {
  const trimmed = reply.trim();
  if (trimmed.endsWith(QUALIFY_TAG)) {
    return {
      cleanReply: trimmed.slice(0, -QUALIFY_TAG.length).trim(),
      qualification: 'qualified',
    };
  }
  if (trimmed.endsWith(NOT_QUALIFY_TAG)) {
    return {
      cleanReply: trimmed.slice(0, -NOT_QUALIFY_TAG.length).trim(),
      qualification: 'not_qualified',
    };
  }
  return { cleanReply: trimmed, qualification: null };
}

interface ProcessInput {
  conversationId: string;
  leadId: string;
  phone: string;
  inboundText: string;
}

export interface ProcessResult {
  status:
    | 'replied'
    | 'qualified_and_replied'
    | 'transferred_to_human'
    | 'ai_disabled'
    | 'queue_not_ia'
    | 'gemini_error'
    | 'send_error';
  reply?: string;
  errorMessage?: string;
}

/**
 * Pipeline principal da IA de atendimento. Chamado pelo webhook quando chega
 * mensagem inbound.
 *
 * Decisoes:
 *   1. Se ai_enabled=false → no-op (humano atende)
 *   2. Se conversa NAO esta na fila IA → no-op (humano ja assumiu)
 *   3. Se cliente pediu humano → move conversa pra Recepcao + no-op
 *   4. Senao → carrega historico + chama Gemini + envia resposta + persiste
 *      → se Gemini sinalizou QUALIFICADO → move pra Comercial + lead.flowStage=qualified
 */
export async function processInboundWithAi(input: ProcessInput): Promise<ProcessResult> {
  const settings = await loadOrgSettingsRow();
  if (!settings || !settings.aiEnabled) {
    return { status: 'ai_disabled' };
  }

  // Confirma que a conversa ainda esta na fila IA (humano pode ter movido).
  const [conv] = await db
    .select({ id: conversations.id, queue: conversations.queue, status: conversations.status })
    .from(conversations)
    .where(eq(conversations.id, input.conversationId))
    .limit(1);
  if (!conv || conv.queue !== 'ia') {
    return { status: 'queue_not_ia' };
  }

  // Escape humano: detecta "quero falar com atendente" e desliga IA pra essa conversa.
  if (detectHumanIntent(input.inboundText)) {
    await db
      .update(conversations)
      .set({ queue: 'recepcao', status: 'aguardando_atendimento', updatedAt: new Date() })
      .where(eq(conversations.id, input.conversationId));
    // Registra no log mesmo sem chamar Gemini — pra métrica "human intent rate".
    await recordAiCall({
      conversationId: input.conversationId,
      leadId: input.leadId,
      model: 'none',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      qualified: false,
      humanIntent: true,
    });
    return { status: 'transferred_to_human' };
  }

  // Carrega historico (ultimas N mensagens, em ordem cronologica).
  const historyRows = await db
    .select({ direction: messages.direction, body: messages.body, kind: messages.kind })
    .from(messages)
    .where(eq(messages.conversationId, input.conversationId))
    .orderBy(desc(messages.sentAt))
    .limit(MAX_HISTORY + 1); // +1 pra pular a inbound atual ao montar history

  const history: GeminiMessage[] = historyRows
    .reverse()
    .filter((m) => m.kind === 'text' && m.body)
    .filter((m) => !(m.direction === 'in' && m.body === input.inboundText)) // evita duplicar
    .map((m) => ({
      role: m.direction === 'out' ? ('model' as const) : ('user' as const),
      text: m.body!,
    }));

  // Carrega nome do lead pra contexto.
  const [leadRow] = await db
    .select({ name: leads.name, phone: leads.phone })
    .from(leads)
    .where(eq(leads.id, input.leadId))
    .limit(1);

  const systemInstruction = buildSystemPrompt(
    settings,
    leadRow?.name ?? null,
    leadRow?.phone ?? null,
  );

  let geminiResult;
  try {
    geminiResult = await generateReplyDetailed({
      systemInstruction,
      history,
      userMessage: input.inboundText,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await recordAiCall({
      conversationId: input.conversationId,
      leadId: input.leadId,
      model: 'gemini-2.5-flash',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      qualified: false,
      error: errorMessage,
    });
    return { status: 'gemini_error', errorMessage };
  }
  const rawReply = geminiResult.text;

  const { cleanReply, qualification } = parseQualificationTag(rawReply);
  if (!cleanReply) {
    return { status: 'gemini_error', errorMessage: 'reply was empty after stripping tag' };
  }

  // Envia via UazAPI.
  let uazapiResp;
  try {
    uazapiResp = await uazapiClient.sendMessage({
      to: input.phone,
      kind: 'text',
      text: cleanReply,
    });
  } catch (err) {
    return {
      status: 'send_error',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  const sentAt = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      conversationId: input.conversationId,
      direction: 'out',
      kind: 'text',
      body: cleanReply,
      sentByUserId: null, // null = enviado pela IA
      providerMsgId: uazapiResp.messageId,
      provider: 'uazapi',
      rawPayload: { ai: true, qualification, raw: uazapiResp.rawPayload } as object,
      sentAt,
    });

    const convPatch: Partial<typeof conversations.$inferInsert> = {
      lastMessageAt: sentAt,
      updatedAt: new Date(),
    };

    if (qualification === 'qualified') {
      convPatch.queue = 'comercial';
      convPatch.status = 'aguardando_atendimento';
    }

    await tx.update(conversations).set(convPatch).where(eq(conversations.id, input.conversationId));

    if (qualification === 'qualified') {
      await tx
        .update(leads)
        .set({ flowStage: 'qualified', updatedAt: new Date() })
        .where(eq(leads.id, input.leadId));
    }
  });

  // Audit trail + métricas de IA fora do tx.
  if (qualification === 'qualified') {
    await recordTransition({
      leadId: input.leadId,
      fromStage: 'engaged',
      toStage: 'qualified',
      source: 'ai_qualification',
      metadata: { conversationId: input.conversationId },
    });
    // Notifica admins/comerciais que tem lead qualificado pra atender.
    await emitNotification({
      toRoles: ['admin', 'comercial'],
      kind: 'lead_qualified',
      title: 'Lead qualificado pela IA',
      body: `${leadRow?.name ?? input.phone} foi qualificado e enviado pra fila Comercial.`,
      actionUrl: `/whatsapp?queue=comercial&statusChips=aguardando,em_atendimento&assignment=all&origin=organic,campaign&lead=${input.leadId}`,
      metadata: { leadId: input.leadId, conversationId: input.conversationId },
    });
  }
  await recordAiCall({
    conversationId: input.conversationId,
    leadId: input.leadId,
    model: geminiResult.model,
    inputTokens: geminiResult.inputTokens,
    outputTokens: geminiResult.outputTokens,
    latencyMs: geminiResult.latencyMs,
    qualified: qualification === 'qualified',
  });

  return {
    status: qualification === 'qualified' ? 'qualified_and_replied' : 'replied',
    reply: cleanReply,
  };
}
