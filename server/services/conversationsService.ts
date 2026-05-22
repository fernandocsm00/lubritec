import { db } from '../db/client';
import { conversations, messages, leads, users, whatsappInstance } from '../db/schema';
import { eq, and, or, ilike, asc, desc, sql, isNull, lt, inArray, type SQL } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type {
  PublicConversation,
  ConversationCounts,
  ConversationFilters,
  PublicMessage,
  ConversationQueue,
  MessageKind,
} from '@shared/types';

const PAGE_SIZE = 50;
const NO_RESPONSE_DAYS = Number(process.env.NO_RESPONSE_DAYS ?? '7');

async function getDefaultInstanceId(): Promise<string> {
  const [row] = await db.select({ id: whatsappInstance.id }).from(whatsappInstance)
    .where(eq(whatsappInstance.isDefault, true)).limit(1);
  if (!row) throw new HttpError(503, 'No default WhatsApp instance configured');
  return row.id;
}

function previewFromMessage(row: {
  body: string | null;
  kind: string;
} | null): string {
  if (!row) return '';
  if (row.kind !== 'text') {
    const labels: Record<string, string> = {
      image: '[imagem]',
      audio: '[áudio]',
      video: '[vídeo]',
      document: '[documento]',
      unknown: '[mídia]',
    };
    return labels[row.kind] ?? '[mídia]';
  }
  const body = row.body ?? '';
  return body.length > 80 ? `${body.slice(0, 80)}…` : body;
}

function isExpired24h(lastInboundAt: Date | null, status: string): boolean {
  if (status === 'encerrada' || !lastInboundAt) return false;
  return Date.now() - lastInboundAt.getTime() > 24 * 60 * 60 * 1000;
}

interface ListInput extends ConversationFilters {
  currentUserId: string;
}

export async function listConversations(input: ListInput): Promise<{
  items: PublicConversation[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, input.page ?? 1);
  const conds: SQL[] = [];

  if (input.queue) conds.push(eq(conversations.queue, input.queue));
  if (input.status?.length) conds.push(inArray(conversations.status, input.status));
  if (input.expired24h) {
    conds.push(sql`${conversations.status} != 'encerrada'`);
    conds.push(sql`${conversations.lastInboundAt} < now() - interval '24 hours'`);
    conds.push(sql`${conversations.lastInboundAt} IS NOT NULL`);
  }
  if (input.noResponse) {
    conds.push(eq(conversations.originKind, 'campaign'));
    conds.push(isNull(conversations.lastInboundAt));
    conds.push(sql`${conversations.lastMessageAt} < now() - interval '${sql.raw(String(NO_RESPONSE_DAYS))} days'`);
  }
  if (input.onlyWithInbound) {
    // Mostra apenas conversas que receberam ao menos 1 inbound do lead — esconde
    // disparos de campanha sem resposta (que ainda aparecem no relatorio da campanha).
    // Conversas nao-campanha (organic, manual) continuam visiveis mesmo sem inbound.
    conds.push(sql`(${conversations.lastInboundAt} IS NOT NULL OR ${conversations.originKind} != 'campaign')`);
  }
  if (input.origin?.length) conds.push(inArray(conversations.originKind, input.origin));
  if (input.campaignId) conds.push(eq(conversations.originCampaignId, input.campaignId));
  if (input.assignment === 'mine') conds.push(eq(conversations.assignedTo, input.currentUserId));
  if (input.assignment === 'unassigned') conds.push(isNull(conversations.assignedTo));

  if (input.q) {
    const escaped = input.q.replace(/[%_\\]/g, '\\$&');
    const pat = `%${escaped}%`;
    const search = or(ilike(leads.name, pat), ilike(conversations.phone, pat));
    if (search) conds.push(search);
  }

  const where = conds.length ? and(...conds) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(conversations)
    .leftJoin(leads, eq(conversations.leadId, leads.id))
    .where(where);

  const rows = await db
    .select({
      conv: conversations,
      lead: leads,
      assignee: users,
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
    .where(where)
    // Na fila Comercial: FIFO por tempo de espera (entered_queue_at ASC).
    // Conversas sem enteredQueueAt (historico antigo) caem no fim via NULLS LAST.
    // Demais filas: ordem cronologica reversa por ultima mensagem.
    .orderBy(
      input.queue === 'comercial'
        ? sql`${conversations.enteredQueueAt} ASC NULLS LAST`
        : desc(conversations.lastMessageAt),
    )
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const items: PublicConversation[] = rows.map((r) => {
    const lead = r.lead!;
    return {
      id: r.conv.id,
      phone: r.conv.phone,
      lead: {
        id: lead.id,
        name: lead.name,
        cnpj: lead.cnpj,
        status: lead.status,
      },
      queue: r.conv.queue,
      status: r.conv.status,
      assignedTo: r.assignee ? { id: r.assignee.id, name: r.assignee.name } : null,
      originKind: r.conv.originKind,
      originCampaignId: r.conv.originCampaignId,
      lastMessagePreview: previewFromMessage({
        body: r.lastMsgBody,
        kind: r.lastMsgKind ?? 'text',
      }),
      lastMessageDirection: (r.lastMsgDir as 'in' | 'out' | null) ?? null,
      lastMessageAt: r.conv.lastMessageAt.toISOString(),
      lastInboundAt: r.conv.lastInboundAt?.toISOString() ?? null,
      unreadCount: r.conv.unreadCount,
      isExpired24h: isExpired24h(r.conv.lastInboundAt, r.conv.status),
      enteredQueueAt: r.conv.enteredQueueAt?.toISOString() ?? null,
      hasAiHandoff: r.conv.handoffSummary != null && r.conv.handoffSummary.trim().length > 0,
      handoffSummary: r.conv.handoffSummary ?? null,
      createdAt: r.conv.createdAt.toISOString(),
      updatedAt: r.conv.updatedAt.toISOString(),
    };
  });

  return { items, total, page, pageSize: PAGE_SIZE };
}

export async function getConversationCounts(): Promise<ConversationCounts> {
  const rows = await db
    .select({
      queue: conversations.queue,
      total: sql<number>`count(*)::int`,
    })
    .from(conversations)
    .where(sql`${conversations.status} != 'encerrada'`)
    .groupBy(conversations.queue);

  const counts: ConversationCounts = { ia: 0, recepcao: 0, comercial: 0 };
  for (const r of rows) {
    if (r.queue === 'ia' || r.queue === 'recepcao' || r.queue === 'comercial') {
      counts[r.queue] = r.total;
    }
  }
  return counts;
}

export async function getConversationById(
  id: string,
  currentUserId: string,
): Promise<PublicConversation> {
  const result = await listConversations({
    currentUserId,
    page: 1,
    queue: undefined,
  });
  const found = result.items.find((c) => c.id === id);
  if (!found) {
    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    if (!rows.length) throw new HttpError(404, 'Conversation not found');
  }
  if (!found) throw new HttpError(404, 'Conversation not found');
  return found;
}

const MESSAGE_PAGE_SIZE = 50;

export async function listMessages(
  conversationId: string,
  before?: Date,
): Promise<{ items: PublicMessage[]; hasMore: boolean }> {
  // Confirma que a conversa existe
  const conv = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv.length) throw new HttpError(404, 'Conversation not found');

  const conds: SQL[] = [eq(messages.conversationId, conversationId)];
  if (before) conds.push(lt(messages.sentAt, before));

  const rows = await db
    .select({ msg: messages, sender: users })
    .from(messages)
    .leftJoin(users, eq(messages.sentByUserId, users.id))
    .where(and(...conds))
    .orderBy(desc(messages.sentAt))
    .limit(MESSAGE_PAGE_SIZE + 1);

  const hasMore = rows.length > MESSAGE_PAGE_SIZE;
  const items = rows.slice(0, MESSAGE_PAGE_SIZE).map<PublicMessage>((r) => ({
    id: r.msg.id,
    conversationId: r.msg.conversationId,
    direction: r.msg.direction,
    kind: r.msg.kind,
    body: r.msg.body,
    mediaUrl: r.msg.mediaUrl,
    mediaMime: r.msg.mediaMime,
    sentByUser: r.sender ? { id: r.sender.id, name: r.sender.name } : null,
    sentAt: r.msg.sentAt.toISOString(),
  }));

  return { items, hasMore };
}

// ---------------------------------------------------------------------------
// Action helpers
// ---------------------------------------------------------------------------

async function loadAndReturn(
  id: string,
  currentUserId: string,
): Promise<PublicConversation> {
  return getConversationById(id, currentUserId);
}

export async function claimConversation(
  id: string,
  userId: string,
): Promise<PublicConversation> {
  const [updated] = await db
    .update(conversations)
    .set({
      assignedTo: userId,
      status: 'em_atendimento',
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, id))
    .returning({ id: conversations.id });
  if (!updated) throw new HttpError(404, 'Conversation not found');
  return loadAndReturn(id, userId);
}

export async function changeQueue(
  id: string,
  queue: ConversationQueue,
  currentUserId: string,
): Promise<PublicConversation> {
  const [updated] = await db
    .update(conversations)
    .set({ queue, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning({ id: conversations.id });
  if (!updated) throw new HttpError(404, 'Conversation not found');
  return loadAndReturn(id, currentUserId);
}

export async function closeConversation(
  id: string,
  currentUserId: string,
): Promise<PublicConversation> {
  const [updated] = await db
    .update(conversations)
    .set({ status: 'encerrada', updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning({ id: conversations.id });
  if (!updated) throw new HttpError(404, 'Conversation not found');
  return loadAndReturn(id, currentUserId);
}

export async function markRead(
  id: string,
  currentUserId: string,
): Promise<PublicConversation> {
  const [updated] = await db
    .update(conversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(eq(conversations.id, id))
    .returning({ id: conversations.id });
  if (!updated) throw new HttpError(404, 'Conversation not found');
  return loadAndReturn(id, currentUserId);
}

// ---------------------------------------------------------------------------
// Send message
// ---------------------------------------------------------------------------

import { uazapiClient } from './whatsapp/uazapi/client';

export interface SendInput {
  conversationId: string;
  userId: string;
  kind: MessageKind;
  body?: string | null;
  mediaUrl?: string | null;
  mediaMime?: string | null;
}

export async function sendMessage(input: SendInput): Promise<PublicMessage> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, input.conversationId))
    .limit(1);
  if (!conv) throw new HttpError(404, 'Conversation not found');

  // Chama UazAPI primeiro — só persiste se sucesso.
  let uazapiResp;
  try {
    uazapiResp = await uazapiClient.sendMessage({
      to: conv.phone,
      kind: input.kind,
      text: input.body ?? undefined,
      mediaUrl: input.mediaUrl ?? undefined,
      mediaMime: input.mediaMime ?? undefined,
    });
  } catch {
    throw new HttpError(502, 'WhatsApp gateway unavailable');
  }

  const sentAt = new Date();

  const [msg] = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(messages)
      .values({
        conversationId: conv.id,
        direction: 'out',
        kind: input.kind,
        body: input.body ?? null,
        mediaUrl: input.mediaUrl ?? null,
        mediaMime: input.mediaMime ?? null,
        sentByUserId: input.userId,
        providerMsgId: uazapiResp.messageId,
        provider: 'uazapi',
        rawPayload: uazapiResp.rawPayload as object,
        sentAt,
      })
      .returning();

    await tx
      .update(conversations)
      .set({
        lastMessageAt: sentAt,
        assignedTo: conv.assignedTo ?? input.userId,
        status: conv.assignedTo ? conv.status : 'em_atendimento',
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conv.id));

    return [inserted];
  });

  // Pipeline Inside Sales: imagem em conversa Comercial pode criar/reativar deal.
  // Best-effort — falha aqui não derruba o envio.
  try {
    const { maybeAddDealFromConversation } = await import('./pipelineIntegration');
    await maybeAddDealFromConversation({
      conversationId: conv.id,
      messageKind: input.kind,
      userId: input.userId,
    });
  } catch (err) {
    console.warn('[pipeline] maybeAddDealFromConversation failed:', err);
  }

  // Carrega o autor para o retorno público.
  const [sender] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    direction: msg.direction,
    kind: msg.kind,
    body: msg.body,
    mediaUrl: msg.mediaUrl,
    mediaMime: msg.mediaMime,
    sentByUser: sender ? { id: sender.id, name: sender.name } : null,
    sentAt: msg.sentAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Start conversation (cria lead+conversa se preciso, depois envia 1ª mensagem)
// ---------------------------------------------------------------------------

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

export interface StartConversationInput {
  userId: string;
  phone: string;
  name?: string | null;
  kind: MessageKind;
  body?: string | null;
  mediaUrl?: string | null;
  mediaMime?: string | null;
}

export interface StartConversationResult {
  conversation: PublicConversation;
  message: PublicMessage;
}

export async function startConversation(
  input: StartConversationInput,
): Promise<StartConversationResult> {
  const phone = normalizePhone(input.phone);
  // E.164 brasileiro válido: 10 a 15 dígitos. Validação de domínio fica no schema do controller.
  if (phone.length < 10 || phone.length > 15) {
    throw new HttpError(400, 'Telefone inválido');
  }

  // 1. Lead — find ou create (com proteção a race igual ao webhook ingest).
  let leadId: string;
  const foundLead = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.phone, phone))
    .limit(1);
  if (foundLead.length) {
    leadId = foundLead[0].id;
  } else {
    try {
      const [created] = await db
        .insert(leads)
        .values({
          name: input.name?.trim() || phone,
          phone,
          source: 'whatsapp',
          status: 'frio',
        })
        .returning({ id: leads.id });
      leadId = created.id;
    } catch (err) {
      const pgErr = ((err as { cause?: unknown })?.cause ?? err) as { code?: string };
      if (pgErr?.code === '23505') {
        const retry = await db
          .select({ id: leads.id })
          .from(leads)
          .where(eq(leads.phone, phone))
          .limit(1);
        if (!retry.length) throw err;
        leadId = retry[0].id;
      } else {
        throw err;
      }
    }
  }

  // 2. Conversa — find ou create. Sempre cai em recepcao + em_atendimento + atribuída.
  let conversationId: string;
  const foundConv = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.phone, phone))
    .limit(1);
  if (foundConv.length) {
    conversationId = foundConv[0].id;
  } else {
    try {
      const now = new Date();
      const instanceId = await getDefaultInstanceId();
      const [createdConv] = await db
        .insert(conversations)
        .values({
          phone,
          instanceId,
          leadId,
          queue: 'recepcao',
          status: 'em_atendimento',
          assignedTo: input.userId,
          originKind: 'organic',
          lastMessageAt: now,
          unreadCount: 0,
        })
        .returning({ id: conversations.id });
      conversationId = createdConv.id;
    } catch (err) {
      const pgErr = ((err as { cause?: unknown })?.cause ?? err) as { code?: string };
      if (pgErr?.code === '23505') {
        const retry = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.phone, phone))
          .limit(1);
        if (!retry.length) throw err;
        conversationId = retry[0].id;
      } else {
        throw err;
      }
    }
  }

  // 3. Reusa o sendMessage existente — ele já faz auto-claim, pipeline integration, etc.
  const message = await sendMessage({
    conversationId,
    userId: input.userId,
    kind: input.kind,
    body: input.body ?? null,
    mediaUrl: input.mediaUrl ?? null,
    mediaMime: input.mediaMime ?? null,
  });

  const conversation = await getConversationById(conversationId, input.userId);
  return { conversation, message };
}
