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
    let systemInstruction: string;
    try {
      systemInstruction = buildSystemPrompt(settings, 'João Teste', '5511999999999');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error('[test-ai-prompt] buildSystemPrompt failed:', err);
      return res.status(500).json({
        error: 'Falha ao montar system prompt',
        detail: reason,
        hint: 'Provavelmente algum campo de org_settings esta null/invalido. Veja o log.',
      });
    }
    const t0 = Date.now();
    let result;
    try {
      result = await generateReplyDetailed({
        systemInstruction,
        history: [],
        userMessage: message,
      });
    } catch (geminiErr) {
      // Endpoint de debug: retorna mensagem real do erro pro usuario
      // (em vez de cair no errorHandler como "Internal server error" generico).
      const reason = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
      console.error('[test-ai-prompt] gemini failed:', geminiErr);
      const lower = reason.toLowerCase();
      const hint = lower.includes('gemini_api_key')
        ? 'Configure GEMINI_API_KEY no .env do servidor.'
        : lower.includes('api key') || lower.includes('permission') || lower.includes('unauthorized')
          ? 'GEMINI_API_KEY parece invalida ou sem permissao.'
          : lower.includes('quota') || lower.includes('rate')
            ? 'Quota/rate limit do Gemini atingido.'
            : 'Veja o log do servidor pro stack trace completo.';
      return res.status(502).json({
        error: 'Falha ao chamar Gemini',
        detail: reason,
        hint,
      });
    }
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
  } catch (e) {
    console.error('[test-ai-prompt] unexpected error:', e);
    next(e);
  }
}
