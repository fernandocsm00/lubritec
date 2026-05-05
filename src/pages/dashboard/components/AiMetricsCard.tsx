import { Bot, TrendingUp, AlertTriangle, UserMinus, DollarSign, Clock, Target } from 'lucide-react';
import type { AiMetricsSummary } from '@shared/types';

function formatUsd(v: number): string {
  if (v < 0.01) return `$${v.toFixed(6)}`;
  if (v < 1) return `$${v.toFixed(4)}`;
  if (v < 100) return `$${v.toFixed(2)}`;
  return `$${Math.round(v).toLocaleString('pt-BR')}`;
}

function formatTokens(v: number): string {
  if (v < 1_000) return String(v);
  if (v < 1_000_000) return `${(v / 1_000).toFixed(1)}K`;
  return `${(v / 1_000_000).toFixed(2)}M`;
}

function formatLatency(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(2)}s`;
}

export function AiMetricsCard({ data }: { data: AiMetricsSummary }) {
  const items = [
    {
      Icon: Bot,
      label: 'Chamadas IA',
      value: data.totalCalls.toLocaleString('pt-BR'),
      hint: `${data.errorCount} erros`,
      tone: 'sky' as const,
    },
    {
      Icon: Target,
      label: 'Taxa de qualificação',
      value: `${data.qualifyRate.toFixed(1)}%`,
      hint: `${data.qualifiedCount} qualificados`,
      tone: 'emerald' as const,
    },
    {
      Icon: DollarSign,
      label: 'Custo total',
      value: formatUsd(data.totalCostUsd),
      hint: `${formatTokens(data.totalInputTokens + data.totalOutputTokens)} tokens`,
      tone: 'violet' as const,
    },
    {
      Icon: Clock,
      label: 'Latência média',
      value: formatLatency(data.avgLatencyMs),
      hint: 'por resposta',
      tone: 'slate' as const,
    },
    {
      Icon: TrendingUp,
      label: 'Custo / qualificação',
      value: data.avgCostPerQualifiedUsd != null ? formatUsd(data.avgCostPerQualifiedUsd) : '—',
      hint: data.avgCostPerQualifiedUsd != null ? 'média' : 'sem qualificações',
      tone: 'emerald' as const,
    },
    {
      Icon: UserMinus,
      label: 'Pediram humano',
      value: data.humanIntentCount.toLocaleString('pt-BR'),
      hint: data.totalCalls > 0
        ? `${((data.humanIntentCount / data.totalCalls) * 100).toFixed(1)}% das interações`
        : '—',
      tone: 'amber' as const,
    },
  ];

  const TONE: Record<'sky' | 'emerald' | 'violet' | 'slate' | 'amber', string> = {
    sky:     'text-sky-600 dark:text-sky-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    violet:  'text-violet-600 dark:text-violet-400',
    slate:   'text-slate-600 dark:text-slate-400',
    amber:   'text-amber-600 dark:text-amber-400',
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5" /> Métricas da IA de atendimento
        </h3>
        {data.errorCount > 0 && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {data.errorCount} erros no período
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase text-slate-500 dark:text-slate-400">
              <it.Icon className={`h-3 w-3 ${TONE[it.tone]}`} />
              {it.label}
            </div>
            <div className="font-mono text-lg font-semibold mt-0.5">{it.value}</div>
            <div className="text-[10px] text-muted-foreground">{it.hint}</div>
          </div>
        ))}
      </div>

      {data.totalCalls === 0 && (
        <p className="text-[11px] text-muted-foreground text-center mt-3">
          Nenhuma chamada à IA no período selecionado.
        </p>
      )}
    </div>
  );
}
