import type { DashboardSummary } from '@shared/types';

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const STAGE_LABEL: Record<string, string> = {
  proposta_enviada: 'Proposta enviada',
  em_negociacao:    'Em negociação',
};

export function PipelineOpen({ data }: { data: DashboardSummary['pipelineOpen'] }) {
  if (data.byStage.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Nenhum deal aberto.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-xs uppercase tracking-wider text-slate-500">Pipeline em aberto</h3>
      <ul className="mt-4 space-y-2 text-sm">
        {data.byStage.map((s) => (
          <li key={s.stage} className="flex items-baseline justify-between">
            <span className="text-slate-700">{STAGE_LABEL[s.stage] ?? s.stage}</span>
            <span className="font-mono text-lc-ink">{fmtBRL(s.valueSum)} <span className="text-slate-400">({s.count})</span></span>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-slate-100 pt-3 text-sm flex items-baseline justify-between">
        <span className="text-slate-500">Total aberto</span>
        <span className="font-mono text-lc-ink">{fmtBRL(data.totalValue)}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">Idade média {data.avgAgeDays.toFixed(1)} dias</p>
    </div>
  );
}
