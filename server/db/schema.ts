import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  date,
  integer,
  inet,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import {
  ROLES,
  LEAD_STATUSES,
  LEAD_SOURCES,
  CONVERSATION_QUEUES,
  CONVERSATION_STATUSES,
  MESSAGE_DIRECTIONS,
  MESSAGE_KINDS,
  ORIGIN_KINDS,
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
  phone: text('phone').notNull().unique(),
  email: text('email'),
  notes: text('notes'),
  vehiclePlate: text('vehicle_plate'),
  vehicleModel: text('vehicle_model'),
  lastPurchaseDate: date('last_purchase_date'),
  avgMileagePerDay: integer('avg_mileage_per_day').default(50),
  status: text('status', { enum: LEAD_STATUSES }).notNull().default('frio'),
  source: text('source', { enum: LEAD_SOURCES }).notNull().default('manual'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull().unique(),
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
  uazapiMsgId: text('uazapi_msg_id').unique(),
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
