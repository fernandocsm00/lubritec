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

// UazAPI baixa mídia pela URL — precisa ser absoluta e pública. Uploads
// ficam em /uploads/conversations/<file>; convertemos pra absoluta antes
// de mandar pro provider. Mantemos a relativa no DB pro frontend renderizar
// via reverse proxy local. Preferimos o baseUrl do próprio request (já é
// o host público que o atendente acessou) e caímos pra APP_URL/localhost
// só como último recurso (ex.: chamadas fora de request context).
function toAbsoluteMediaUrl(relativePath: string, appBaseUrl?: string): string {
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }
  const base = appBaseUrl ?? process.env.APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}${relativePath}`;
}

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
  // Remove o prefixo "*Atendente:*\n" do snippet — a UI já mostra "Você: ".
  const body = (row.body ?? '').replace(/^\*[^*\n]+:\*\n/, '');
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
    .where(sql`${conversations.status} != 'encerrada'
      AND (${conversations.lastInboundAt} IS NOT NULL OR ${conversations.originKind} != 'campaign')`)
    .groupBy(conversations.queue);

  const counts: ConversationCounts = { ia: 0, recepcao: 0, comercial: 0 };
  for (const r of rows) {
    if (r.queue === 'ia' || r.queue === 'recepcao' || r.queue === 'comercial') {
      counts[r.queue] = r.total;
    }
  }
  return counts;
}

/**
 * Resolve um leadId para a conversa MAIS RECENTE do lead, ignorando filtros
 * de fila/status. Usado por deep-links (ex: "Abrir conversa" do inside sales)
 * pra encontrar a conversa onde quer que ela esteja.
 *
 * Retorna {id, queue, status} -- payload minimo pra navegacao. O frontend
 * usa pra ajustar URL (queue + statusChips) e auto-selecionar.
 */
export async function getConversationByLeadId(leadId: string): Promise<{
  id: string;
  queue: string;
  status: string;
} | null> {
  const [row] = await db
    .select({
      id: conversations.id,
      queue: conversations.queue,
      status: conversations.status,
    })
    .from(conversations)
    .where(eq(conversations.leadId, leadId))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  return row ?? null;
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
    editedAt: r.msg.editedAt?.toISOString() ?? null,
    deletedAt: r.msg.deletedAt?.toISOString() ?? null,
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

/**
 * Atribui a conversa a um usuario especifico (nao o currentUser). Aceita
 * targetUserId=null pra desatribuir (volta pra "Sem dono" sem fechar).
 *
 * Diferenca pro claimConversation:
 *  - claim eh pra "eu pego" (currentUser).
 *  - assign eh pra "passar pra outra pessoa" (gerente atribuindo, troca de
 *    turno, etc.). Mantem o mesmo efeito colateral: se atribuir a alguem,
 *    status vira em_atendimento; se desatribuir, status volta a
 *    aguardando_atendimento (a menos que esteja encerrada).
 */
export async function assignConversation(
  id: string,
  targetUserId: string | null,
  currentUserId: string,
): Promise<PublicConversation> {
  if (targetUserId) {
    const [target] = await db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    if (!target) throw new HttpError(404, 'Target user not found');
    if (!target.isActive) throw new HttpError(409, 'Target user is inactive');
  }

  const [conv] = await db
    .select({ status: conversations.status })
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  if (!conv) throw new HttpError(404, 'Conversation not found');

  const nextStatus =
    conv.status === 'encerrada'
      ? 'encerrada'
      : targetUserId
        ? 'em_atendimento'
        : 'aguardando_atendimento';

  await db
    .update(conversations)
    .set({
      assignedTo: targetUserId,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, id));

  return loadAndReturn(id, currentUserId);
}

export async function changeQueue(
  id: string,
  queue: ConversationQueue,
  currentUserId: string,
): Promise<PublicConversation> {
  const patch: Partial<typeof conversations.$inferInsert> = {
    queue,
    updatedAt: new Date(),
  };

  // Move manual pra IA com inbound nao respondido: enfileira pro aiPendingWorker.
  // A IA so eh chamada pelo webhook na chegada de nova msg — sem isso, mover uma
  // conversa pra fila IA depois que o cliente ja escreveu deixaria a msg sem
  // resposta ate o cliente mandar outra. Worker processa em <=60s (em horario).
  if (queue === 'ia') {
    const [last] = await db
      .select({ direction: messages.direction })
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(desc(messages.sentAt))
      .limit(1);
    if (last?.direction === 'in') {
      patch.pendingAiResponse = true;
    }
  }

  const [updated] = await db
    .update(conversations)
    .set(patch)
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
  /** Base URL do request (req.protocol + host); usado pra montar a URL
   * absoluta da mídia enviada ao provider quando mediaUrl é relativa. */
  appBaseUrl?: string;
}

export async function sendMessage(input: SendInput): Promise<PublicMessage> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, input.conversationId))
    .limit(1);
  if (!conv) throw new HttpError(404, 'Conversation not found');

  // Carrega autor antes do envio para prefixar o nome do atendente na mensagem.
  // Vários atendentes compartilham o mesmo número — o prefixo deixa o lead
  // saber quem está respondendo (e identificar troca de atendente).
  const [sender] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  const outboundBody = input.body && sender?.name
    ? `*${sender.name}:*\n${input.body}`
    : input.body ?? null;

  // Chama UazAPI primeiro — só persiste se sucesso.
  let uazapiResp;
  try {
    uazapiResp = await uazapiClient.sendMessage({
      to: conv.phone,
      kind: input.kind,
      text: outboundBody ?? undefined,
      mediaUrl: input.mediaUrl ? toAbsoluteMediaUrl(input.mediaUrl, input.appBaseUrl) : undefined,
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
        body: outboundBody,
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
    editedAt: msg.editedAt?.toISOString() ?? null,
    deletedAt: msg.deletedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Edit / delete de mensagem enviada (revoke via UazAPI + soft delete local)
// ---------------------------------------------------------------------------

const EDIT_WINDOW_MS = 15 * 60 * 1000;       // janela do WhatsApp pra edicao
const DELETE_WINDOW_MS = 48 * 60 * 60 * 1000; // janela pra apagar pra todos

async function loadMessageForMutation(messageId: string) {
  const [row] = await db
    .select({ msg: messages })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!row) throw new HttpError(404, 'Message not found');
  return row.msg;
}

async function isAdmin(userId: string): Promise<boolean> {
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.role === 'admin';
}

function ensureMutationPermissions(args: {
  msg: { direction: 'in' | 'out'; sentByUserId: string | null; deletedAt: Date | null; provider: string };
  userId: string;
  userIsAdmin: boolean;
  action: 'edit' | 'delete';
}) {
  const { msg, userId, userIsAdmin, action } = args;
  if (msg.direction !== 'out') {
    throw new HttpError(400, 'Cannot mutate inbound messages');
  }
  if (msg.deletedAt) {
    throw new HttpError(409, 'Message already deleted');
  }
  // Autor pode sempre; admin pode em qualquer msg outbound.
  // sentByUserId pode ser null pra msgs da IA — so admin pode mexer nelas.
  const isAuthor = msg.sentByUserId !== null && msg.sentByUserId === userId;
  if (!isAuthor && !userIsAdmin) {
    throw new HttpError(403, `Sem permissao pra ${action} esta mensagem`);
  }
  if (msg.provider !== 'uazapi') {
    // Meta Cloud nao tem revoke/edit nativo nessa API; bloqueia explicito
    // em vez de fingir que apagou.
    throw new HttpError(501, `${action} nao suportado pro provider ${msg.provider}`);
  }
}

/**
 * Apaga pra todos: chama UazAPI /message/delete (revoke nativo do WhatsApp)
 * e marca deleted_at no banco. Cliente passa a ver "Esta mensagem foi
 * apagada" no WhatsApp dele. Se o provider falhar, NAO marca local — UI
 * fica consistente com o que o cliente esta vendo.
 */
export async function deleteOutboundMessage(messageId: string, userId: string): Promise<PublicMessage> {
  const msg = await loadMessageForMutation(messageId);
  const userIsAdmin = await isAdmin(userId);
  ensureMutationPermissions({ msg, userId, userIsAdmin, action: 'delete' });

  const ageMs = Date.now() - msg.sentAt.getTime();
  if (ageMs > DELETE_WINDOW_MS) {
    throw new HttpError(409, 'Janela de 48h pra apagar pra todos ja expirou');
  }
  if (!msg.providerMsgId) {
    throw new HttpError(409, 'Mensagem sem providerMsgId — nao pode ser revogada no WhatsApp');
  }

  await uazapiClient.deleteMessage(msg.providerMsgId);

  await db
    .update(messages)
    .set({ deletedAt: new Date() })
    .where(eq(messages.id, messageId));

  return loadPublicMessage(messageId);
}

/**
 * Edita o texto: chama UazAPI /message/edit (edit nativo) e atualiza body
 * + edited_at. Snapshot do body anterior em original_body (so na 1a edicao).
 */
export async function editOutboundMessage(
  messageId: string,
  userId: string,
  newText: string,
): Promise<PublicMessage> {
  const trimmed = newText.trim();
  if (!trimmed) throw new HttpError(400, 'Texto vazio');
  if (trimmed.length > 4000) throw new HttpError(400, 'Texto excede 4000 caracteres');

  const msg = await loadMessageForMutation(messageId);
  const userIsAdmin = await isAdmin(userId);
  ensureMutationPermissions({ msg, userId, userIsAdmin, action: 'edit' });

  if (msg.kind !== 'text') {
    throw new HttpError(400, 'So mensagens de texto podem ser editadas');
  }
  const ageMs = Date.now() - msg.sentAt.getTime();
  if (ageMs > EDIT_WINDOW_MS) {
    throw new HttpError(409, 'Janela de 15min pra editar ja expirou');
  }
  if (!msg.providerMsgId) {
    throw new HttpError(409, 'Mensagem sem providerMsgId — nao pode ser editada no WhatsApp');
  }
  if (trimmed === msg.body) {
    // No-op explicito — evita gerar webhook desnecessario.
    return loadPublicMessage(messageId);
  }

  await uazapiClient.editMessage(msg.providerMsgId, trimmed);

  await db
    .update(messages)
    .set({
      body: trimmed,
      editedAt: new Date(),
      // Snapshot apenas na primeira edicao (audit/debug).
      originalBody: msg.originalBody ?? msg.body,
    })
    .where(eq(messages.id, messageId));

  return loadPublicMessage(messageId);
}

async function loadPublicMessage(messageId: string): Promise<PublicMessage> {
  const [row] = await db
    .select({ msg: messages, sender: users })
    .from(messages)
    .leftJoin(users, eq(messages.sentByUserId, users.id))
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!row) throw new HttpError(404, 'Message not found');
  return {
    id: row.msg.id,
    conversationId: row.msg.conversationId,
    direction: row.msg.direction,
    kind: row.msg.kind,
    body: row.msg.body,
    mediaUrl: row.msg.mediaUrl,
    mediaMime: row.msg.mediaMime,
    sentByUser: row.sender ? { id: row.sender.id, name: row.sender.name } : null,
    sentAt: row.msg.sentAt.toISOString(),
    editedAt: row.msg.editedAt?.toISOString() ?? null,
    deletedAt: row.msg.deletedAt?.toISOString() ?? null,
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
  appBaseUrl?: string;
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
    appBaseUrl: input.appBaseUrl,
  });

  const conversation = await getConversationById(conversationId, input.userId);
  return { conversation, message };
}
