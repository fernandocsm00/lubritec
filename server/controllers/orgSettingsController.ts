import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getOrgSettings, updateOrgSettings, loadOrgSettingsRow } from '../services/orgSettingsService';
import { buildSystemPrompt, parseQualificationTag } from '../services/aiAtendimento';
import { generateReplyDetailed } from '../services/geminiClient';

const putBody = z.object({
  monthlySalesGoal: z.number().nonnegative().nullable().optional(),
  aiEnabled: z.boolean().optional(),
  aiAgentName: z.string().min(1).max(120).optional(),
  aiBusinessName: z.string().min(1).max(120).optional(),
  aiBusinessDesc: z.string().max(4000).optional(),
  aiProducts: z.string().max(4000).optional(),
  aiTargetAudience: z.string().max(2000).optional(),
  aiTone: z.string().min(1).max(200).optional(),
  aiObjective: z.string().min(1).max(2000).optional(),
  aiDontTalk: z.string().max(2000).optional(),
  aiAlwaysAsk: z.string().max(2000).optional(),
  aiQualifyWhen: z.string().min(1).max(2000).optional(),
  aiBusinessHours: z.string().max(200).optional(),
  aiAfterHoursMsg: z.string().max(2000).optional(),
  dispatchStartHour: z.number().int().min(0).max(23).optional(),
  dispatchEndHour: z.number().int().min(0).max(24).optional(),
  dispatchSkipWeekends: z.boolean().optional(),
  dispatchTimezone: z.string().min(1).max(64).optional(),
  aiBusinessHoursStart: z.number().int().min(0).max(23).optional(),
  aiBusinessHoursEnd: z.number().int().min(1).max(24).optional(),
  aiBusinessHoursDays: z.string().regex(/^[1-7](,[1-7])*$/).optional(),
  ai24x7: z.boolean().optional(),
});

const testPromptBody = z.object({
  message: z.string().min(1).max(2000),
});

export async function getHandler(_req: Request, res: Response, next: NextFunction) {
  try { res.json(await getOrgSettings()); } catch (e) { next(e); }
}

export async function putHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = putBody.parse(req.body);
    res.json(await updateOrgSettings(body));
  } catch (e) { next(e); }
}

/**
 * Testa o prompt da IA com uma mensagem ficticia sem afetar produção.
 * Usa as settings atuais (salvas) + nao persiste nada. Custos vao pro billing
 * Anthropic/Google normal.
 */
export async function testPromptHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { message } = testPromptBody.parse(req.body);
    const settings = await loadOrgSettingsRow();
    if (!settings) {
      return res.status(404).json({ error: 'org_settings not found' });
    }
    const systemInstruction = buildSystemPrompt(settings, 'João Teste', '5511999999999');
    const t0 = Date.now();
    const result = await generateReplyDetailed({
      systemInstruction,
      history: [],
      userMessage: message,
    });
    const parsed = parseQualificationTag(result.text);
    res.json({
      cleanReply: parsed.cleanReply,
      qualification: parsed.qualification,
      summary: parsed.summary,
      rawReply: result.text,
      model: result.model,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) { next(e); }
}
