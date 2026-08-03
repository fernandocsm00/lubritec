import { db } from '../db/client';
import { users, leads, conversations, messages, messageTemplates, deals, dealActivities, whatsappInstance, campaigns, campaignRecipients, whatsappHsmTemplates } from '../db/schema';
import { hashPassword } from '../lib/hash';
import type { Role, LeadStatus, LeadSource, LeadFlowStage } from '@shared/types';
import type { HsmCategory, HsmStatus, HsmComponent } from '@shared/types';
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
let _cnpjSeq = 0;

// Generate a syntactically valid 14-digit CNPJ for tests. Doesn't compute real
// check digits — tests don't exercise the validator on these seeds, and a
// monotonic sequence is enough to keep CNPJs unique across seedLead calls.
function nextTestCnpj(): string {
  return String(++_cnpjSeq).padStart(14, '0');
}

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
  phone?: string | null;
  cnpj?: string;
  email?: string | null;
  notes?: string | null;
  status?: LeadStatus;
  source?: LeadSource;
  flowStage?: LeadFlowStage;
  uf?: 'RS' | 'BA' | null;
  createdAt?: Date;
}) {
  const phone = opts.phone === null ? null : (opts.phone ?? `5511${String(++_phoneSeq).padStart(8, '0')}`);
  const [l] = await db
    .insert(leads)
    .values({
      name: opts.name ?? 'Lead Test',
      phone,
      cnpj: opts.cnpj ?? nextTestCnpj(),
      email: opts.email ?? null,
      notes: opts.notes ?? null,
      status: opts.status ?? 'frio',
      source: opts.source ?? 'manual',
      flowStage: opts.flowStage ?? (phone ? 'complete' : 'incomplete'),
      uf: opts.uf ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  return l;
}

let _convPhoneSeq = 0;

/**
 * Auto-creates a default whatsapp_instance row if none exists, used as a
 * fallback for createConversation/createMessage helpers.
 *
 * WARNING: tests that assert behavior specific to a particular instance MUST
 * pass `instanceId` explicitly to createConversation/createMessage. Relying on
 * this auto-creation can silently mask missing test setup (e.g., a test that
 * intended to verify cross-instance isolation might still pass because both
 * conversations land in the same auto-created instance).
 */
export async function getOrCreateDefaultInstance(): Promise<string> {
  const existing = await db.query.whatsappInstance.findFirst({
    where: (t, { eq }) => eq(t.isDefault, true),
  });
  if (existing) return existing.id;
  const row = await createWhatsappInstance({ isDefault: true });
  return row.id;
}

export async function createConversation(opts: {
  phone?: string;
  leadId: string;
  instanceId?: string;
  queue?: ConversationQueue;
  status?: ConversationStatus;
  assignedTo?: string | null;
  originKind?: OriginKind;
  originCampaignId?: string | null;
  lastMessageAt?: Date;
  lastInboundAt?: Date | null;
  unreadCount?: number;
  createdAt?: Date;
}) {
  const instanceId = opts.instanceId ?? await getOrCreateDefaultInstance();
  const [c] = await db
    .insert(conversations)
    .values({
      phone: opts.phone ?? `5511${String(++_convPhoneSeq).padStart(8, '0')}`,
      leadId: opts.leadId,
      instanceId,
      queue: opts.queue ?? 'recepcao',
      status: opts.status ?? 'aguardando_atendimento',
      assignedTo: opts.assignedTo ?? null,
      originKind: opts.originKind ?? 'organic',
      originCampaignId: opts.originCampaignId ?? null,
      lastMessageAt: opts.lastMessageAt ?? new Date(),
      lastInboundAt: opts.lastInboundAt ?? null,
      unreadCount: opts.unreadCount ?? 0,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
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
  /** @deprecated use providerMsgId instead */
  uazapiMsgId?: string | null;
  providerMsgId?: string | null;
  provider?: 'uazapi' | 'meta_cloud';
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
      providerMsgId: opts.providerMsgId ?? opts.uazapiMsgId ?? `test-msg-${++_msgIdSeq}-${Date.now()}`,
      provider: opts.provider ?? 'uazapi',
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
  provider?: 'uazapi' | 'meta_cloud';
  displayName?: string;
  isDefault?: boolean;
  isArchived?: boolean;
  phoneNumber?: string | null;
  profileName?: string | null;
  lastStatus?: string | null;
  providerConfig?: Record<string, unknown>;
} = {}) {
  const provider = opts.provider ?? 'uazapi';
  const defaultConfig = provider === 'uazapi'
    ? {
        baseUrl: 'https://api.uazapi.com',
        instanceId: null,
        // Token presente por padrão: o envio via provider (UazapiProvider) usa a
        // config DA instância, então uma linha sem token lançaria antes do mock.
        // Reflete produção (linha conectada tem token). Texto puro: decryptSecret
        // faz passthrough sem a chave. Testes que precisam de "sem token" passam
        // providerConfig explícito.
        instanceToken: 'test-instance-token',
        webhookSecret: null,
        webhookUrl: null,
        webhookSynced: false,
      }
    : {
        wabaId: 'test-waba',
        phoneNumberId: 'test-phone-id',
        accessToken: null,
        appSecret: null,
        webhookVerifyToken: 'test-verify',
      };
  const [row] = await db
    .insert(whatsappInstance)
    .values({
      provider,
      displayName: opts.displayName ?? 'Test Line',
      isDefault: opts.isDefault ?? false,
      isArchived: opts.isArchived ?? false,
      phoneNumber: opts.phoneNumber ?? null,
      profileName: opts.profileName ?? null,
      lastStatus: opts.lastStatus ?? null,
      providerConfig: opts.providerConfig ?? defaultConfig,
    })
    .returning();
  return row;
}

import type { CampaignStatus, CampaignRecipientStatus } from '@shared/types';

export async function createCampaign(opts: {
  name?: string;
  description?: string | null;
  status?: CampaignStatus;
  templateId?: string | null;
  messageBody?: string;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  audienceFilter?: Record<string, unknown>;
  audienceTotal?: number;
  scheduledAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  sentCount?: number;
  failedCount?: number;
  skippedCount?: number;
  ratePerMinute?: number;
  createdByUserId: string;
  instanceId?: string;
  hsmTemplateId?: string | null;
  hsmVariables?: unknown[];
  isContinuous?: boolean;
}) {
  const instanceId = opts.instanceId ?? await getOrCreateDefaultInstance();
  const [c] = await db.insert(campaigns).values({
    name: opts.name ?? 'Campanha Teste',
    description: opts.description ?? null,
    status: opts.status ?? 'draft',
    templateId: opts.templateId ?? null,
    messageBody: opts.messageBody ?? 'Olá {{nome}}!',
    mediaUrl: opts.mediaUrl ?? null,
    mediaMime: opts.mediaMime ?? null,
    audienceFilter: opts.audienceFilter ?? {},
    audienceTotal: opts.audienceTotal ?? 0,
    scheduledAt: opts.scheduledAt ?? null,
    startedAt: opts.startedAt ?? null,
    completedAt: opts.completedAt ?? null,
    sentCount: opts.sentCount ?? 0,
    failedCount: opts.failedCount ?? 0,
    skippedCount: opts.skippedCount ?? 0,
    ratePerMinute: opts.ratePerMinute ?? 20,
    createdByUserId: opts.createdByUserId,
    instanceId,
    hsmTemplateId: opts.hsmTemplateId ?? null,
    hsmVariables: opts.hsmVariables ?? [],
    ...(opts.isContinuous ? { isContinuous: true } : {}),
  }).returning();
  return c;
}

export async function createHsmTemplate(opts: {
  instanceId: string;
  createdBy: string;
  name?: string;
  language?: string;
  category?: HsmCategory;
  status?: HsmStatus;
  components?: HsmComponent[];
  metaTemplateId?: string | null;
  variableCount?: number;
}) {
  const [row] = await db.insert(whatsappHsmTemplates).values({
    instanceId: opts.instanceId,
    createdBy: opts.createdBy,
    name: opts.name ?? `tpl_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    language: opts.language ?? 'pt_BR',
    category: opts.category ?? 'MARKETING',
    status: opts.status ?? 'DRAFT',
    components: opts.components ?? [{ type: 'BODY', text: 'Default body {{1}}' }],
    metaTemplateId: opts.metaTemplateId ?? null,
    variableCount: opts.variableCount ?? 0,
  }).returning();
  return row;
}

export async function createCampaignRecipient(opts: {
  campaignId: string;
  leadId: string;
  phone?: string;
  status?: CampaignRecipientStatus;
  sentAt?: Date | null;
  conversationId?: string | null;
  messageId?: string | null;
  failureReason?: string | null;
}) {
  const [r] = await db.insert(campaignRecipients).values({
    campaignId: opts.campaignId,
    leadId: opts.leadId,
    phone: opts.phone ?? `5511${Date.now()}`.slice(0, 13),
    status: opts.status ?? 'pending',
    sentAt: opts.sentAt ?? null,
    conversationId: opts.conversationId ?? null,
    messageId: opts.messageId ?? null,
    failureReason: opts.failureReason ?? null,
  }).returning();
  return r;
}
