import { db } from '../db/client';
import { aiCallLogs } from '../db/schema';
import { sql, and, gte, lt, eq, isNotNull } from 'drizzle-orm';

/**
 * Preços oficiais Gemini Flash 2.5 (USD por milhão de tokens).
 * https://ai.google.dev/gemini-api/docs/pricing
 *
 * Atualização manual quando o Google ajustar tabela.
 */
const GEMINI_FLASH_25_INPUT_PER_M = 0.075;   // $0.075/M tokens input
const GEMINI_FLASH_25_OUTPUT_PER_M = 0.30;   // $0.30/M tokens output

export function computeCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * GEMINI_FLASH_25_INPUT_PER_M +
    (outputTokens / 1_000_000) * GEMINI_FLASH_25_OUTPUT_PER_M
  );
}

export interface RecordAiCallInput {
  conversationId: string | null;
  leadId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  qualified: boolean;
  humanIntent?: boolean;
  error?: string;
  // Audit fields (Sprint Calibracao IA)
  decisionReason?: string | null;
  qualificationPath?: 'campaign_direct' | 'conversation' | null;
  questionsAnswers?: Array<{ question: string; answer: string; consideredAt: string }>;
  promptVersion?: string | null;
  campaignId?: string | null;
}

/**
 * Best-effort — erros logados, nunca propagados (não pode quebrar o fluxo da IA).
 */
export async function recordAiCall(input: RecordAiCallInput): Promise<void> {
  try {
    const cost = computeCostUsd(input.inputTokens, input.outputTokens);
    await db.insert(aiCallLogs).values({
      conversationId: input.conversationId,
      leadId: input.leadId,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd: cost.toFixed(6),
      latencyMs: input.latencyMs,
      qualified: input.qualified,
      humanIntent: input.humanIntent ?? false,
      error: input.error ?? null,
      decisionReason: input.decisionReason ?? null,
      qualificationPath: input.qualificationPath ?? null,
      questionsAnswers: input.questionsAnswers ?? [],
      promptVersion: input.promptVersion ?? null,
      campaignId: input.campaignId ?? null,
    });
  } catch (err) {
    console.warn('[ai-metrics] recordAiCall failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Conta quantas chamadas com erro foram registradas pra uma conversa nos
 * ultimos `windowMs` milissegundos. Usado pelo fallback de fallback IA:
 * se 3+ erros consecutivos, conversa eh movida pra recepcao humana.
 */
export async function countRecentErrorsForConversation(
  conversationId: string,
  windowMs: number,
): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiCallLogs)
    .where(
      and(
        eq(aiCallLogs.conversationId, conversationId),
        isNotNull(aiCallLogs.error),
        gte(aiCallLogs.createdAt, since),
      ),
    );
  return Number(row?.n ?? 0);
}

export interface AiMetricsSummary {
  period: { start: string; end: string };
  totalCalls: number;
  qualifiedCount: number;
  qualifyRate: number;          // % qualifiedCount / totalCalls (text inbound only)
  humanIntentCount: number;
  errorCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  avgCostPerCallUsd: number;
  avgCostPerQualifiedUsd: number | null;
}

export async function getAiMetricsSummary(args: {
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<AiMetricsSummary> {
  const { rangeStart, rangeEnd } = args;

  // Filtra entradas de reanalysis-stub (gravadas por requestReanalysis no
  // caseSheetService) — nao sao chamadas reais da IA e poluiriam metricas
  // de totalCalls, avgLatency, avgCostPerCall etc.
  const [row] = await db
    .select({
      totalCalls: sql<number>`count(*)::int`,
      qualifiedCount: sql<number>`count(*) filter (where ${aiCallLogs.qualified} = true)::int`,
      humanIntentCount: sql<number>`count(*) filter (where ${aiCallLogs.humanIntent} = true)::int`,
      errorCount: sql<number>`count(*) filter (where ${aiCallLogs.error} is not null)::int`,
      totalInputTokens: sql<number>`coalesce(sum(${aiCallLogs.inputTokens}), 0)::int`,
      totalOutputTokens: sql<number>`coalesce(sum(${aiCallLogs.outputTokens}), 0)::int`,
      totalCostUsd: sql<string>`coalesce(sum(${aiCallLogs.costUsd}), 0)`,
      avgLatencyMs: sql<number>`coalesce(round(avg(${aiCallLogs.latencyMs}))::int, 0)`,
    })
    .from(aiCallLogs)
    .where(and(
      gte(aiCallLogs.createdAt, rangeStart),
      lt(aiCallLogs.createdAt, rangeEnd),
      sql`${aiCallLogs.model} <> 'reanalysis-stub'`,
    ));

  const total = row.totalCalls;
  const qualified = row.qualifiedCount;
  const totalCost = Number(row.totalCostUsd);
  return {
    period: { start: rangeStart.toISOString(), end: rangeEnd.toISOString() },
    totalCalls: total,
    qualifiedCount: qualified,
    qualifyRate: total === 0 ? 0 : Math.round((qualified / total) * 1000) / 10,
    humanIntentCount: row.humanIntentCount,
    errorCount: row.errorCount,
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
    avgLatencyMs: row.avgLatencyMs,
    avgCostPerCallUsd: total === 0 ? 0 : Math.round((totalCost / total) * 1_000_000) / 1_000_000,
    avgCostPerQualifiedUsd: qualified === 0 ? null : Math.round((totalCost / qualified) * 1_000_000) / 1_000_000,
  };
}
