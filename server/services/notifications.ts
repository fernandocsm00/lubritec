import { db } from '../db/client';
import { notifications, users } from '../db/schema';
import { and, eq, desc, isNull, sql, inArray } from 'drizzle-orm';
import type { Role } from '@shared/types';
import type {
  NotificationKind,
  PublicNotification,
  NotificationsListResponse,
} from '@shared/types';

// ---------------------------------------------------------------------------
// CRUD por usuário
// ---------------------------------------------------------------------------

const LIST_LIMIT_DEFAULT = 30;

export async function listNotifications(
  userId: string,
  limit: number = LIST_LIMIT_DEFAULT,
): Promise<NotificationsListResponse> {
  const items = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  const [unreadRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

  return {
    items: items.map(toPublic),
    unreadCount: Number(unreadRow?.n ?? 0),
  };
}

export async function unreadCountFor(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(row?.n ?? 0);
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function markAllRead(userId: string): Promise<{ marked: number }> {
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return { marked: result.length };
}

function toPublic(n: typeof notifications.$inferSelect): PublicNotification {
  return {
    id: n.id,
    kind: n.kind as NotificationKind,
    title: n.title,
    body: n.body,
    actionUrl: n.actionUrl,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Emit — chamado por hooks no servidor (best-effort, non-throwing)
// ---------------------------------------------------------------------------

export interface EmitInput {
  userIds?: string[];                  // destinatários explícitos
  toRoles?: Role[];                    // OU broadcast pra todas as roles listadas
  kind: NotificationKind;
  title: string;
  body: string;
  actionUrl?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Cria notificação(ões). Best-effort — erros logados, nunca propagados.
 *
 * Uso típico:
 *   await emitNotification({ toRoles: ['admin'], kind: 'enrichment_completed', ... })
 */
export async function emitNotification(input: EmitInput): Promise<void> {
  try {
    let userIds: string[] = input.userIds ?? [];

    if ((!userIds.length) && input.toRoles && input.toRoles.length > 0) {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.role, input.toRoles), eq(users.isActive, true)));
      userIds = rows.map((r) => r.id);
    }

    if (userIds.length === 0) return;

    await db.insert(notifications).values(
      userIds.map((uid) => ({
        userId: uid,
        kind: input.kind,
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl ?? null,
        metadata: input.metadata ?? null,
      })),
    );
  } catch (err) {
    console.warn('[notifications] emit failed:', err instanceof Error ? err.message : err);
  }
}
