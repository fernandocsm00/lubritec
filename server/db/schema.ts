import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  inet,
  jsonb,
  numeric,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  ROLES,
  LEAD_STATUSES,
  LEAD_SOURCES,
  LEAD_FLOW_STAGES,
  CONVERSATION_QUEUES,
  CONVERSATION_STATUSES,
  MESSAGE_DIRECTIONS,
  MESSAGE_KINDS,
  ORIGIN_KINDS,
  DEAL_STAGES,
  LOSS_REASONS,
  DEAL_ACTIVITY_KINDS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_RECIPIENT_STATUSES,
} from '../../shared/types';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    role: text('role', { enum: ROLES }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ emailIdx: index('idx_users_email').on(t.email) }),
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    purpose: text('purpose', { enum: ['invite', 'password_reset'] }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('idx_auth_tokens_user').on(t.userId) }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    ipAddress: inet('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('idx_sessions_user').on(t.userId) }),
);

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  phone: text('phone'),  // nullable: leads CNPJ-only aguardam enriquecimento
  cnpj: text('cnpj').unique(),
  email: text('email'),
  notes: text('notes'),
  status: text('status', { enum: LEAD_STATUSES }).notNull().default('frio'),
  source: text('source', { enum: LEAD_SOURCES }).notNull().default('manual'),
  flowStage: text('flow_stage', { enum: LEAD_FLOW_STAGES }).notNull().default('incomplete'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull(),
  instanceId: uuid('instance_id').notNull().references(() => whatsappInstance.id, { onDelete: 'restrict' }),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'restrict' }),
  queue: text('queue', { enum: CONVERSATION_QUEUES }).notNull().default('recepcao'),
  status: text('status', { enum: CONVERSATION_STATUSES }).notNull().default('aguardando_atendimento'),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  originKind: text('origin_kind', { enum: ORIGIN_KINDS }).notNull().default('organic'),
  originCampaignId: uuid('origin_campaign_id'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  unreadCount: integer('unread_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  direction: text('direction', { enum: MESSAGE_DIRECTIONS }).notNull(),
  kind: text('kind', { enum: MESSAGE_KINDS }).notNull().default('text'),
  body: text('body'),
  mediaUrl: text('media_url'),
  mediaMime: text('media_mime'),
  sentByUserId: uuid('sent_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  providerMsgId: text('provider_msg_id'),
  provider: text('provider', { enum: ['uazapi', 'meta_cloud'] }).notNull().default('uazapi'),
  rawPayload: jsonb('raw_payload').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messageTemplates = pgTable('message_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deals = pgTable('deals', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().unique().references(() => leads.id, { onDelete: 'restrict' }),
  stage: text('stage', { enum: DEAL_STAGES }).notNull().default('proposta_enviada'),
  proposalValue: numeric('proposal_value', { precision: 12, scale: 2 }),
  lossReason: text('loss_reason', { enum: LOSS_REASONS }),
  notes: text('notes'),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'restrict' }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dealActivities = pgTable('deal_activities', {
  id: uuid('id').primaryKey().defaultRandom(),
  dealId: uuid('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: DEAL_ACTIVITY_KINDS }).notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const whatsappInstance = pgTable('whatsapp_instance', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider', { enum: ['uazapi', 'meta_cloud'] }).notNull(),
  displayName: text('display_name').notNull(),
  phoneNumber: text('phone_number'),
  profileName: text('profile_name'),
  providerConfig: jsonb('provider_config').notNull().default({}),
  isDefault: boolean('is_default').notNull().default(false),
  isArchived: boolean('is_archived').notNull().default(false),
  lastStatus: text('last_status'),
  lastStatusAt: timestamp('last_status_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orgSettings = pgTable(
  'org_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    singleton: boolean('singleton').notNull().default(true),
    monthlySalesGoal: numeric('monthly_sales_goal', { precision: 12, scale: 2 }),
    // ── IA de atendimento (Sprint 2) ──
    aiEnabled: boolean('ai_enabled').notNull().default(false),
    aiAgentName: text('ai_agent_name').notNull().default('Atendente Lubritec'),
    aiBusinessName: text('ai_business_name').notNull().default('Lubritec'),
    aiBusinessDesc: text('ai_business_desc').notNull().default(''),
    aiProducts: text('ai_products').notNull().default(''),
    aiTargetAudience: text('ai_target_audience').notNull().default(''),
    aiTone: text('ai_tone').notNull().default('profissional e cordial'),
    aiObjective: text('ai_objective').notNull().default('qualificar o lead e agendar contato com o comercial'),
    aiDontTalk: text('ai_dont_talk').notNull().default(''),
    aiAlwaysAsk: text('ai_always_ask').notNull().default(''),
    aiQualifyWhen: text('ai_qualify_when').notNull().default('cliente demonstrou interesse claro em comprar, pediu orçamento, ou solicitou agendamento'),
    aiBusinessHours: text('ai_business_hours').notNull().default(''),
    aiAfterHoursMsg: text('ai_after_hours_msg').notNull().default(''),
    // ── Janela de envio (auto-disparo Sprint 4) ──
    dispatchStartHour: integer('dispatch_start_hour').notNull().default(8),
    dispatchEndHour: integer('dispatch_end_hour').notNull().default(18),
    dispatchSkipWeekends: boolean('dispatch_skip_weekends').notNull().default(true),
    dispatchTimezone: text('dispatch_timezone').notNull().default('America/Sao_Paulo'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ singletonUniq: uniqueIndex('idx_org_settings_singleton').on(t.singleton) }),
);

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status', { enum: CAMPAIGN_STATUSES }).notNull().default('draft'),
  templateId: uuid('template_id').references(() => messageTemplates.id, { onDelete: 'set null' }),
  messageBody: text('message_body').notNull(),
  mediaUrl: text('media_url'),
  mediaMime: text('media_mime'),
  audienceFilter: jsonb('audience_filter').notNull().default({}),
  audienceTotal: integer('audience_total').notNull().default(0),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  sentCount: integer('sent_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  ratePerMinute: integer('rate_per_minute').notNull().default(20),
  // Campanha contínua: nunca termina, auto-enrola novos leads complete.
  // Apenas UMA pode existir ativa (partial unique index na migration).
  isContinuous: boolean('is_continuous').notNull().default(false),
  // A/B testing: array de variantes. Quando null/vazio, usa messageBody legado.
  messageVariants: jsonb('message_variants').$type<CampaignMessageVariant[] | null>(),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  cooldownAlertSentAt: timestamp('cooldown_alert_sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export interface CampaignMessageVariant {
  name?: string;
  body: string;
  mediaUrl?: string | null;
  mediaMime?: string | null;
}

export const campaignRecipients = pgTable('campaign_recipients', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'restrict' }),
  phone: text('phone').notNull(),
  status: text('status', { enum: CAMPAIGN_RECIPIENT_STATUSES }).notNull().default('pending'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
export type NewCampaignRecipient = typeof campaignRecipients.$inferInsert;

// ── Enrichment jobs (Sprint 6.1) ─────────────────────────────────
export const enrichmentJobs = pgTable('enrichment_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: text('status').notNull().default('pending'), // pending|running|completed|cancelled
  totalLeads: integer('total_leads').notNull(),
  processedCount: integer('processed_count').notNull().default(0),
  succeededCount: integer('succeeded_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enrichmentJobLeads = pgTable('enrichment_job_leads', {
  jobId: uuid('job_id').notNull().references(() => enrichmentJobs.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'), // pending|succeeded|failed
  resultStatus: text('result_status'),
  phoneFound: text('phone_found'),
  errorMessage: text('error_message'),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

export type EnrichmentJob = typeof enrichmentJobs.$inferSelect;
export type NewEnrichmentJob = typeof enrichmentJobs.$inferInsert;
export type EnrichmentJobLead = typeof enrichmentJobLeads.$inferSelect;

// ── Notifications (Sprint 6.8) ───────────────────────────────────
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    actionUrl: text('action_url'),
    metadata: jsonb('metadata'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index('idx_notifications_user_created').on(t.userId, t.createdAt),
  }),
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

// ── AI call logs (Sprint 6.7) ────────────────────────────────────
export const aiCallLogs = pgTable('ai_call_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  latencyMs: integer('latency_ms').notNull().default(0),
  qualified: boolean('qualified').notNull().default(false),
  humanIntent: boolean('human_intent').notNull().default(false),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AiCallLog = typeof aiCallLogs.$inferSelect;
export type NewAiCallLog = typeof aiCallLogs.$inferInsert;

// ── Lead stage transitions (Sprint 6.3) ──────────────────────────
export const leadStageTransitions = pgTable('lead_stage_transitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  fromStage: text('from_stage'),
  toStage: text('to_stage').notNull(),
  source: text('source').notNull(),
  metadata: jsonb('metadata'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LeadStageTransition = typeof leadStageTransitions.$inferSelect;
export type NewLeadStageTransition = typeof leadStageTransitions.$inferInsert;

export const projectFeedback = pgTable(
  'project_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    authorName: text('author_name').notNull(),
    content: text('content').notNull(),
    images: jsonb('images').notNull().default([]),
    status: text('status', { enum: ['open', 'doing', 'done', 'dismissed'] }).notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index('idx_project_feedback_created').on(t.createdAt),
    statusIdx: index('idx_project_feedback_status').on(t.status),
  }),
);

export type ProjectFeedback = typeof projectFeedback.$inferSelect;
export type NewProjectFeedback = typeof projectFeedback.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuthToken = typeof authTokens.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;
export type AuthTokenPurpose = 'invite' | 'password_reset';
export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type DealActivity = typeof dealActivities.$inferSelect;
export type NewDealActivity = typeof dealActivities.$inferInsert;
export type WhatsappInstance = typeof whatsappInstance.$inferSelect;
export type NewWhatsappInstance = typeof whatsappInstance.$inferInsert;
export type OrgSettings = typeof orgSettings.$inferSelect;
export type NewOrgSettings = typeof orgSettings.$inferInsert;
