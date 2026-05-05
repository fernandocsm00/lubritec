import { GoogleGenAI } from '@google/genai';

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

export async function generateReply(input: GeminiCallInput): Promise<string> {
  const client = getClient();
  const contents = [
    ...input.history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user' as const, parts: [{ text: input.userMessage }] },
  ];

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
    return text.trim();
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    throw new GeminiError(err instanceof Error ? err.message : String(err), err);
  }
}

// Test seam — permite resetar o singleton em testes (quando vi.mock não é usado).
export function _resetGeminiClient(): void {
  _client = null;
}
