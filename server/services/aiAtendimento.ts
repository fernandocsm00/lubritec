import { db } from '../db/client';
import { conversations, messages, leads, aiCallLogs } from '../db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { generateReplyDetailed, type GeminiMessage } from './geminiClient';
import { recordAiCall, countRecentErrorsForConversation } from './aiMetrics';
export { recordAiCall } from './aiMetrics';
import { uazapiClient } from './whatsapp/uazapi/client';
import { loadOrgSettingsRow } from './orgSettingsService';
import { recordTransition } from './stageTransitions';
import { emitNotification } from './notifications';
import { notifyVendoresWhatsapp } from './whatsappNotify';
import { isAiBusinessHours } from '../lib/businessHours';
import type { OrgSettings } from '../db/schema';

// Bump esta string a cada mudanca material no system prompt (buildSystemPrompt).
// Permite filtrar metricas de calibracao por versao.
export const PROMPT_VERSION = 'v1-2026-05-26';

const MAX_HISTORY = 20;
const QUALIFY_TAG = '[QUALIFICADO]';
const NOT_QUALIFY_TAG = '[NAO_QUALIFICADO]';
const SUMMARY_OPEN = '[RESUMO]';
const SUMMARY_CLOSE = '[/RESUMO]';

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
    `Quando voce julgar o lead QUALIFICADO, termine sua resposta com:`,
  );
  sections.push(
    `${SUMMARY_OPEN}\n` +
    `Resumo em 2-3 linhas curtas pro vendedor:\n` +
    `- O que o cliente quer / produto de interesse\n` +
    `- Sinais de qualificacao captados (frota, urgencia, decisor, etc., se houver)\n` +
    `- Proximo passo sugerido (ex: enviar orcamento, agendar visita)\n` +
    `${SUMMARY_CLOSE}\n` +
    `${QUALIFY_TAG}`,
  );
  sections.push(
    `O bloco ${SUMMARY_OPEN}...${SUMMARY_CLOSE} e a tag NAO serao mostrados ao cliente — sao usados ` +
    `internamente pra mover a conversa pro time comercial com contexto.`,
  );
  sections.push(
    `Se o lead for claramente fora do perfil ou nao tiver interesse, termine apenas com ${NOT_QUALIFY_TAG} ` +
    `(sem bloco RESUMO).`,
  );
  sections.push('Se ainda nao deu pra decidir, NAO inclua tag nem RESUMO — continue a conversa normalmente.');

  if (leadName || leadPhone) {
    sections.push('', '# CONTEXTO DO LEAD ATUAL');
    if (leadName) sections.push(`Nome do contato: ${leadName}.`);
    if (leadPhone) sections.push(`Telefone: ${leadPhone}.`);
  }

  return sections.join('\n');
}

/**
 * Parse das tags de qualificacao + bloco RESUMO no final da resposta.
 * Retorna a resposta limpa (sem tag/resumo) + decisao + summary opcional.
 *
 * Ordem esperada no fim da resposta:
 *   [RESUMO]
 *   ...texto...
 *   [/RESUMO]
 *   [QUALIFICADO]
 *
 * Se a IA desobedecer (sem bloco RESUMO mas com QUALIFICADO), degrada com
 * summary = null — handoff continua, vendedor recebe notificacao generica.
 */
export function parseQualificationTag(reply: string): {
  cleanReply: string;
  qualification: 'qualified' | 'not_qualified' | null;
  summary: string | null;
} {
  let working = reply.trim();
  let qualification: 'qualified' | 'not_qualified' | null = null;

  if (working.endsWith(QUALIFY_TAG)) {
    qualification = 'qualified';
    working = working.slice(0, -QUALIFY_TAG.length).trim();
  } else if (working.endsWith(NOT_QUALIFY_TAG)) {
    qualification = 'not_qualified';
    working = working.slice(0, -NOT_QUALIFY_TAG.length).trim();
  }

  // Extrai bloco [RESUMO]...[/RESUMO] se presente. Procura no FIM da resposta
  // (depois do strip da tag de qualificacao) pra evitar capturar exemplos no meio.
  let summary: string | null = null;
  const closeIdx = working.lastIndexOf(SUMMARY_CLOSE);
  if (closeIdx !== -1) {
    const openIdx = working.lastIndexOf(SUMMARY_OPEN, closeIdx);
    if (openIdx !== -1 && openIdx < closeIdx) {
      summary = working.slice(openIdx + SUMMARY_OPEN.length, closeIdx).trim();
      working = (working.slice(0, openIdx) + working.slice(closeIdx + SUMMARY_CLOSE.length)).trim();
    }
  }

  return { cleanReply: working, qualification, summary };
}

/**
 * Extrai pares pergunta->resposta do historico recente.
 * Procura por mensagens out (IA) que terminam em '?' seguidas de uma in (lead).
 * Limita a 5 pares (mais que isso e ruido).
 *
 * Implementacao: anexa o inboundText atual ao final da lista e roda um unico
 * loop de pareamento. Evita o bug de adicionar a ultima pergunta duas vezes
 * (uma via loop com a in anterior, outra via tratamento especial do "lastOut").
 */
function extractQuestionsAnswers(
  history: Array<{ direction: 'in' | 'out'; body: string | null }>,
  currentInbound: string,
): Array<{ question: string; answer: string; consideredAt: string }> {
  const pairs: Array<{ question: string; answer: string; consideredAt: string }> = [];
  const now = new Date().toISOString();
  const msgs = [
    ...history.filter((m) => m.body),
    { direction: 'in' as const, body: currentInbound },
  ];
  for (let i = 0; i < msgs.length - 1; i++) {
    const cur = msgs[i];
    const next = msgs[i + 1];
    if (cur.direction === 'out' && cur.body && cur.body.includes('?') && next.direction === 'in' && next.body) {
      pairs.push({
        question: cur.body.trim().slice(0, 500),
        answer: next.body.trim().slice(0, 500),
        consideredAt: now,
      });
    }
  }
  return pairs.slice(-5);
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
    | 'send_error'
    | 'after_hours_queued';
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
    .select({
      id: conversations.id,
      queue: conversations.queue,
      status: conversations.status,
      pendingAiResponse: conversations.pendingAiResponse,
    })
    .from(conversations)
    .where(eq(conversations.id, input.conversationId))
    .limit(1);
  if (!conv || conv.queue !== 'ia') {
    return { status: 'queue_not_ia' };
  }

  // Gate de horario comercial. Pedido de humano (abaixo) tem prioridade sobre
  // o gate — se o cliente quer atendente, transfere sempre, inclusive fora do horario.
  // Se fora do horario, marca conversa como pending e envia mensagem fora-do-horario
  // (se configurada). Worker reprocessa quando expediente abrir.
  const hoursCheck = isAiBusinessHours(new Date(), settings);
  if (!hoursCheck.ok && !detectHumanIntent(input.inboundText)) {
    const afterMsg = settings.aiAfterHoursMsg.trim();
    const alreadyPending = conv.pendingAiResponse === true;
    let sentReply: string | undefined;
    // Se ja esta pending, nao manda aiAfterHoursMsg de novo — evita duplicar
    // quando cliente envia varias mensagens em sequencia fora do horario.
    if (afterMsg && !alreadyPending) {
      try {
        const sendResp = await uazapiClient.sendMessage({
          to: input.phone,
          kind: 'text',
          text: afterMsg,
        });
        await db.insert(messages).values({
          conversationId: input.conversationId,
          direction: 'out',
          kind: 'text',
          body: afterMsg,
          sentByUserId: null,
          providerMsgId: sendResp.messageId,
          provider: 'uazapi',
          rawPayload: { ai: true, afterHours: true, raw: sendResp.rawPayload } as object,
          sentAt: new Date(),
        });
        sentReply = afterMsg;
      } catch (err) {
        console.warn('[ai-after-hours] failed to send afterHoursMsg:', err instanceof Error ? err.message : err);
      }
    }
    if (!alreadyPending) {
      await db
        .update(conversations)
        .set({ pendingAiResponse: true, updatedAt: new Date() })
        .where(eq(conversations.id, input.conversationId));
    }
    return { status: 'after_hours_queued', reply: sentReply };
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

  // Determinar qualification path: primeiro inbound de conversa originada de campanha = campaign_direct
  const isFirstInbound = historyRows.filter((m) => m.direction === 'in').length <= 1;
  const [convFull] = await db.select({ originKind: conversations.originKind, originCampaignId: conversations.originCampaignId })
    .from(conversations)
    .where(eq(conversations.id, input.conversationId))
    .limit(1);
  const qualificationPath: 'campaign_direct' | 'conversation' =
    (isFirstInbound && convFull?.originKind === 'campaign') ? 'campaign_direct' : 'conversation';
  const campaignIdForLog = convFull?.originCampaignId ?? null;

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

    // Fallback: se 3+ erros nessa conversa nos ultimos 30min, IA esta "presa"
    // (rate limit / API key invalida / prompt rejeitado por safety etc).
    // Move pra recepcao humana e notifica admin pra investigacao manual.
    const errCount = await countRecentErrorsForConversation(input.conversationId, 30 * 60 * 1000);
    if (errCount >= 3) {
      await db
        .update(conversations)
        .set({
          queue: 'recepcao',
          status: 'aguardando_atendimento',
          pendingAiResponse: false,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, input.conversationId));

      await emitNotification({
        toRoles: ['admin'],
        kind: 'ai_fallback',
        title: 'IA falhou repetidamente — conversa movida pra Recepção',
        body: `${leadRow?.name ?? input.phone}: ${errCount} erros consecutivos. Último: ${errorMessage.slice(0, 200)}`,
        actionUrl: `/whatsapp?queue=recepcao&statusChips=aguardando,em_atendimento&assignment=all&lead=${input.leadId}`,
        metadata: {
          conversationId: input.conversationId,
          leadId: input.leadId,
          errorCount: errCount,
          lastError: errorMessage,
        },
      });
      console.warn(`[ai-fallback] conv ${input.conversationId}: ${errCount} erros -> movida pra recepcao`);
    }

    return { status: 'gemini_error', errorMessage };
  }
  const rawReply = geminiResult.text;

  const { cleanReply, qualification, summary } = parseQualificationTag(rawReply);
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
      pendingAiResponse: false,
    };

    if (qualification === 'qualified') {
      convPatch.queue = 'comercial';
      convPatch.status = 'aguardando_atendimento';
      convPatch.enteredQueueAt = sentAt;
      convPatch.handoffSummary = summary;
    }

    await tx.update(conversations).set(convPatch).where(eq(conversations.id, input.conversationId));

    if (qualification === 'qualified') {
      // NOTE (Sprint Calibracao IA — B4): flowStage='qualified' eh ESTADO TRANSITORIO.
      // O createDeal logo abaixo desta transacao promove imediatamente pra 'handed_off'.
      // Se voce ve um lead parado em 'qualified' por mais que segundos, o createDeal
      // falhou — investigar via logs. NAO confundir com bug de filtro de dashboard.
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

    // Qualificacao criou flowStage='qualified'. Agora cria deal sem owner (Pull model).
    // Idempotente — se ja existir deal (re-qualificacao), no-op via createDeal interno.
    const { createDeal } = await import('./dealsService');
    await createDeal({
      leadId: input.leadId,
      ownerUserId: null,        // Pull: vendedor puxa do Kanban "Nao atribuido"
      source: 'ai_qualified',
    });

    // Notifica admins/comerciais que tem lead qualificado pra atender.
    const inboxUrl = `/whatsapp?queue=comercial&statusChips=aguardando,em_atendimento&assignment=all&origin=organic,campaign&lead=${input.leadId}`;
    await emitNotification({
      toRoles: ['admin', 'comercial'],
      kind: 'lead_qualified',
      title: 'Lead qualificado pela IA',
      body: summary
        ? `${leadRow?.name ?? input.phone}: ${summary.split('\n')[0]}`
        : `${leadRow?.name ?? input.phone} foi qualificado e enviado pra fila Comercial.`,
      actionUrl: inboxUrl,
      metadata: { leadId: input.leadId, conversationId: input.conversationId },
    });

    // E1: ping no WhatsApp pessoal de cada vendedor (best-effort, nunca quebra fluxo).
    notifyVendoresWhatsapp({
      leadName: leadRow?.name ?? input.phone,
      leadPhone: input.phone,
      summary,
      inboxRelativeUrl: inboxUrl,
    }).catch((err) => {
      console.warn('[ai-handoff] notifyVendoresWhatsapp failed:', err instanceof Error ? err.message : err);
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
    decisionReason: summary,
    qualificationPath,
    questionsAnswers: extractQuestionsAnswers(historyRows, input.inboundText),
    promptVersion: PROMPT_VERSION,
    campaignId: campaignIdForLog,
  });

  // Se IA disse "não qualificado", amostra 10% pra auditoria cega.
  if (qualification === 'not_qualified') {
    const [logRow] = await db.select({ id: aiCallLogs.id })
      .from(aiCallLogs)
      .where(and(
        eq(aiCallLogs.leadId, input.leadId),
        eq(aiCallLogs.conversationId, input.conversationId),
      ))
      .orderBy(desc(aiCallLogs.createdAt))
      .limit(1);
    const { enrollIfSampled } = await import('./auditSampleService');
    await enrollIfSampled({
      leadId: input.leadId,
      campaignId: campaignIdForLog,
      aiCallLogId: logRow?.id ?? null,
    });
  }

  return {
    status: qualification === 'qualified' ? 'qualified_and_replied' : 'replied',
    reply: cleanReply,
  };
}
