import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  CONVERSATION_QUEUES,
  CONVERSATION_STATUSES,
  ORIGIN_KINDS,
  MESSAGE_KINDS,
  UF_VALUES,
} from '../../shared/types';
import {
  listConversations,
  getConversationCounts,
  getConversationById,
  getConversationByLeadId,
  listMessages,
  claimConversation,
  assignConversation,
  changeQueue,
  setConversationAi,
  closeConversation,
  markRead,
  sendMessage,
  startConversation,
  deleteOutboundMessage,
  editOutboundMessage,
} from '../services/conversationsService';

import { ensureSendableAudio } from '../lib/audioConvert';

const csvOf = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .transform((s) => s.split(',').map((p) => p.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values as readonly [T, ...T[]])).min(1));

const listQuery = z.object({
  queue: z.enum(CONVERSATION_QUEUES).optional(),
  status: csvOf(CONVERSATION_STATUSES).optional(),
  awaitingUs: z.coerce.boolean().optional(),
  noResponse: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  onlyWithInbound: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  origin: csvOf(ORIGIN_KINDS).optional(),
  campaignId: z.string().uuid().optional(),
  assignment: z.enum(['mine', 'unassigned', 'all']).optional(),
  uf: z.enum(UF_VALUES).optional(),
  instanceId: z.string().uuid().optional(),
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

const countsQuery = z.object({ instanceId: z.string().uuid().optional() });

export async function countsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { instanceId } = countsQuery.parse(req.query);
    res.json(await getConversationCounts(instanceId));
  } catch (e) { next(e); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    res.json(await getConversationById(id, req.user!.userId));
  } catch (e) { next(e); }
}

const leadIdParams = z.object({ leadId: z.string().uuid() });

export async function byLeadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { leadId } = leadIdParams.parse(req.params);
    const conv = await getConversationByLeadId(leadId);
    if (!conv) {
      return res.status(404).json({ error: 'No conversation for this lead' });
    }
    res.json(conv);
  } catch (e) { next(e); }
}

const messagesQuery = z.object({
  before: z.string().datetime().optional(),
  // Segunda metade do cursor — desempata mensagens gravadas no mesmo instante.
  beforeId: z.string().uuid().optional(),
});

export async function listMessagesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const { before, beforeId } = messagesQuery.parse(req.query);
    const result = await listMessages(id, before ? new Date(before) : undefined, beforeId);
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

const assignBody = z.object({ userId: z.string().uuid().nullable() });

export async function assignHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const { userId } = assignBody.parse(req.body);
    res.json(await assignConversation(id, userId, req.user!.userId));
  } catch (e) { next(e); }
}

export async function queueHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const { queue } = queueBody.parse(req.body);
    res.json(await changeQueue(id, queue, req.user!.userId));
  } catch (e) { next(e); }
}

const aiBody = z.object({ enabled: z.boolean() });

export async function setAiHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = idParams.parse(req.params);
    const { enabled } = aiBody.parse(req.body);
    res.json(await setConversationAi(id, enabled, req.user!.userId));
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

// mediaUrl pode vir como URL absoluta (uploads externos / por URL) ou como
// caminho relativo /uploads/conversations/... gerado pelo nosso próprio
// endpoint POST /conversations/upload-media. z.string().url() rejeitava
// silenciosamente os relativos e quebrava o anexo da inbox.
const mediaUrlSchema = z
  .string()
  .max(2048)
  .refine(
    (v) => v.startsWith('/uploads/') || /^https?:\/\//i.test(v),
    { message: 'mediaUrl must be absolute http(s) or a /uploads/ path' },
  );

const sendBody = z
  .object({
    kind: z.enum(MESSAGE_KINDS),
    body: z.string().max(4000).optional(),
    mediaUrl: mediaUrlSchema.optional(),
    mediaMime: z.string().max(120).optional(),
    replyToMessageId: z.string().uuid().optional(),
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
      replyToMessageId: data.replyToMessageId ?? null,
      appBaseUrl: `${req.protocol}://${req.get('host')}`,
    });
    res.json(msg);
  } catch (e) { next(e); }
}

const startHsmVariableSchema = z.object({
  index: z.number().int().min(1),
  source: z.enum(['static', 'lead_field']),
  value: z.string(),
});

const startBody = z
  .object({
    phone: z.string().min(1).max(32),
    name: z.string().max(120).optional(),
    kind: z.enum(MESSAGE_KINDS),
    body: z.string().max(4000).optional(),
    mediaUrl: mediaUrlSchema.optional(),
    mediaMime: z.string().max(120).optional(),
    instanceId: z.string().uuid().optional(),
    hsmTemplateId: z.string().uuid().optional(),
    hsmVariables: z.array(startHsmVariableSchema).optional(),
  })
  .superRefine((d, ctx) => {
    // Quando dispara template HSM, o conteúdo vem do template — texto/mídia
    // não são exigidos. As validações de texto/mídia só valem fora desse caso.
    if (d.hsmTemplateId) return;
    if (d.kind === 'text' && !d.body) {
      ctx.addIssue({ code: 'custom', message: 'body is required for kind=text', path: ['body'] });
    }
    if (d.kind !== 'text' && !d.mediaUrl) {
      ctx.addIssue({ code: 'custom', message: 'mediaUrl is required for media kinds', path: ['mediaUrl'] });
    }
  });

export async function startConversationHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = startBody.parse(req.body);
    const result = await startConversation({
      userId: req.user!.userId,
      phone: data.phone,
      name: data.name ?? null,
      kind: data.kind,
      body: data.body ?? null,
      mediaUrl: data.mediaUrl ?? null,
      mediaMime: data.mediaMime ?? null,
      appBaseUrl: `${req.protocol}://${req.get('host')}`,
      instanceId: data.instanceId ?? null,
      hsmTemplateId: data.hsmTemplateId ?? null,
      hsmVariables: data.hsmVariables ?? null,
    });
    res.json(result);
  } catch (e) { next(e); }
}

const msgIdParams = z.object({ id: z.string().uuid(), msgId: z.string().uuid() });
const editBody = z.object({ body: z.string().min(1).max(4000) });

export async function deleteMessageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { msgId } = msgIdParams.parse(req.params);
    res.json(await deleteOutboundMessage(msgId, req.user!.userId));
  } catch (e) { next(e); }
}

export async function editMessageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { msgId } = msgIdParams.parse(req.params);
    const { body } = editBody.parse(req.body);
    res.json(await editOutboundMessage(msgId, req.user!.userId, body));
  } catch (e) { next(e); }
}

export async function uploadMediaHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Invalid or missing file' });
    }
    // Áudio gravado no navegador vem em webm/opus — a Meta não aceita. Converte
    // pra ogg/opus (formatos já aceitos passam direto).
    const { filename, mimetype } = await ensureSendableAudio({
      path: req.file.path,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
    });
    res.json({
      mediaUrl: `/uploads/conversations/${filename}`,
      mediaMime: mimetype,
    });
  } catch (e) { next(e); }
}
