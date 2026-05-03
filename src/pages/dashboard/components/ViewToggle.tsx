import type { DashboardView } from '@shared/types';

export function ViewToggle({ value, onChange }: { value: DashboardView; onChange: (v: DashboardView) => void }) {
  return (
    <div role="group" aria-label="Modo de visualização" className="inline-flex rounded-lg bg-slate-100 p-1 text-sm">
      {([
        ['org', 'Visão da operação'],
        ['me',  'Meu pipeline'],
      ] as const).map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            value === v ? 'bg-white shadow-sm text-lc-ink font-medium' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
