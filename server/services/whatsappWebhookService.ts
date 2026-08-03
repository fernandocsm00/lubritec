import { db } from '../db/client';
import { conversations, messages, leads, orgSettings, whatsappInstance, campaignRecipients } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { InboundMessage } from '../lib/uazapiSchema';
import type { ConversationQueue, LeadFlowStage, MessageKind, ProviderKind } from '@shared/types';
import { recordTransition } from './stageTransitions';
import { emitNotification } from './notifications';
import { HttpError } from '../middleware/errorHandler';
import { toCanonicalBrPhone } from '../lib/phoneBR';

// ---------------------------------------------------------------------------
// NormalizedInbound — provider-agnostic inbound message shape.
// Both UazAPI and Meta Cloud webhook handlers normalize to this before calling
// ingestInboundMessage().
// ---------------------------------------------------------------------------
export interface NormalizedInbound {
  instanceId: string;
  provider: ProviderKind;
  leadPhone: string;      // already-normalized digits-only
  leadName?: string;      // optional contact pushName
  kind: MessageKind;
  text?: string;
  mediaUrl?: string;
  mediaMime?: string;
  providerMsgId: string;
  /** providerMsgId da mensagem citada pelo lead ("responder citando"). */
  replyToProviderMsgId?: string | null;
  sentAt: Date;
  rawPayload: unknown;
}

/**
 * Sentinela interno: mensagem duplicada detectada DENTRO da transação (via
 * ON CONFLICT no unique idx_messages_provider_msgid). Lançar aborta o tx
 * inteiro — incluindo o bump de unread_count — e o caller traduz pra
 * { status: 'duplicate' }.
 */
class DuplicateMessageError extends Error {
  constructor() {
    super('duplicate provider_msg_id');
  }
}

function normalizePhone(raw: string): string {
  // Normaliza para a forma canonica BR (com 55 + 9 prefix). Inbound WhatsApp
  // as vezes vem sem o 9 do celular -- sem isso geramos lead/conversation
  // duplicados pro mesmo numero fisico. Ver phoneBR.ts.
  const canonical = toCanonicalBrPhone(raw);
  if (canonical) return canonical;
  // Fallback pra digits-only quando nao parece BR (defensivo).
  return raw.replace(/\D/g, '');
}

async function getDefaultInstanceId(): Promise<string> {
  const [row] = await db.select({ id: whatsappInstance.id }).from(whatsappInstance)
    .where(eq(whatsappInstance.isDefault, true)).limit(1);
  if (!row) throw new HttpError(503, 'No default WhatsApp instance configured');
  return row.id;
}

/**
 * Decide a fila inicial pra uma conversa NOVA, baseado em:
 *   - ai_enabled em org_settings
 *   - existencia de campaign_recipient ('sent') pra este lead
 *
 * Politica de produto (decidida em 2026-05-22): SOMENTE leads vindos de
 * campanha vao pra IA. Leads organicos (cliente chegou sozinho, sem disparo
 * previo) vao direto pra recepcao humana — evita IA respondendo contato
 * antigo VIP, indicacao, suporte tecnico, etc.
 *
 * Override manual continua possivel via "Mover" no ChatHeader.
 */
async function defaultInboundQueueFor(leadId: string): Promise<ConversationQueue> {
  const [s] = await db.select({ aiEnabled: orgSettings.aiEnabled }).from(orgSettings).limit(1);
  if (!s?.aiEnabled) return 'recepcao';
  const [hasCampaign] = await db
    .select({ id: campaignRecipients.id })
    .from(campaignRecipients)
    .where(and(
      eq(campaignRecipients.leadId, leadId),
      eq(campaignRecipients.status, 'sent'),
    ))
    .limit(1);
  return hasCampaign ? 'ia' : 'recepcao';
}

/**
 * Provider-agnostic inbound message pipeline. Both UazAPI and Meta Cloud
 * webhook handlers normalize their payload and call this function.
 *
 * Behavior:
 *   - Idempotent on provider_msg_id — duplicates return early.
 *   - Upserts lead by phone (creates if not found; promotes flow_stage to engaged).
 *   - Upserts conversation by (instance_id, phone).
 *   - Inserts message with provider tagged.
 *   - Returns conversationId + leadId for downstream IA dispatch.
 */
export async function ingestInboundMessage(
  input: NormalizedInbound,
): Promise<{ status: 'inserted' | 'duplicate' | 'ignored'; conversationId?: string; leadId?: string }> {
  // Idempotência por providerMsgId
  const existing = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.providerMsgId, input.providerMsgId))
    .limit(1);
  if (existing.length) return { status: 'duplicate' };

  const phone = input.leadPhone;
  if (phone.length < 8) return { status: 'ignored' };

  const sentAt = input.sentAt;

  // Stages "anteriores" a engaged — recebimento de inbound deve promover daqui pra engaged.
  // Stages mais avançados (qualified, handed_off, lost) são preservados.
  const PROMOTABLE_TO_ENGAGED = new Set(['incomplete', 'complete', 'dispatched']);

  let outConversationId: string | undefined;
  let outLeadId: string | undefined;
  // Captura mudança de stage pra registrar audit trail fora do tx.
  let stageTransition: { from: LeadFlowStage | null; to: LeadFlowStage } | null = null;
  // Notifica só quando a conversa PASSA a ter não-lida (0 → 1), pra não spammar
  // o sino a cada mensagem de uma rajada. null = não notificar.
  let notifyCtx: { assignedTo: string | null; queue: ConversationQueue } | null = null;

  await db.transaction(async (tx) => {
    // 0. Advisory lock transacional por telefone: serializa webhooks simultâneos
    // do MESMO número (ex.: duas mensagens chegando em <100ms). Sem isso, ambos
    // veem "lead não existe" e criam dois leads duplicados — leads.phone NÃO é
    // unique desde a migration 014 (CNPJ é o identificador B2B), então o banco
    // não protege sozinho. O lock é liberado automaticamente no commit/rollback.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${phone}))`);

    // 1. Match ou cria lead (serializado pelo advisory lock acima).
    let leadId: string;
    const found = await tx
      .select({ id: leads.id, name: leads.name, flowStage: leads.flowStage })
      .from(leads)
      .where(eq(leads.phone, phone))
      .limit(1);
    if (found.length) {
      leadId = found[0].id;
      const updates: Partial<typeof leads.$inferInsert> = {};
      // Promove nome auto-gerado pro pushName real (não sobrescreve customizado).
      if (input.leadName && found[0].name === phone) {
        updates.name = input.leadName;
      }
      // Promove stage pra 'engaged' se ainda estiver em estágio anterior.
      if (PROMOTABLE_TO_ENGAGED.has(found[0].flowStage)) {
        updates.flowStage = 'engaged';
        stageTransition = { from: found[0].flowStage as LeadFlowStage, to: 'engaged' };
      }
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        await tx.update(leads).set(updates).where(eq(leads.id, leadId));
      }
    } else {
      const [created] = await tx
        .insert(leads)
        .values({
          name: input.leadName ?? phone,
          phone,
          source: 'whatsapp',
          status: 'frio',
          // Lead novo via inbound: já interagiu por definição.
          flowStage: 'engaged',
        })
        .returning({ id: leads.id });
      leadId = created.id;
      stageTransition = { from: null, to: 'engaged' };
    }

    // 2. Upsert conversation by (instance_id, phone) — fixed from previous bug
    // that matched by phone only, ignoring instance boundaries.
    // AI eligibility: só mensagens de texto disparam IA — usado pra marcar
    // pending_ai_response como "rede de segurança" (se o processo morrer antes
    // da IA responder, o aiPendingWorker reprocessa).
    const aiEligible = input.kind === 'text' && !!input.text;

    let existingConv = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.instanceId, input.instanceId),
          eq(conversations.phone, phone),
        ),
      )
      .limit(1);

    let conversationId: string;
    if (existingConv.length === 0) {
      // Resolvemos a fila inicial AGORA que ja temos o leadId — eh esperado
      // que isso faca uma query extra so quando ai_enabled=true (early return
      // quando IA esta desligada).
      const initialQueue = await defaultInboundQueueFor(leadId);
      // Origin coerente com a fila: se foi pra IA, o cliente esta respondendo
      // a algum disparo passado — marca origin='campaign' tambem.
      const initialOrigin = initialQueue === 'ia' ? 'campaign' : 'organic';
      const [created] = await tx
        .insert(conversations)
        .values({
          phone,
          instanceId: input.instanceId,
          leadId,
          queue: initialQueue,
          status: 'aguardando_atendimento',
          originKind: initialOrigin,
          lastMessageAt: sentAt,
          lastInboundAt: sentAt,
          unreadCount: 1,
          pendingAiResponse: initialQueue === 'ia' && aiEligible,
        })
        .onConflictDoNothing({ target: [conversations.instanceId, conversations.phone] })
        .returning({ id: conversations.id });
      if (created) {
        conversationId = created.id;
        // Conversa nova (sem dono ainda) → sempre "passa a ter não-lida".
        notifyCtx = { assignedTo: null, queue: initialQueue };
      } else {
        // Race: outro webhook criou a conversa entre o select e o insert.
        // Re-seleciona e cai no fluxo de conversa existente abaixo.
        existingConv = await tx
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.instanceId, input.instanceId),
              eq(conversations.phone, phone),
            ),
          )
          .limit(1);
        if (!existingConv.length) {
          throw new Error(`conversation upsert race: (${input.instanceId}, ${phone}) conflicted but not found`);
        }
        conversationId = existingConv[0].id;
      }
    } else {
      conversationId = existingConv[0].id;
    }

    if (existingConv.length > 0) {
      const c = existingConv[0];
      // Só notifica se a conversa estava sem não-lidas (evita 1 sino por msg).
      if (c.unreadCount === 0) {
        notifyCtx = { assignedTo: c.assignedTo, queue: c.queue };
      }
      const newStatus =
        c.status === 'encerrada' ? 'aguardando_atendimento' as const : c.status;
      await tx
        .update(conversations)
        .set({
          status: newStatus,
          lastMessageAt: sentAt,
          lastInboundAt: sentAt,
          unreadCount: sql`${conversations.unreadCount} + 1`,
          updatedAt: new Date(),
          // Rede de segurança da IA: se a conversa está na fila IA e a mensagem
          // é texto, marca pending. processInboundWithAi limpa ao concluir; se o
          // processo cair no meio (delay humanizado, Gemini), o aiPendingWorker
          // reprocessa em até ~3min.
          ...(c.queue === 'ia' && aiEligible ? { pendingAiResponse: true } : {}),
        })
        .where(eq(conversations.id, c.id));
    }

    // 3. Insert message with provider from input (not hardcoded).
    // Body aceita texto inclusive em kinds nao-text — extractInbound usa isso
    // pra repassar label fallback (ex: "🎞️ Figurinha") quando nao da pra
    // renderizar o anexo, evitando bubble vazio no chat.
    // ON CONFLICT DO NOTHING (unique parcial idx_messages_provider_msgid):
    // o check de duplicata no topo é só fast-path FORA do tx — dois webhooks
    // duplicados simultâneos passam por ele juntos. A fonte de verdade é o
    // unique do banco: se não inseriu, aborta o tx (rollback do unread bump).
    // "Responder citando": o lead citou uma mensagem nossa — mapeia o wamid
    // citado pro nosso registro (na mesma conversa) pra renderizar a citação.
    let inboundReplyToId: string | null = null;
    if (input.replyToProviderMsgId) {
      const [rm] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(
          eq(messages.conversationId, conversationId),
          eq(messages.providerMsgId, input.replyToProviderMsgId),
        ))
        .limit(1);
      inboundReplyToId = rm?.id ?? null;
    }

    const [insertedMsg] = await tx.insert(messages).values({
      conversationId,
      direction: 'in',
      kind: input.kind,
      body: input.text ?? null,
      mediaUrl: input.mediaUrl,
      mediaMime: input.mediaMime,
      providerMsgId: input.providerMsgId,
      provider: input.provider,
      rawPayload: input.rawPayload as object,
      sentAt,
      replyToMessageId: inboundReplyToId,
    })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    if (!insertedMsg) throw new DuplicateMessageError();

    outConversationId = conversationId;
    outLeadId = leadId;
  }).catch((err) => {
    if (err instanceof DuplicateMessageError) return;
    throw err;
  });
  if (!outConversationId) return { status: 'duplicate' };

  // Audit trail fora do tx (best-effort).
  const st = stageTransition as { from: LeadFlowStage | null; to: LeadFlowStage } | null;
  if (outLeadId && st) {
    await recordTransition({
      leadId: outLeadId,
      fromStage: st.from,
      toStage: st.to,
      source: st.from === null ? 'create' : 'webhook_inbound',
      metadata: { conversationId: outConversationId, messageId: input.providerMsgId },
    });
  }

  // Notificação "nova mensagem" (best-effort, fora do tx). Só quando a conversa
  // passou a ter não-lida. Fila 'ia' não alerta humano (a IA responde sozinha).
  // Cast: o TS não rastreia a atribuição feita dentro do callback do tx (mesmo
  // padrão do stageTransition acima).
  const ctx = notifyCtx as { assignedTo: string | null; queue: ConversationQueue } | null;
  if (ctx && outLeadId && ctx.queue !== 'ia') {
    const [ld] = await db.select({ name: leads.name }).from(leads).where(eq(leads.id, outLeadId)).limit(1);
    const leadName = ld?.name ?? 'Cliente';
    const txt = input.text?.trim();
    const preview = txt
      ? (txt.length > 80 ? `${txt.slice(0, 80)}…` : txt)
      : (MEDIA_PREVIEW[input.kind] ?? '[mídia]');
    const notif = {
      kind: 'new_message' as const,
      title: 'Nova mensagem no WhatsApp',
      body: `${leadName}: ${preview}`,
      actionUrl: `/whatsapp?lead=${outLeadId}`,
      metadata: { conversationId: outConversationId, leadId: outLeadId },
    };
    if (ctx.assignedTo) {
      await emitNotification({ userIds: [ctx.assignedTo], ...notif });
    } else if (ctx.queue === 'recepcao') {
      await emitNotification({ toRoles: ['recepcao', 'admin'], ...notif });
    } else if (ctx.queue === 'comercial') {
      await emitNotification({ toRoles: ['comercial', 'admin'], ...notif });
    }
  }

  return { status: 'inserted', conversationId: outConversationId, leadId: outLeadId };
}

const MEDIA_PREVIEW: Record<string, string> = {
  image: '📷 Imagem',
  audio: '🎤 Áudio',
  video: '🎬 Vídeo',
  document: '📄 Documento',
};

/**
 * UazAPI wrapper — preserves the existing controller contract. Builds a
 * NormalizedInbound from the UazAPI-typed InboundMessage and delegates to
 * ingestInboundMessage().
 */
export async function ingestInbound(
  m: InboundMessage,
  rawPayload: unknown,
  instanceId?: string,
): Promise<{ status: 'inserted' | 'duplicate' | 'ignored'; conversationId?: string; leadId?: string }> {
  // instanceId vem do controller (resolvido pelo token do webhook). Se ausente
  // (ex.: webhook autenticado via env UAZAPI_WEBHOOK_SECRET), cai na padrão.
  const resolvedInstanceId = instanceId ?? await getDefaultInstanceId();
  return ingestInboundMessage({
    instanceId: resolvedInstanceId,
    provider: 'uazapi',
    leadPhone: normalizePhone(m.from),
    leadName: m.contactName ?? undefined,
    kind: m.kind,
    text: m.text ?? undefined,
    mediaUrl: m.mediaUrl ?? undefined,
    mediaMime: m.mediaMime ?? undefined,
    providerMsgId: m.id,
    sentAt: m.timestamp,
    rawPayload,
  });
}
