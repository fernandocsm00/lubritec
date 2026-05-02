import { db } from '../db/client';
import { users, leads, conversations, messages, messageTemplates, deals, dealActivities, whatsappInstance } from '../db/schema';
import { hashPassword } from '../lib/hash';
import type { Role, LeadStatus, LeadSource } from '@shared/types';
import type {
  ConversationQueue,
  ConversationStatus,
  MessageDirection,
  MessageKind,
  OriginKind,
} from '@shared/types';
import type {
  DealStage,
  DealActivityKind,
  LossReason,
} from '@shared/types';

let _phoneSeq = 0;

export async function createUser(opts: {
  email?: string;
  name?: string;
  password?: string;
  role?: Role;
  isActive?: boolean;
}) {
  const passwordHash = opts.password ? await hashPassword(opts.password) : null;
  const [u] = await db
    .insert(users)
    .values({
      email: opts.email ?? `user-${Date.now()}@test.com`,
      name: opts.name ?? 'Test User',
      role: opts.role ?? 'comercial',
      isActive: opts.isActive ?? true,
      passwordHash,
    })
    .returning();
  return u;
}

export async function createLead(opts: {
  name?: string;
  phone?: string;
  email?: string | null;
  notes?: string | null;
  vehiclePlate?: string | null;
  vehicleModel?: string | null;
  lastPurchaseDate?: string | null;
  avgMileagePerDay?: number | null;
  status?: LeadStatus;
  source?: LeadSource;
}) {
  const [l] = await db
    .insert(leads)
    .values({
      name: opts.name ?? 'Lead Test',
      phone: opts.phone ?? `5511${String(++_phoneSeq).padStart(8, '0')}`,
      email: opts.email ?? null,
      notes: opts.notes ?? null,
      vehiclePlate: opts.vehiclePlate ?? null,
      vehicleModel: opts.vehicleModel ?? null,
      lastPurchaseDate: opts.lastPurchaseDate ?? null,
      avgMileagePerDay: opts.avgMileagePerDay ?? null,
      status: opts.status ?? 'frio',
      source: opts.source ?? 'manual',
    })
    .returning();
  return l;
}

let _convPhoneSeq = 0;

export async function createConversation(opts: {
  phone?: string;
  leadId: string;
  queue?: ConversationQueue;
  status?: ConversationStatus;
  assignedTo?: string | null;
  originKind?: OriginKind;
  originCampaignId?: string | null;
  lastMessageAt?: Date;
  lastInboundAt?: Date | null;
  unreadCount?: number;
}) {
  const [c] = await db
    .insert(conversations)
    .values({
      phone: opts.phone ?? `5511${String(++_convPhoneSeq).padStart(8, '0')}`,
      leadId: opts.leadId,
      queue: opts.queue ?? 'recepcao',
      status: opts.status ?? 'aguardando_atendimento',
      assignedTo: opts.assignedTo ?? null,
      originKind: opts.originKind ?? 'organic',
      originCampaignId: opts.originCampaignId ?? null,
      lastMessageAt: opts.lastMessageAt ?? new Date(),
      lastInboundAt: opts.lastInboundAt ?? null,
      unreadCount: opts.unreadCount ?? 0,
    })
    .returning();
  return c;
}

let _msgIdSeq = 0;

export async function createMessage(opts: {
  conversationId: string;
  direction?: MessageDirection;
  kind?: MessageKind;
  body?: string | null;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  sentByUserId?: string | null;
  uazapiMsgId?: string | null;
  rawPayload?: unknown;
  sentAt?: Date;
}) {
  const [m] = await db
    .insert(messages)
    .values({
      conversationId: opts.conversationId,
      direction: opts.direction ?? 'in',
      kind: opts.kind ?? 'text',
      body: opts.body ?? 'mensagem de teste',
      mediaUrl: opts.mediaUrl ?? null,
      mediaMime: opts.mediaMime ?? null,
      sentByUserId: opts.sentByUserId ?? null,
      uazapiMsgId: opts.uazapiMsgId ?? `test-msg-${++_msgIdSeq}-${Date.now()}`,
      rawPayload: opts.rawPayload ?? {},
      sentAt: opts.sentAt ?? new Date(),
    })
    .returning();
  return m;
}

export async function createMessageTemplate(opts: {
  title?: string;
  body?: string;
  createdBy: string;
}) {
  const [t] = await db
    .insert(messageTemplates)
    .values({
      title: opts.title ?? 'Template Teste',
      body: opts.body ?? 'Olá, como posso ajudar?',
      createdBy: opts.createdBy,
    })
    .returning();
  return t;
}

export async function createDeal(opts: {
  leadId: string;
  stage?: DealStage;
  proposalValue?: number | null;
  lossReason?: LossReason | null;
  notes?: string | null;
  ownerUserId?: string | null;
  closedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  const [d] = await db
    .insert(deals)
    .values({
      leadId: opts.leadId,
      stage: opts.stage ?? 'proposta_enviada',
      // numeric must be passed as string by drizzle-orm
      proposalValue: opts.proposalValue == null ? null : String(opts.proposalValue),
      lossReason: opts.lossReason ?? null,
      notes: opts.notes ?? null,
      ownerUserId: opts.ownerUserId ?? null,
      closedAt: opts.closedAt ?? null,
      createdAt: opts.createdAt ?? new Date(),
      updatedAt: opts.updatedAt ?? new Date(),
    })
    .returning();
  return d;
}

export async function createDealActivity(opts: {
  dealId: string;
  kind?: DealActivityKind;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}) {
  const [a] = await db
    .insert(dealActivities)
    .values({
      dealId: opts.dealId,
      kind: opts.kind ?? 'created',
      actorUserId: opts.actorUserId ?? null,
      metadata: opts.metadata ?? {},
      createdAt: opts.createdAt ?? new Date(),
    })
    .returning();
  return a;
}

export async function createWhatsappInstance(opts: {
  baseUrl?: string;
  instanceId?: string | null;
  instanceToken?: string | null;
  webhookSecret?: string | null;
  webhookUrl?: string | null;
  webhookSynced?: boolean;
  phoneNumber?: string | null;
  profileName?: string | null;
  lastStatus?: string | null;
} = {}) {
  const [row] = await db
    .insert(whatsappInstance)
    .values({
      baseUrl: opts.baseUrl ?? 'https://api.uazapi.com',
      instanceId: opts.instanceId ?? null,
      instanceToken: opts.instanceToken ?? null,
      webhookSecret: opts.webhookSecret ?? null,
      webhookUrl: opts.webhookUrl ?? null,
      webhookSynced: opts.webhookSynced ?? false,
      phoneNumber: opts.phoneNumber ?? null,
      profileName: opts.profileName ?? null,
      lastStatus: opts.lastStatus ?? null,
    })
    .returning();
  return row;
}
