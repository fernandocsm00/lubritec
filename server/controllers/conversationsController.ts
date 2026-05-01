import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  CONVERSATION_QUEUES,
  CONVERSATION_STATUSES,
  ORIGIN_KINDS,
  MESSAGE_KINDS,
} from '../../shared/types';
import {
  listConversations,
  getConversationCounts,
  getConversationById,
  listMessages,
  claimConversation,
  changeQueue,
  closeConversation,
  markRead,
  sendMessage,
} from '../services/conversationsService';

const csvOf = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .transform((s) => s.split(',').map((p) => p.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values as readonly [T, ...T[]])).min(1));

const listQuery = z.object({
  queue: z.enum(CONVERSATION_QUEUES).optional(),
  status: csvOf(CONVERSATION_STATUSES).optional(),
  expired24h: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  noResponse: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  origin: csvOf(ORIGIN_KINDS).optional(),
  campaignId: z.string().uuid().optional(),
  assignment: z.enum(['mine', 'unassigned', 'all']).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

const idParams = z.object({ id: z.string().uuid() });

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const params = listQuery.parse(req.query);
    const result = await listConversations({
      ...params,
      currentUserId: req.user!.userId,
    });
    res.json(result);
  } catch (e) { next(e); }
}

export async function countsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getConversationCounts());
  } catch (e) { next(e); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await getConversationById(id, req.user!.userId));
  } catch (e) { next(e); }
}

const messagesQuery = z.object({
  before: z.string().datetime().optional(),
});

export async function listMessagesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const { before } = messagesQuery.parse(req.query);
    const result = await listMessages(id, before ? new Date(before) : undefined);
    res.json(result);
  } catch (e) { next(e); }
}

const queueBody = z.object({ queue: z.enum(CONVERSATION_QUEUES) });

export async function claimHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await claimConversation(id, req.user!.userId));
  } catch (e) { next(e); }
}

export async function queueHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const { queue } = queueBody.parse(req.body);
    res.json(await changeQueue(id, queue, req.user!.userId));
  } catch (e) { next(e); }
}

export async function closeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await closeConversation(id, req.user!.userId));
  } catch (e) { next(e); }
}

export async function readHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await markRead(id, req.user!.userId));
  } catch (e) { next(e); }
}

const sendBody = z
  .object({
    kind: z.enum(MESSAGE_KINDS),
    body: z.string().max(4000).optional(),
    mediaUrl: z.string().url().optional(),
    mediaMime: z.string().max(120).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === 'text' && !d.body) {
      ctx.addIssue({ code: 'custom', message: 'body is required for kind=text', path: ['body'] });
    }
    if (d.kind !== 'text' && !d.mediaUrl) {
      ctx.addIssue({ code: 'custom', message: 'mediaUrl is required for media kinds', path: ['mediaUrl'] });
    }
  });

export async function sendMessageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const data = sendBody.parse(req.body);
    const msg = await sendMessage({
      conversationId: id,
      userId: req.user!.userId,
      kind: data.kind,
      body: data.body ?? null,
      mediaUrl: data.mediaUrl ?? null,
      mediaMime: data.mediaMime ?? null,
    });
    res.json(msg);
  } catch (e) { next(e); }
}
