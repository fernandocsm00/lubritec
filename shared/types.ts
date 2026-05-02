export const ROLES = ['admin', 'comercial', 'recepcao'] as const;
export type Role = (typeof ROLES)[number];

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface LoginResponse {
  accessToken: string;
  user: PublicUser;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  has_password: boolean;
}

export const LEAD_STATUSES = ['frio', 'morno', 'quente'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = ['manual', 'csv', 'whatsapp'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export interface PublicLead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  vehiclePlate: string | null;
  vehicleModel: string | null;
  lastPurchaseDate: string | null;
  avgMileagePerDay: number | null;
  status: LeadStatus;
  source: LeadSource;
  hasDeal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImportReport {
  inserted: number;
  updated: number;
  skipped: number;
  rejected: { line: number; reason: string }[];
}

// ---------------------------------------------------------------------------
// WhatsApp Inbox (sub-projeto 4)
// ---------------------------------------------------------------------------

export const CONVERSATION_QUEUES = ['ia', 'recepcao', 'comercial'] as const;
export type ConversationQueue = (typeof CONVERSATION_QUEUES)[number];

export const CONVERSATION_STATUSES = [
  'aguardando_atendimento',
  'em_atendimento',
  'encerrada',
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ['in', 'out'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_KINDS = [
  'text', 'image', 'audio', 'video', 'document', 'unknown',
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const ORIGIN_KINDS = ['organic', 'campaign'] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

export interface PublicConversation {
  id: string;
  phone: string;
  lead: {
    id: string;
    name: string;
    vehiclePlate: string | null;
    vehicleModel: string | null;
    status: LeadStatus;
  };
  queue: ConversationQueue;
  status: ConversationStatus;
  assignedTo: { id: string; name: string } | null;
  originKind: OriginKind;
  originCampaignId: string | null;
  lastMessagePreview: string;
  lastMessageDirection: MessageDirection | null;
  lastMessageAt: string;
  lastInboundAt: string | null;
  unreadCount: number;
  isExpired24h: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicMessage {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  kind: MessageKind;
  body: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  sentByUser: { id: string; name: string } | null;
  sentAt: string;
}

export interface PublicMessageTemplate {
  id: string;
  title: string;
  body: string;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface ConversationCounts {
  ia: number;
  recepcao: number;
  comercial: number;
}

export interface ConversationFilters {
  queue?: ConversationQueue;
  status?: ConversationStatus[];
  expired24h?: boolean;
  noResponse?: boolean;
  origin?: OriginKind[];
  campaignId?: string;
  assignment?: 'mine' | 'unassigned' | 'all';
  q?: string;
  page?: number;
}

// ---------------------------------------------------------------------------
// Inside Sales (sub-projeto 5)
// ---------------------------------------------------------------------------

export const DEAL_STAGES = [
  'proposta_enviada',
  'em_negociacao',
  'ganho',
  'perdido',
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const LOSS_REASONS = [
  'condicoes_comerciais',
  'preco',
  'sem_retorno',
  'fora_do_perfil',
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

export const DEAL_ACTIVITY_KINDS = [
  'created',
  'stage_changed',
  'value_changed',
  'note_added',
  'won',
  'lost',
  'reactivated',
  'owner_changed',
] as const;
export type DealActivityKind = (typeof DEAL_ACTIVITY_KINDS)[number];

export interface PublicDeal {
  id: string;
  lead: {
    id: string;
    name: string;
    phone: string;
    vehicleModel: string | null;
    vehiclePlate: string | null;
    status: LeadStatus;
  };
  stage: DealStage;
  proposalValue: number | null;
  lossReason: LossReason | null;
  notes: string | null;
  owner: { id: string; name: string } | null;
  closedAt: string | null;
  isStale: boolean;
  enteredCurrentStageAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicDealActivity {
  id: string;
  dealId: string;
  kind: DealActivityKind;
  actor: { id: string; name: string } | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DealStageTotal {
  count: number;
  valueSum: number;
}

export interface BoardResponse {
  stages: Record<DealStage, PublicDeal[]>;
  totals: Record<DealStage, DealStageTotal>;
}

// ---------------------------------------------------------------------------
// WhatsApp Connection (sub-projeto 6)
// ---------------------------------------------------------------------------

export const INSTANCE_STATUSES = [
  'disconnected',
  'pairing',
  'connected',
  'error',
] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

export interface InstanceStatusResponse {
  configured: boolean;
  status: InstanceStatus;
  qrCode: string | null;
  phoneNumber: string | null;
  profileName: string | null;
  webhookSynced: boolean;
  baseUrl: string;
  lastStatusAt: string | null;
}

// ---------------------------------------------------------------------------
// Mass Campaigns (sub-projeto 7)
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUSES = [
  'draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_RECIPIENT_STATUSES = [
  'pending', 'sent', 'failed', 'skipped',
] as const;
export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

export interface AudienceFilters {
  status?: LeadStatus[];
  source?: LeadSource[];
  lastPurchaseDaysAgo?: number;
  excludeLeadIds?: string[];
  phoneCsv?: string[];
}

export interface CampaignDryRunResponse {
  total: number;
  preview: Array<{
    leadId: string;
    name: string;
    phone: string;
    vehicleModel: string | null;
    vehiclePlate: string | null;
    lastPurchaseDate: string | null;
  }>;
}

export interface PublicCampaign {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  templateId: string | null;
  messageBody: string;
  mediaUrl: string | null;
  mediaMime: string | null;
  audienceFilter: AudienceFilters;
  audienceTotal: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  ratePerMinute: number;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface CampaignFunnel {
  totalRecipients: number;
  sent: number;
  failed: number;
  skipped: number;
  replied: number;
  inDeal: number;
  won: number;
  lost: number;
  lostByReason: Record<LossReason, number>;
  totalWonValue: number;
}

export interface PublicCampaignRecipient {
  id: string;
  leadId: string;
  leadName: string;
  phone: string;
  status: CampaignRecipientStatus;
  sentAt: string | null;
  failureReason: string | null;
}
