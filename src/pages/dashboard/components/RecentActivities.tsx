import type { DashboardRecentActivity } from '@shared/types';
import { Link } from 'react-router-dom';

const KIND_LABEL: Record<string, string> = {
  created: 'criou',
  stage_changed: 'mudou etapa',
  value_changed: 'alterou valor',
  note_added: 'adicionou nota',
  won: 'marcou como ganho',
  lost: 'marcou como perdido',
  reactivated: 'reativou',
  owner_changed: 'mudou owner',
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export function RecentActivities({ data }: { data: DashboardRecentActivity[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Sem atividade recente.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-xs uppercase tracking-wider text-slate-500">Atividades recentes</h3>
      <ul className="mt-4 space-y-2 text-sm">
        {data.map((a) => (
          <li key={a.id} className="flex items-baseline justify-between gap-3">
            <span className="flex-1 text-slate-700 truncate">
              <Link to={`/inside-sales`} className="text-lc-navy hover:underline">{a.leadName}</Link>
              <span className="text-slate-500"> — {KIND_LABEL[a.kind] ?? a.kind}</span>
            </span>
            <span className="font-mono text-xs text-slate-400 shrink-0">{fmtTime(a.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
