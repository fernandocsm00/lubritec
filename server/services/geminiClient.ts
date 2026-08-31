import { GoogleGenAI } from '@google/genai';
import { retry } from '../lib/retry';
import { isTotalLabel } from '../lib/budgetLabel';

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

// Sem timeout, uma chamada lenta ao Gemini fica pendurada até o proxy do
// EasyPanel desistir — e o proxy devolve HTML, não o JSON de erro do app, então
// o usuário via "Request failed (HTTP 502)" sem nenhuma pista da causa.
const GEMINI_TIMEOUT_MS = 20_000;

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
            // O 2.5 Flash vem com thinking LIGADO e os tokens de raciocínio saem do
            // mesmo maxOutputTokens. Com 1024 o modelo podia gastar tudo pensando e
            // devolver texto vazio — que virava "empty response" e 3 retries.
            maxOutputTokens: input.maxOutputTokens ?? 4096,
            httpOptions: { timeout: GEMINI_TIMEOUT_MS },
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
          // Nem timeout: retentar multiplicaria a espera pelo número de tentativas
          // e voltaria a estourar o limite do proxy, que é o que o timeout evita.
          if (/timed? ?out|abort/i.test(err.reason)) return false;
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

// ---------------------------------------------------------------------------
// Visao — leitura do print de orcamento
// ---------------------------------------------------------------------------

export interface BudgetExtraction {
  total: number;
  rotulo: string;
}

const BUDGET_PROMPT = `Você recebe a imagem de um documento enviado por um vendedor.

Responda APENAS com JSON, sem cercas de código, no formato:
{"ehOrcamento": boolean, "total": number|null, "rotulo": string|null}

- ehOrcamento: true somente se a imagem for um ORÇAMENTO/PROPOSTA comercial com valor.
  Foto de produto, print de conversa, comprovante ou nota fiscal => false.
- total: o valor TOTAL DO ORÇAMENTO INTEIRO, como número (ponto decimal, sem
  separador de milhar, sem "R$"). NÃO use o preço de um item da tabela de produtos.
- rotulo: o texto do rótulo exatamente como aparece ao lado do valor que você usou
  (ex: "Valor total"). É o que nos permite verificar que você não pegou a coluna errada.

Se não tiver certeza do total, responda ehOrcamento false.`;

/**
 * Le o valor total de um print de orcamento. Retorna null sempre que houver
 * qualquer duvida — este numero alimenta previsao de receita, entao "nao sugerir"
 * e sempre melhor que "sugerir errado".
 *
 * NAO lanca: quem chama esta num caminho best-effort pos-envio, onde a mensagem
 * ja foi entregue ao cliente e nada aqui pode afetar isso.
 */
export async function extractBudgetFromImage(
  image: Buffer,
  mimeType: string,
): Promise<BudgetExtraction | null> {
  let raw: string;
  try {
    const client = getClient();
    const response = await client.models.generateContent({
      model: MODEL,
      contents: [{
        role: 'user',
        parts: [
          { text: BUDGET_PROMPT },
          { inlineData: { mimeType, data: image.toString('base64') } },
        ],
      }],
      config: {
        temperature: 0,
        // O 2.5 Flash vem com thinking LIGADO por padrao e os tokens de
        // raciocinio saem do mesmo maxOutputTokens. Com teto apertado o modelo
        // gasta tudo pensando e devolve texto VAZIO (finishReason MAX_TOKENS) —
        // foi o que manteve a deteccao 100% muda em producao. Aqui a tarefa e
        // leitura direta de um campo, entao thinking nao agrega: desligamos e
        // deixamos o teto folgado (a resposta tem ~40 tokens).
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    });
    raw = response.text ?? '';
  } catch (err) {
    console.warn('[budget] Gemini falhou:', err instanceof Error ? err.message : err);
    return null;
  }

  // Nunca deve acontecer com o teto atual, mas se acontecer tem que aparecer no
  // log — foi o silencio aqui que escondeu o bug do teto por um dia inteiro.
  if (!raw.trim()) {
    console.warn('[budget] Gemini devolveu resposta vazia — verifique maxOutputTokens/thinking.');
    return null;
  }

  // O modelo as vezes embrulha em ```json apesar da instrucao.
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  let parsed: { ehOrcamento?: unknown; total?: unknown; rotulo?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (parsed.ehOrcamento !== true) return null;
  const total = typeof parsed.total === 'number' ? parsed.total : null;
  if (total === null || !Number.isFinite(total) || total <= 0) return null;
  const rotulo = typeof parsed.rotulo === 'string' ? parsed.rotulo : null;
  if (!isTotalLabel(rotulo)) return null;

  return { total, rotulo: rotulo as string };
}
