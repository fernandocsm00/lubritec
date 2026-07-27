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
import { sql } from 'drizzle-orm';
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
  PROVIDER_KINDS,
  HSM_CATEGORIES,
  HSM_STATUSES,
  IMBP_VALUES,
  SEGMENT_VALUES,
  UF_VALUES,
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
    phone: text('phone'),
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
  phone2: text('phone2'), // telefone secundario, usado como fallback no dispatcher
  cnpj: text('cnpj').unique(),
  email: text('email'),
  notes: text('notes'),
  address1: text('address1'),
  address2: text('address2'),
  city: text('city'),
  uf: text('uf', { enum: UF_VALUES }),
  imbp: text('imbp', { enum: IMBP_VALUES }),
  segment: text('segment', { enum: SEGMENT_VALUES }),
  status: text('status', { enum: LEAD_STATUSES }).notNull().default('frio'),
  source: text('source', { enum: LEAD_SOURCES }).notNull().default('manual'),
  flowStage: text('flow_stage', { enum: LEAD_FLOW_STAGES }).notNull().default('incomplete'),
  closedNoDealAt: timestamp('closed_no_deal_at', { withTimezone: true }),
  closedNoDealBy: uuid('closed_no_deal_by').references(() => users.id, { onDelete: 'set null' }),
  closedNoDealReason: text('closed_no_deal_reason'),
  closedNoDealQuality: text('closed_no_deal_quality', { enum: ['good', 'bad'] }),
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
  handoffSummary: text('handoff_summary'),
  enteredQueueAt: timestamp('entered_queue_at', { withTimezone: true }),
  pendingAiResponse: boolean('pending_ai_response').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  instancePhoneUniq: uniqueIndex('idx_conversations_instance_phone').on(t.instanceId, t.phone),
}));

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
  provider: text('provider', { enum: PROVIDER_KINDS }).notNull().default('uazapi'),
  rawPayload: jsonb('raw_payload').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  // Edit/delete (migration 032) — espelha revoke/edit nativo do WhatsApp via UazAPI.
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  originalBody: text('original_body'),
}, (t) => ({
  providerMsgidUniq: uniqueIndex('idx_messages_provider_msgid')
    .on(t.provider, t.providerMsgId)
    .where(sql`${t.providerMsgId} IS NOT NULL`),
}));

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
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'restrict' }),
  stage: text('stage', { enum: DEAL_STAGES }).notNull().default('proposta_enviada'),
  proposalValue: numeric('proposal_value', { precision: 12, scale: 2 }),
  lossReason: text('loss_reason', { enum: LOSS_REASONS }),
  notes: text('notes'),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'restrict' }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  leadQualityFeedback: text('lead_quality_feedback', { enum: ['good', 'bad'] }),
  leadQualityFeedbackAt: timestamp('lead_quality_feedback_at', { withTimezone: true }),
  leadQualityFeedbackBy: uuid('lead_quality_feedback_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Múltiplos deals por lead (recompra), mas no máximo 1 ATIVO por lead.
  // Deals terminais (ganho/perdido) acumulam como histórico. Ver migration 036.
  oneActivePerLead: uniqueIndex('uidx_deals_one_active_per_lead')
    .on(t.leadId)
    .where(sql`stage NOT IN ('ganho', 'perdido')`),
}));

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
  provider: text('provider', { enum: PROVIDER_KINDS }).notNull(),
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
}, (t) => ({
  defaultUniq: uniqueIndex('idx_whatsapp_instance_default')
    .on(t.isDefault)
    .where(sql`${t.isDefault} = true`),
}));

export const whatsappHsmTemplates = pgTable('whatsapp_hsm_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  instanceId: uuid('instance_id').notNull().references(() => whatsappInstance.id, { onDelete: 'cascade' }),
  metaTemplateId: text('meta_template_id'),
  name: text('name').notNull(),
  language: text('language').notNull(),
  category: text('category', { enum: HSM_CATEGORIES }).notNull(),
  status: text('status', { enum: HSM_STATUSES }).notNull(),
  components: jsonb('components').notNull(),
  // URL pública (Supabase Storage) da imagem de header — usada no disparo.
  // Fora de `components` porque a Meta rejeita esse campo na criação (migration 036).
  headerMediaUrl: text('header_media_url'),
  variableCount: integer('variable_count').notNull().default(0),
  rejectionReason: text('rejection_reason'),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
}, (t) => ({
  instanceNameLangUniq: uniqueIndex('idx_hsm_instance_name_lang').on(t.instanceId, t.name, t.language),
  statusIdx: index('idx_hsm_status').on(t.status),
}));

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
    aiBusinessHoursStart: integer('ai_business_hours_start').notNull().default(8),
    aiBusinessHoursEnd: integer('ai_business_hours_end').notNull().default(18),
    aiBusinessHoursDays: text('ai_business_hours_days').notNull().default('1,2,3,4,5'),
    ai24x7: boolean('ai_24x7').notNull().default(false),
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
  // Multi-instance + HSM (Plan C — migration 027)
  instanceId: uuid('instance_id').notNull().references(() => whatsappInstance.id, { onDelete: 'restrict' }),
  hsmTemplateId: uuid('hsm_template_id').references(() => whatsappHsmTemplates.id, { onDelete: 'restrict' }),
  hsmVariables: jsonb('hsm_variables').default([]),
  qualificationQuestion: text('qualification_question'),
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
  // Retry com backoff (migration 034): tentativas já feitas + quando a próxima
  // pode rodar. attempt_count só cresce em falha TRANSIENTE do provider.
  attemptCount: integer('attempt_count').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
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
  decisionReason: text('decision_reason'),
  qualificationPath: text('qualification_path', { enum: ['campaign_direct', 'conversation'] }),
  questionsAnswers: jsonb('questions_answers').notNull().default([]),
  promptVersion: text('prompt_version'),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Espelham os índices da migration 029 pra evitar drift de schema.
  leadQualifiedIdx: index('idx_ai_call_logs_lead_qualified').on(t.leadId, t.qualified),
  campaignIdx: index('idx_ai_call_logs_campaign')
    .on(t.campaignId)
    .where(sql`${t.campaignId} IS NOT NULL`),
}));

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

// ── Conversation SLA events (Sprint IA Enhances) ─────────────────
// Tracking de escalonamento SLA da fila Comercial.
// level: 1=5min, 2=10min, 3=30min. Unique index garante uma vez por nível.
export const conversationSlaEvents = pgTable('conversation_sla_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  level: integer('level').notNull(),
  firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ConversationSlaEvent = typeof conversationSlaEvents.$inferSelect;
export type NewConversationSlaEvent = typeof conversationSlaEvents.$inferInsert;

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

// ── Audit sample assignments (Sprint Calibração IA) ──────────────
// Amostragem cega: 10% dos leads marcados "não qualificados" pela IA
// entram aqui pra contato controlado e medição de falso negativo.
export const auditSampleAssignments = pgTable('audit_sample_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  aiCallLogId: uuid('ai_call_log_id').references(() => aiCallLogs.id, { onDelete: 'set null' }),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  sampledAt: timestamp('sampled_at', { withTimezone: true }).notNull().defaultNow(),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
  contactedAt: timestamp('contacted_at', { withTimezone: true }),
  outcome: text('outcome', { enum: ['good', 'bad'] }),
  outcomeAt: timestamp('outcome_at', { withTimezone: true }),
  outcomeNotes: text('outcome_notes'),
  status: text('status', { enum: ['pending', 'assigned', 'contacted', 'skipped'] }).notNull().default('pending'),
}, (t) => ({
  // Unique index nomeado pra casar com a migration 029 (idx_audit_sample_lead_unique).
  // Não usar .unique() inline no leadId — gera constraint sem nome e drift no Drizzle.
  leadUniq: uniqueIndex('idx_audit_sample_lead_unique').on(t.leadId),
  statusCampaignIdx: index('idx_audit_sample_status_campaign').on(t.status, t.campaignId),
  // Partial index: a migration cria com WHERE assigned_to IS NOT NULL. Drizzle suporta
  // via .where(sql`...`). Mantém schema fiel ao DB pra evitar drift.
  assignedToIdx: index('idx_audit_sample_assigned_to')
    .on(t.assignedTo)
    .where(sql`${t.assignedTo} IS NOT NULL`),
}));

export type AuditSampleAssignment = typeof auditSampleAssignments.$inferSelect;
export type NewAuditSampleAssignment = typeof auditSampleAssignments.$inferInsert;

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
export type WhatsappHsmTemplate = typeof whatsappHsmTemplates.$inferSelect;
export type NewWhatsappHsmTemplate = typeof whatsappHsmTemplates.$inferInsert;
export type OrgSettings = typeof orgSettings.$inferSelect;
export type NewOrgSettings = typeof orgSettings.$inferInsert;
