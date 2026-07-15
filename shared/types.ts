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
  phone: string | null;
  last_login_at: string | null;
  created_at: string;
  has_password: boolean;
}

export const LEAD_STATUSES = ['frio', 'morno', 'quente'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = ['manual', 'csv', 'whatsapp'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

// ── Taxonomia comercial Lubritec ─────────────────────────────────────────────
// IMBP = "Linha de Negocio do Cliente" (codigo interno).
// Segment = agrupamento de IMBPs. Cada IMBP pertence a exatamente 1 segmento.

export const IMBP_VALUES = [
  '000011-PVL-REVENDA',
  '000012-MCO-REVENDA',
  '000013-CVL-REVENDA',
  '000014-ATACADISTA',
  '000015-CVL-AGRI-REVENDA',
  '000025-CVL-CONSUMO',
  '000026-INDUSTRIA',
  '000028-CVL-AGRI',
] as const;
export type Imbp = (typeof IMBP_VALUES)[number];

export const IMBP_LABELS: Record<Imbp, string> = {
  '000011-PVL-REVENDA':      '000011-PVL-REVENDA — Carros, autopecas, oficinas, postos',
  '000012-MCO-REVENDA':      '000012-MCO-REVENDA — Motos, moto-pecas, oficinas de motos',
  '000013-CVL-REVENDA':      '000013-CVL-REVENDA — Caminhoes, oficinas, concessionarias',
  '000014-ATACADISTA':       '000014-ATACADISTA — Distribuidores, varejo',
  '000015-CVL-AGRI-REVENDA': '000015-CVL-AGRI-REVENDA — Tratores, pesados, cooperativas (revenda)',
  '000025-CVL-CONSUMO':      '000025-CVL-CONSUMO — Frotas, onibus, vans, mineradoras, construtoras',
  '000026-INDUSTRIA':        '000026-INDUSTRIA — Maquinas industriais',
  '000028-CVL-AGRI':         '000028-CVL-AGRI — Maquinarios agricolas (consumidor final)',
};

export const SEGMENT_VALUES = ['PVL', 'CVL', 'MCO', 'IND', 'ATA'] as const;
export type Segment = (typeof SEGMENT_VALUES)[number];

export const SEGMENT_LABELS: Record<Segment, string> = {
  PVL: 'PVL — Veiculos Automotores',
  CVL: 'CVL — Caminhoes e Linha Pesada',
  MCO: 'MCO — Motocicletas',
  IND: 'IND — Industrias',
  ATA: 'ATA — Atacadistas',
};

/** Mapeamento IMBP → Segmento. Conforme taxonomia comercial. */
export const IMBP_TO_SEGMENT: Record<Imbp, Segment> = {
  '000011-PVL-REVENDA':      'PVL',
  '000012-MCO-REVENDA':      'MCO',
  '000013-CVL-REVENDA':      'CVL',
  '000014-ATACADISTA':       'ATA',
  '000015-CVL-AGRI-REVENDA': 'CVL',
  '000025-CVL-CONSUMO':      'CVL',
  '000026-INDUSTRIA':        'IND',
  '000028-CVL-AGRI':         'CVL',
};

export function deriveSegmentFromImbp(imbp: Imbp | null | undefined): Segment | null {
  if (!imbp) return null;
  return IMBP_TO_SEGMENT[imbp] ?? null;
}

/**
 * Etapas do fluxo macro do lead (orthogonal ao `status` quente/morno/frio).
 *
 *   incomplete   — sem telefone; aguarda enriquecimento (BrasilAPI/scraping/IA)
 *   complete     — telefone presente e válido; pronto pra entrar no disparo
 *   dispatched   — recebeu disparo automático/campanha; aguarda resposta
 *   engaged      — respondeu pelo menos uma mensagem inbound
 *   qualified    — IA de atendimento marcou como pronto pra comercial
 *   handed_off   — comercial assumiu (deal criado e atribuído)
 *   lost         — encerrado sem conversão
 */
export const LEAD_FLOW_STAGES = [
  'incomplete',
  'complete',
  'dispatched',
  'engaged',
  'qualified',
  'handed_off',
  'lost',
] as const;
export type LeadFlowStage = (typeof LEAD_FLOW_STAGES)[number];

/**
 * Resultado da ultima tentativa de enriquecimento BrasilAPI pra este lead.
 * null = nunca foi enriquecido (ou enriquecimento ainda nao rodou).
 */
export type LeadEnrichmentResult =
  | 'phone_found'              // sucesso — telefone preenchido
  | 'phone_not_in_brasilapi'   // CNPJ ativo, mas Receita nao tem telefone publico
  | 'cnpj_not_found'           // CNPJ nao existe na Receita Federal
  | 'cnpj_inactive'            // CNPJ baixado / inapto
  | 'api_error';               // erro transiente da BrasilAPI

export interface LeadCampaignSummary {
  id: string;
  name: string;
  /** ISO timestamp do `campaign_recipients.sent_at`. Lista vem ordenada desc. */
  sentAt: string;
}

export interface PublicLead {
  id: string;
  name: string;
  phone: string | null;
  phone2: string | null;
  cnpj: string | null;
  email: string | null;
  notes: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  imbp: Imbp | null;
  segment: Segment | null;
  status: LeadStatus;
  source: LeadSource;
  flowStage: LeadFlowStage;
  hasDeal: boolean;
  /** Ultimo resultado de enriquecimento BrasilAPI (null se nunca foi enriquecido). */
  lastEnrichmentResult: LeadEnrichmentResult | null;
  campaigns: LeadCampaignSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface ImportReport {
  inserted: number;
  updated: number;
  skipped: number;
  rejected: { line: number; reason: string }[];
  enrichmentTriggered?: {
    jobId: string;
    mode: 'started' | 'appended';
    newLeadsQueued: number;
    estimatedMinutes: number;
  } | null;
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
    cnpj: string | null;
    status: LeadStatus;
  };
  queue: ConversationQueue;
  status: ConversationStatus;
  assignedTo: { id: string; name: string } | null;
  originKind: OriginKind;
  originCampaignId: string | null;
  originCampaignName: string | null;
  lastMessagePreview: string;
  lastMessageDirection: MessageDirection | null;
  lastMessageAt: string;
  lastInboundAt: string | null;
  unreadCount: number;
  isExpired24h: boolean;
  enteredQueueAt: string | null;
  hasAiHandoff: boolean;
  handoffSummary: string | null;
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
  editedAt: string | null;
  deletedAt: string | null;
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
  /**
   * Quando true, esconde conversas que sao so disparos de campanha sem
   * resposta (origin=campaign + lastInboundAt IS NULL). Default no backend
   * eh false (sem mudanca de comportamento); frontend Inbox passa true por
   * padrao pra nao poluir com disparos orfaos.
   */
  onlyWithInbound?: boolean;
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
  'lead_no_comercial',
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
  'quality_feedback',         // NOVO: vendedor deu feedback bom/ruim
] as const;
export type DealActivityKind = (typeof DEAL_ACTIVITY_KINDS)[number];

export interface PublicDeal {
  id: string;
  lead: {
    id: string;
    name: string;
    phone: string | null;
    cnpj: string | null;
    status: LeadStatus;
  };
  stage: DealStage;
  proposalValue: number | null;
  lossReason: LossReason | null;
  notes: string | null;
  owner: { id: string; name: string } | null;
  closedAt: string | null;
  leadQualityFeedback: LeadQualityFeedback | null;
  leadQualityFeedbackAt: string | null;
  isStale: boolean;
  enteredCurrentStageAt: string;
  aiSummary: string | null;
  campaigns: LeadCampaignSummary[];
  // Campanha que ORIGINOU o contato — mesma fonte que o badge da conversa
  // (conversations.origin_campaign_id). null quando o deal não veio de campanha.
  originCampaignId: string | null;
  originCampaignName: string | null;
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
  // Campanhas que originaram ao menos um card no escopo atual (owner+busca,
  // ignorando o próprio filtro de campanha) — grupo "Campanha de origem" do
  // multi-select do Kanban.
  originCampaigns: Array<{ id: string; name: string }>;
  // Campanhas que dispararam (recipient enviado) para algum card do escopo mas
  // NÃO são a campanha de origem — grupo "Recebeu disparo" do multi-select.
  // Cobre re-disparos (ex.: uma lista nova sobre uma base já contatada).
  recipientCampaigns: Array<{ id: string; name: string }>;
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
// WhatsApp provider kinds (multi-provider support)
// ---------------------------------------------------------------------------

export const PROVIDER_KINDS = ['uazapi', 'meta_cloud'] as const;
export type ProviderKind = typeof PROVIDER_KINDS[number];

// ---------------------------------------------------------------------------
// WhatsApp multi-instance CRUD (Task 7)
// ---------------------------------------------------------------------------

export interface InstanceListItem {
  id: string;
  provider: ProviderKind;
  displayName: string;
  phoneNumber: string | null;
  profileName: string | null;
  isDefault: boolean;
  isArchived: boolean;
  lastStatus: string | null;
  lastStatusAt: string | null;
}

export interface InstanceDetailResponse extends InstanceListItem {
  status: 'disconnected' | 'pairing' | 'connected' | 'error';
  qrCode: string | null;
  // Provider-specific fields exposed (no secrets):
  uazapi?: { baseUrl: string; webhookSynced: boolean; webhookUrl: string | null };
  metaCloud?: { wabaId: string; phoneNumberId: string; webhookSubscribed: boolean };
}

export interface CreateInstanceRequest {
  provider: ProviderKind;
  displayName: string;
  isDefault?: boolean;
  uazapi?: { baseUrl?: string; adminToken?: string };
  metaCloud?: {
    wabaId: string;
    phoneNumberId: string;
    accessToken: string;
    appSecret: string;
  };
}

export interface WebhookInfoResponse {
  callbackUrl: string;
  verifyToken: string;
  subscribed: boolean;
}

// ---------------------------------------------------------------------------
// Mass Campaigns (sub-projeto 7)
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATUSES = [
  'draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_RECIPIENT_STATUSES = [
  'pending', 'sending', 'sent', 'failed', 'skipped',
] as const;
export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

export interface AudienceFilters {
  status?: LeadStatus[];
  source?: LeadSource[];
  daysSinceCreated?: number;
  excludeLeadIds?: string[];
  phoneCsv?: string[];
}

export type CampaignBlockReason = 'recent_outbound' | 'pending_other_campaign';

export interface CampaignDryRunResponse {
  total: number;
  eligible: number;
  blocked: {
    recentOutbound: number;
    pendingOtherCampaign: number;
  };
  /**
   * Lista de leadIds de TODOS os elegiveis (nao so a pagina atual).
   * Usado pelo frontend pra "marcar/desmarcar todos" sem ter que buscar
   * todas as paginas. Cap em 10000 — acima disso, omitido (cliente pode
   * pedir "desmarcar todos" so dentro da pagina visivel).
   */
  eligibleIds: string[];
  /** Numero da pagina atual (1-indexed). */
  page: number;
  /** Tamanho da pagina. */
  pageSize: number;
  /** Total de paginas (max(1, ceil(totalComPhone / pageSize))). */
  pageCount: number;
  /**
   * Quantos telefones do CSV ainda NAO existem como lead e serao criados no
   * momento em que a campanha for criada. Ja contabilizados em `total` e
   * `eligible`. 0 (ou ausente) quando nao ha CSV ou tudo ja existe.
   */
  newFromCsv?: number;
  /**
   * Quantos telefones do CSV foram descartados por formato invalido (nao
   * normalizaram pra um numero BR valido). NAO entram em `total`. Serve pra
   * avisar o operador que parte da lista nao vai receber.
   */
  invalidFromCsv?: number;
  preview: Array<{
    leadId: string;
    name: string;
    phone: string;
    cnpj: string | null;
    createdAt: string;
    /** null = elegivel; string = motivo de bloqueio. */
    blockReason: CampaignBlockReason | null;
    /** true = telefone do CSV que ainda nao e lead (sera criado na campanha). */
    isNew?: boolean;
  }>;
}

export interface PublicCampaign {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  templateId: string | null;
  messageBody: string;
  qualificationQuestion: string | null;
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
  skippedByCooldown: number;
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
  skippedByCooldown: number;
  skippedOther: number;
  replied: number;
  inDeal: number;
  won: number;
  lost: number;
  lostByReason: Record<LossReason, number>;
  totalWonValue: number;
}

/**
 * Stats agregadas de todas as campanhas. Usado pra dashboard de relatorio
 * na pagina /campanhas e /campanhas/relatorio.
 *
 * Filtravel por periodo (filtra atividade — sent_at de recipients + closed_at
 * de deals) e por tipo (one-shot / continuous / all).
 *
 * Se compareWith for retornado, eh stats do periodo imediatamente anterior
 * (mesma duracao) — frontend usa pra mostrar Δ%.
 *
 * lostByReason: contagem agregada de deals perdidos por motivo no periodo.
 */
export interface CampaignsAggregateStats {
  totalCampaigns: number;
  completedCampaigns: number;
  activeCampaigns: number;
  totalSent: number;
  totalReplied: number;
  replyRate: number;
  totalInDeal: number;
  totalWon: number;
  totalLost: number;
  totalWonValue: number;
  conversionRate: number;
  lostByReason: Record<LossReason, number>;
  period: { start: string; end: string; key: string; label: string };
  kind: 'all' | 'one_shot' | 'continuous';
  compareWith?: Omit<CampaignsAggregateStats, 'compareWith'>;
}

/**
 * Top campanhas do periodo, ranqueadas. Default rank: por sent DESC.
 */
export interface TopCampaign {
  id: string;
  name: string;
  status: CampaignStatus;
  isContinuous: boolean;
  sent: number;
  replied: number;
  replyRate: number;
  won: number;
  wonValue: number;
}

export interface TopCampaignsResponse {
  items: TopCampaign[];
  period: { start: string; end: string; key: string; label: string };
}

/**
 * Serie temporal diaria pra grafico no relatorio dedicado.
 * Cada bucket cobre 1 dia (timezone America/Sao_Paulo).
 */
export interface CampaignsTimeseriesBucket {
  date: string;       // YYYY-MM-DD
  sent: number;
  replied: number;
  won: number;
}

export interface CampaignsTimeseries {
  buckets: CampaignsTimeseriesBucket[];
  period: { start: string; end: string; key: string; label: string };
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

// ---------------------------------------------------------------------------
// Org Settings (sub-projeto 8 — singleton da organização)
// ---------------------------------------------------------------------------

export interface PublicOrgSettings {
  monthlySalesGoal: number | null;
  // ── IA de atendimento (Sprint 2) ──
  aiEnabled: boolean;
  aiAgentName: string;
  aiBusinessName: string;
  aiBusinessDesc: string;
  aiProducts: string;
  aiTargetAudience: string;
  aiTone: string;
  aiObjective: string;
  aiDontTalk: string;
  aiAlwaysAsk: string;
  aiQualifyWhen: string;
  aiBusinessHours: string;
  aiAfterHoursMsg: string;
  // ── Horário comercial da IA (Sprint IA Enhances E3) ──
  aiBusinessHoursStart: number;
  aiBusinessHoursEnd: number;
  aiBusinessHoursDays: string;  // CSV de ISO weekdays (1=seg .. 7=dom)
  ai24x7: boolean;
  // ── Janela de envio (Sprint 4 — auto-disparo respeitando horário comercial) ──
  dispatchStartHour: number;
  dispatchEndHour: number;
  dispatchSkipWeekends: boolean;
  dispatchTimezone: string;
  updatedAt: string;
}

export interface UpdateOrgSettingsInput {
  monthlySalesGoal?: number | null;
  aiEnabled?: boolean;
  aiAgentName?: string;
  aiBusinessName?: string;
  aiBusinessDesc?: string;
  aiProducts?: string;
  aiTargetAudience?: string;
  aiTone?: string;
  aiObjective?: string;
  aiDontTalk?: string;
  aiAlwaysAsk?: string;
  aiQualifyWhen?: string;
  aiBusinessHours?: string;
  aiAfterHoursMsg?: string;
  aiBusinessHoursStart?: number;
  aiBusinessHoursEnd?: number;
  aiBusinessHoursDays?: string;
  ai24x7?: boolean;
  dispatchStartHour?: number;
  dispatchEndHour?: number;
  dispatchSkipWeekends?: boolean;
  dispatchTimezone?: string;
}

// ---------------------------------------------------------------------------
// Continuous campaign (Sprint 4)
// ---------------------------------------------------------------------------

export interface CampaignMessageVariant {
  name?: string;
  body: string;
  mediaUrl?: string | null;
  mediaMime?: string | null;
}

export interface PublicContinuousCampaign {
  id: string;
  name: string;
  status: CampaignStatus;
  messageBody: string;                       // fallback se variants vazio
  messageVariants: CampaignMessageVariant[]; // 0+ variantes A/B
  ratePerMinute: number;
  enrolledTotal: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  variantStats: VariantStat[];               // métricas A/B (vazio se sem variantes ou sem envios)
  createdAt: string;
  updatedAt: string;
}

export interface VariantStat {
  variantBody: string;             // o body identifica a variante (mesmo que nameless)
  variantName: string | null;      // nome da variante quando definido em messageVariants
  sentCount: number;               // quantas vezes essa variante foi enviada
  repliedCount: number;            // quantos receptores responderam (inbound após o sent_at)
  qualifiedCount: number;          // quantos leads viraram qualified/handed_off
  replyRate: number;               // % repliedCount / sentCount
  qualifyRate: number;             // % qualifiedCount / sentCount
}

export interface UpsertContinuousCampaignInput {
  name?: string;
  status?: 'running' | 'paused';
  messageBody?: string;
  messageVariants?: CampaignMessageVariant[];
  ratePerMinute?: number;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export type DashboardView = 'org' | 'me';
export type DashboardPeriod = 'today' | '7d' | 'month' | '30d' | 'quarter';

export interface DashboardKpiNumber {
  value: number;
  prev: number;
  deltaPct: number;
}

export interface DashboardKpis {
  sales:     DashboardKpiNumber & { count: number; prevCount: number };
  proposals: DashboardKpiNumber;
  winRate:   DashboardKpiNumber;
  avgTicket: DashboardKpiNumber;
}

export interface DashboardGoal {
  monthlyTarget: number;
  currentMonthSales: number;
  percent: number;
}

export interface DashboardFunnelOrg {
  kind: 'org';
  newLeads: number;
  withConversation: number;
  withProposal: number;
  won: number;
  convLeadToConv: number;
  convConvToProposal: number;
  convProposalToWon: number;
}

export interface DashboardFunnelMe {
  kind: 'me';
  respondedConversations: number;
  myProposals: number;
  myWon: number;
  convRespToProposal: number;
  convProposalToWon: number;
}

export interface DashboardPipelineOpen {
  byStage: { stage: 'lead_no_comercial' | 'proposta_enviada' | 'em_negociacao'; count: number; valueSum: number }[];
  totalValue: number;
  avgAgeDays: number;
}

export interface DashboardLeader {
  userId: string;
  name: string;
  wonValue: number;
  wonCount: number;
}

export interface DashboardRecentActivity {
  id: string;
  kind: DealActivityKind;
  dealId: string;
  leadName: string;
  createdAt: string;
}

export interface DashboardSummary {
  period: { start: string; end: string; prevStart: string; prevEnd: string; label: string };
  kpis: DashboardKpis;
  goal: DashboardGoal | null;
  funnel: DashboardFunnelOrg | DashboardFunnelMe;
  pipelineOpen: DashboardPipelineOpen;
  leaderboard: DashboardLeader[] | null;
  recentActivities: DashboardRecentActivity[] | null;
}

export type DashboardAttentionKind =
  | 'proposal_old'
  | 'conv_expired'
  | 'deal_stale'
  | 'queue_pending';

export interface DashboardAttentionItem {
  severity: 'critical' | 'warning' | 'info';
  kind: DashboardAttentionKind;
  count: number;
  route: string;
  filter: Record<string, unknown>;
}

export interface DashboardAttentionResponse {
  items: DashboardAttentionItem[];
}

export interface DashboardWhatsappStats {
  inQueue: number;
  avgFirstResponseSec: number;
  expired24h: number;
  noResponseToday: number;
  instanceConnected: boolean;
}

// ---------------------------------------------------------------------------
// Notifications (Sprint 6.8)
// ---------------------------------------------------------------------------

export const NOTIFICATION_KINDS = [
  'enrichment_completed',   // bulk enrichment job terminou
  'enrichment_cancelled',
  'lead_qualified',         // IA marcou lead como QUALIFICADO
  'dispatch_failed',        // disparo de campanha falhou
  'whatsapp_disconnected',  // instância UazAPI caiu
  'campaign_cooldown_high',
  'sla_escalation',         // lead aguardando atendimento na fila Comercial além do SLA
  'ai_fallback',            // IA falhou repetidamente — conversa movida pra recepção
  'system',                 // generic
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface PublicNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsListResponse {
  items: PublicNotification[];
  unreadCount: number;
}

// ---------------------------------------------------------------------------
// AI metrics (Sprint 6.7)
// ---------------------------------------------------------------------------

export interface AiMetricsSummary {
  period: { start: string; end: string };
  totalCalls: number;
  qualifiedCount: number;
  qualifyRate: number;
  humanIntentCount: number;
  errorCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  avgCostPerCallUsd: number;
  avgCostPerQualifiedUsd: number | null;
}

// ---------------------------------------------------------------------------
// Lead stage transitions (Sprint 6.3) — audit trail por lead
// ---------------------------------------------------------------------------

export const TRANSITION_SOURCES = [
  'create',            // insert inicial
  'manual_update',     // updateLead com mudança de phone (não-IA)
  'csv_import',        // CSV import promoveu (phone backfill)
  'enrichment',        // enrichLead OU bulk enrichment preencheu phone
  'webhook_inbound',   // mensagem inbound promoveu pra engaged
  'campaign_dispatch', // dispatcher promoveu pra dispatched
  'ai_qualification',  // IA marcou QUALIFICADO
  'deal_created',      // deal criado promoveu pra handed_off
  'manual_lost',       // admin marcou como perdido
  'backfill',          // migration 019 (pré-existente)
] as const;
export type TransitionSource = (typeof TRANSITION_SOURCES)[number];

export interface PublicLeadStageTransition {
  id: string;
  fromStage: LeadFlowStage | null;
  toStage: LeadFlowStage;
  source: TransitionSource;
  metadata: Record<string, unknown> | null;
  changedAt: string;
}

// ---------------------------------------------------------------------------
// Bulk enrichment job (Sprint 6.1)
// ---------------------------------------------------------------------------

export type EnrichmentJobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'cancelled';

export interface PublicEnrichmentJob {
  id: string;
  status: EnrichmentJobStatus;
  totalLeads: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  pendingCount: number;
  pctComplete: number;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  lastError: string | null;
  estimatedRemainingMinutes: number | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Macro funnel (Sprint 5) — visão de cada etapa do flow_stage no período
// ---------------------------------------------------------------------------

export interface MacroFunnelStage {
  count: number;
  pctOfTotal: number;          // % sobre total importado
  convFromPrev?: number;        // % de conversão da etapa anterior (omitido em "imported")
}

export interface DashboardMacroFunnel {
  period: { start: string; end: string; label: string };
  total: number;                // mesmo que stages.imported.count
  stages: {
    imported: MacroFunnelStage;     // todos os leads criados no período
    complete: MacroFunnelStage;     // tem telefone (ou já avançou)
    dispatched: MacroFunnelStage;   // recebeu disparo (ou já avançou)
    engaged: MacroFunnelStage;      // respondeu pelo menos 1x
    qualified: MacroFunnelStage;    // IA marcou QUALIFICADO
    handedOff: MacroFunnelStage;    // comercial assumiu (deal criado)
  };
  sidelines: {
    incomplete: MacroFunnelStage;   // travados sem telefone
    lost: MacroFunnelStage;         // encerrados sem conversão
  };
  // Tempo médio que cada etapa "segurou" o lead antes da próxima transição
  // (apenas leads do período). Sprint 6.4.
  avgDurationByStage: Array<{
    stage: LeadFlowStage;
    avgSeconds: number;
    transitionCount: number;        // quantas amostras geraram essa média
  }>;
}

// ---------------------------------------------------------------------------
// WhatsApp HSM Templates (Plan C — multi-provider + Meta HSM)
// ---------------------------------------------------------------------------

export const HSM_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
export type HsmCategory = typeof HSM_CATEGORIES[number];

export const HSM_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'] as const;
export type HsmStatus = typeof HSM_STATUSES[number];

export interface HsmHeaderText {
  type: 'HEADER';
  format: 'TEXT';
  text: string;
  example?: { header_text: string[] };
}
export interface HsmHeaderMedia {
  type: 'HEADER';
  format: 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  example?: { header_handle: string[] };
}
export type HsmHeader = HsmHeaderText | HsmHeaderMedia;

export interface HsmBody {
  type: 'BODY';
  text: string;
  example?: { body_text: string[][] };
}

export interface HsmFooter {
  type: 'FOOTER';
  text: string;
}

export interface HsmQuickReplyButton { type: 'QUICK_REPLY'; text: string }
export interface HsmUrlButton { type: 'URL'; text: string; url: string }
export interface HsmPhoneButton { type: 'PHONE_NUMBER'; text: string; phone_number: string }
export type HsmButton = HsmQuickReplyButton | HsmUrlButton | HsmPhoneButton;

export interface HsmButtons {
  type: 'BUTTONS';
  buttons: HsmButton[];
}

export type HsmComponent = HsmHeader | HsmBody | HsmFooter | HsmButtons;

export interface HsmTemplateRecord {
  id: string;
  instanceId: string;
  metaTemplateId: string | null;
  name: string;
  language: string;
  category: HsmCategory;
  status: HsmStatus;
  components: HsmComponent[];
  variableCount: number;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
}

export interface CreateHsmTemplateRequest {
  name: string;          // snake_case
  language: string;
  category: HsmCategory;
  components: HsmComponent[];
  submitNow?: boolean;
}

export interface CampaignHsmVariable {
  index: number;
  source: 'static' | 'lead_field';
  value: string;
}

// ---------------------------------------------------------------------------
// AI Calibration (Sprint Calibração IA — 2026-05-26)
// ---------------------------------------------------------------------------

export const LEAD_QUALITY_FEEDBACK = ['good', 'bad'] as const;
export type LeadQualityFeedback = (typeof LEAD_QUALITY_FEEDBACK)[number];

export const QUALIFICATION_PATHS = ['campaign_direct', 'conversation'] as const;
export type QualificationPath = (typeof QUALIFICATION_PATHS)[number];

export interface QuestionAnswer {
  question: string;
  answer: string;
  consideredAt: string;        // ISO timestamp
}

/** Ficha do caso: composição read-only de tudo que importa pra calibrar IA. */
export interface PublicCaseSheet {
  leadId: string;
  leadName: string;
  // Decisão da IA
  aiCallLogId: string | null;
  qualified: boolean | null;
  qualificationPath: QualificationPath | null;
  decisionReason: string | null;
  questionsAnswers: QuestionAnswer[];
  promptVersion: string | null;
  decidedAt: string | null;
  model: string | null;
  // Contexto da campanha (se origem campaign)
  campaignId: string | null;
  campaignName: string | null;
  qualificationQuestion: string | null;     // pergunta da campanha
  campaignMessageBody: string | null;       // primeira mensagem do disparo
  firstInboundReply: string | null;         // primeira resposta do lead
  // Trajetória do deal (se houver)
  dealId: string | null;
  dealStage: DealStage | null;
  dealValue: number | null;
  dealLossReason: LossReason | null;
  leadQualityFeedback: LeadQualityFeedback | null;
  leadQualityFeedbackAt: string | null;
  // Encerramento sem deal (se houver)
  closedNoDealAt: string | null;
  closedNoDealReason: string | null;
  closedNoDealQuality: LeadQualityFeedback | null;
}

export interface ReanalyzeCaseInput {
  reason: string;     // por que admin pediu reanálise (livre)
}

// ── Audit sample queue ────────────────────────────────────────────
export const AUDIT_SAMPLE_STATUSES = ['pending', 'assigned', 'contacted', 'skipped'] as const;
export type AuditSampleStatus = (typeof AUDIT_SAMPLE_STATUSES)[number];

export interface PublicAuditSample {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  leadCnpj: string | null;
  campaignId: string | null;
  campaignName: string | null;
  sampledAt: string;
  status: AuditSampleStatus;
  assignedTo: { id: string; name: string } | null;
  assignedAt: string | null;
  contactedAt: string | null;
  outcome: LeadQualityFeedback | null;
  outcomeAt: string | null;
  outcomeNotes: string | null;
  // IMPORTANTE: a UI da fila cega NÃO mostra a decisão da IA nem o motivo.
  // Esses campos só aparecem em endpoints internos de relatório.
}

/** Payload do POST /audit/samples/claim — sem corpo (claim do próximo da fila). */
export type AuditSampleAssignInput = Record<string, never>;

export interface AuditSampleOutcomeInput {
  outcome: LeadQualityFeedback;
  notes?: string;
}

export interface CampaignCalibrationMetrics {
  campaignId: string;
  totalQualifiedByAi: number;          // IA disse "qualificado"
  totalNotQualifiedByAi: number;       // IA disse "não qualificado"
  feedbackGivenCount: number;          // quantos qualificados receberam feedback bin
  feedbackGoodCount: number;           // dos qualificados, vendedor marcou "bom"
  feedbackBadCount: number;            // dos qualificados, vendedor marcou "ruim"
  precision: number | null;            // good / (good + bad) — null se 0 feedback
  // Recall via fila cega
  auditTotal: number;
  auditContacted: number;
  auditGood: number;                   // falsos negativos confirmados
  auditBad: number;                    // verdadeiros negativos
  estimatedRecall: number | null;      // good_qualified / (good_qualified + extrapolated_audit_good)
}

export interface CloseLeadNoDealInput {
  reason: string;
  quality: LeadQualityFeedback;
}
