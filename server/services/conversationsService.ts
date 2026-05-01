import { db } from '../db/client';
import { conversations, messages, leads, users } from '../db/schema';
import { eq, and, or, ilike, desc, sql, isNull, inArray, type SQL } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type {
  PublicConversation,
  ConversationCounts,
  ConversationFilters,
} from '@shared/types';

const PAGE_SIZE = 50;
const NO_RESPONSE_DAYS = Number(process.env.NO_RESPONSE_DAYS ?? '7');

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
    .orderBy(desc(conversations.lastMessageAt))
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
        vehiclePlate: lead.vehiclePlate,
        vehicleModel: lead.vehicleModel,
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
