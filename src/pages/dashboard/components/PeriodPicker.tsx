import type { DashboardPeriod } from '@shared/types';

const OPTIONS: [DashboardPeriod, string][] = [
  ['today', 'Hoje'],
  ['7d', 'Últimos 7 dias'],
  ['month', 'Mês corrente'],
  ['30d', 'Últimos 30 dias'],
  ['quarter', 'Trimestre atual'],
];

export function PeriodPicker({ value, onChange }: { value: DashboardPeriod; onChange: (v: DashboardPeriod) => void }) {
  return (
    <div className="flex flex-col items-end">
      <label className="text-xs uppercase tracking-wider text-slate-500 mb-1">Período</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as DashboardPeriod)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-lc-navy focus:outline-none"
      >
        {OPTIONS.map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
      <span className="mt-1 text-xs text-slate-400">vs período anterior</span>
    </div>
  );
}
