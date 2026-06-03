import { db } from '../db/client';
import { conversations, messages, leads, orgSettings, whatsappInstance, campaignRecipients } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { InboundMessage } from '../lib/uazapiSchema';
import type { ConversationQueue, LeadFlowStage, MessageKind, ProviderKind } from '@shared/types';
import { recordTransition } from './stageTransitions';
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
  sentAt: Date;
  rawPayload: unknown;
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

  await db.transaction(async (tx) => {
    // 1. Match ou cria lead. Em caso de race (UNIQUE violation), refaz a query.
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
      try {
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
      } catch (err) {
        const pgErr = ((err as { cause?: unknown })?.cause ?? err) as { code?: string };
        if (pgErr?.code === '23505') {
          const retry = await tx.select({ id: leads.id }).from(leads).where(eq(leads.phone, phone)).limit(1);
          if (!retry.length) throw err;
          leadId = retry[0].id;
        } else {
          throw err;
        }
      }
    }

    // 2. Upsert conversation by (instance_id, phone) — fixed from previous bug
    // that matched by phone only, ignoring instance boundaries.
    const existingConv = await tx
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
        })
        .returning({ id: conversations.id });
      conversationId = created.id;
    } else {
      const c = existingConv[0];
      conversationId = c.id;
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
        })
        .where(eq(conversations.id, c.id));
    }

    // 3. Insert message with provider from input (not hardcoded).
    // Body aceita texto inclusive em kinds nao-text — extractInbound usa isso
    // pra repassar label fallback (ex: "🎞️ Figurinha") quando nao da pra
    // renderizar o anexo, evitando bubble vazio no chat.
    await tx.insert(messages).values({
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
    });

    outConversationId = conversationId;
    outLeadId = leadId;
  });

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

  return { status: 'inserted', conversationId: outConversationId, leadId: outLeadId };
}

/**
 * UazAPI wrapper — preserves the existing controller contract. Builds a
 * NormalizedInbound from the UazAPI-typed InboundMessage and delegates to
 * ingestInboundMessage().
 */
export async function ingestInbound(
  m: InboundMessage,
  rawPayload: unknown,
): Promise<{ status: 'inserted' | 'duplicate' | 'ignored'; conversationId?: string; leadId?: string }> {
  const instanceId = await getDefaultInstanceId();
  return ingestInboundMessage({
    instanceId,
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
