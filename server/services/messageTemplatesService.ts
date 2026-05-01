import { db } from '../db/client';
import { messageTemplates, users } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';
import type { PublicMessageTemplate } from '@shared/types';

function toPublic(row: {
  template: typeof messageTemplates.$inferSelect;
  author: typeof users.$inferSelect | null;
}): PublicMessageTemplate {
  return {
    id: row.template.id,
    title: row.template.title,
    body: row.template.body,
    createdBy: row.author
      ? { id: row.author.id, name: row.author.name }
      : { id: row.template.createdBy, name: 'Usuário' },
    createdAt: row.template.createdAt.toISOString(),
    updatedAt: row.template.updatedAt.toISOString(),
  };
}

export async function listTemplates(): Promise<{ items: PublicMessageTemplate[] }> {
  const rows = await db
    .select({ template: messageTemplates, author: users })
    .from(messageTemplates)
    .leftJoin(users, eq(messageTemplates.createdBy, users.id))
    .orderBy(desc(messageTemplates.updatedAt));
  return { items: rows.map(toPublic) };
}

export async function createTemplate(input: {
  title: string;
  body: string;
  userId: string;
}): Promise<PublicMessageTemplate> {
  const [row] = await db
    .insert(messageTemplates)
    .values({ title: input.title, body: input.body, createdBy: input.userId })
    .returning();
  const [author] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  return toPublic({ template: row, author: author ?? null });
}

export async function updateTemplate(input: {
  id: string;
  title?: string;
  body?: string;
}): Promise<PublicMessageTemplate> {
  const patch: { title?: string; body?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) patch.body = input.body;
  const [row] = await db
    .update(messageTemplates)
    .set(patch)
    .where(eq(messageTemplates.id, input.id))
    .returning();
  if (!row) throw new HttpError(404, 'Template not found');
  const [author] = await db.select().from(users).where(eq(users.id, row.createdBy)).limit(1);
  return toPublic({ template: row, author: author ?? null });
}

export async function deleteTemplate(id: string): Promise<void> {
  const [row] = await db
    .delete(messageTemplates)
    .where(eq(messageTemplates.id, id))
    .returning({ id: messageTemplates.id });
  if (!row) throw new HttpError(404, 'Template not found');
}
