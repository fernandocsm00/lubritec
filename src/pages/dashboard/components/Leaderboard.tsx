import type { DashboardLeader } from '@shared/types';

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export function Leaderboard({ data }: { data: DashboardLeader[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Nenhum ganho no período.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-xs uppercase tracking-wider text-slate-500">Top vendedores</h3>
      <ul className="mt-4 space-y-2">
        {data.map((row, idx) => (
          <li key={row.userId} className="flex items-baseline gap-3 text-sm">
            <span className="font-mono text-slate-400">{idx + 1}.</span>
            <span className="flex-1 text-slate-700">{row.name}</span>
            <span className="font-mono text-lc-ink">{fmtBRL(row.wonValue)}</span>
            <span className="font-mono text-xs text-slate-400">({row.wonCount} ✓)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
