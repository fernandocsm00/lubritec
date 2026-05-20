import { GoogleGenAI } from '@google/genai';
import { retry } from '../lib/retry';

/**
 * Cliente Gemini Flash 2.5 — IA de atendimento.
 *
 * Lê a chave de GEMINI_API_KEY (sem fallback). Em dev/test você pode mockar
 * o módulo todo via vi.mock pra evitar chamadas reais.
 */

export interface GeminiMessage {
  role: 'user' | 'model';
  text: string;
}

export interface GeminiCallInput {
  systemInstruction: string;
  history: GeminiMessage[];
  userMessage: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GeminiCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  latencyMs: number;
}

export class GeminiError extends Error {
  constructor(public reason: string, public cause?: unknown) {
    super(`GeminiError: ${reason}`);
  }
}

let _client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (_client) return _client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiError('GEMINI_API_KEY env var not set');
  }
  _client = new GoogleGenAI({ apiKey });
  return _client;
}

const MODEL = 'gemini-2.5-flash';

/**
 * Backwards-compat — código antigo só queria texto.
 */
export async function generateReply(input: GeminiCallInput): Promise<string> {
  const r = await generateReplyDetailed(input);
  return r.text;
}

/**
 * Versão completa — retorna texto + tokens + latência pra logging/billing.
 */
export async function generateReplyDetailed(input: GeminiCallInput): Promise<GeminiCallResult> {
  const client = getClient();
  const contents = [
    ...input.history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user' as const, parts: [{ text: input.userMessage }] },
  ];

  return retry(
    async () => {
      const startedAt = Date.now();
      try {
        const response = await client.models.generateContent({
          model: MODEL,
          contents,
          config: {
            systemInstruction: input.systemInstruction,
            temperature: input.temperature ?? 0.4,
            maxOutputTokens: input.maxOutputTokens ?? 1024,
          },
        });
        const text = response.text ?? '';
        if (!text.trim()) {
          throw new GeminiError('empty response from Gemini');
        }
        const usage = response.usageMetadata ?? {};
        return {
          text: text.trim(),
          inputTokens: Number(usage.promptTokenCount ?? 0),
          outputTokens: Number(usage.candidatesTokenCount ?? 0),
          model: MODEL,
          latencyMs: Date.now() - startedAt,
        };
      } catch (err) {
        if (err instanceof GeminiError) throw err;
        throw new GeminiError(err instanceof Error ? err.message : String(err), err);
      }
    },
    {
      attempts: 3,
      baseDelayMs: 500,
      shouldRetry: (err) => {
        if (err instanceof GeminiError) {
          // Não retentar erro de configuração (sem API key).
          if (err.reason.includes('GEMINI_API_KEY')) return false;
        }
        return true;
      },
    },
  );
}

// Test seam — permite resetar o singleton em testes (quando vi.mock não é usado).
export function _resetGeminiClient(): void {
  _client = null;
}
