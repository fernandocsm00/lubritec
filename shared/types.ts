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
