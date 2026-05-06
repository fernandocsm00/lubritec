import { db } from '../db/client';
import { projectFeedback, users } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { HttpError } from '../middleware/errorHandler';

export type FeedbackStatus = 'open' | 'doing' | 'done' | 'dismissed';

export interface FeedbackImage {
  path: string;
  originalName: string;
}

export async function createFeedback(input: {
  userId: string;
  content: string;
  images: FeedbackImage[];
}) {
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user) throw new HttpError(404, 'User not found');

  const [row] = await db
    .insert(projectFeedback)
    .values({
      userId: input.userId,
      authorName: user.name,
      content: input.content,
      images: input.images,
      status: 'open',
    })
    .returning();
  return row;
}

export async function listFeedback() {
  return db.select().from(projectFeedback).orderBy(desc(projectFeedback.createdAt));
}

export async function updateStatus(id: string, status: FeedbackStatus) {
  const [row] = await db
    .update(projectFeedback)
    .set({ status, updatedAt: new Date() })
    .where(eq(projectFeedback.id, id))
    .returning();
  if (!row) throw new HttpError(404, 'Feedback not found');
  return row;
}

export async function deleteFeedback(id: string, actorId: string, isAdmin: boolean) {
  const [existing] = await db.select().from(projectFeedback).where(eq(projectFeedback.id, id)).limit(1);
  if (!existing) throw new HttpError(404, 'Feedback not found');
  if (!isAdmin && existing.userId !== actorId) {
    throw new HttpError(403, 'Cannot delete feedback from another user');
  }
  await db.delete(projectFeedback).where(eq(projectFeedback.id, id));
}
