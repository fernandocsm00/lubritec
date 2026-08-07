import { Link } from 'react-router-dom';
import type { DashboardAttentionResponse, DashboardAttentionItem } from '@shared/types';
import { AlertTriangle, Clock, Inbox } from 'lucide-react';

const COPY: Record<DashboardAttentionItem['kind'], (n: number) => string> = {
  proposal_old:  (n) => `${n} ${n === 1 ? 'proposta' : 'propostas'} há +14 dias sem retorno`,
  pending_reply: (n) => `${n} ${n === 1 ? 'conversa está' : 'conversas estão'} aguardando nossa resposta`,
  deal_stale:    (n) => `${n} ${n === 1 ? 'deal parado' : 'deals parados'} há +5 dias`,
  queue_pending: (n) => `${n} ${n === 1 ? 'conversa aguardando' : 'conversas aguardando'} no comercial`,
};

const CTA: Record<DashboardAttentionItem['kind'], string> = {
  proposal_old: 'Abrir lista',
  pending_reply:'Abrir inbox',
  deal_stale:   'Abrir kanban',
  queue_pending:'Abrir inbox',
};

const ICON: Record<DashboardAttentionItem['kind'], React.ComponentType<{ className?: string }>> = {
  proposal_old:  Clock,
  pending_reply: AlertTriangle,
  deal_stale:    Clock,
  queue_pending: Inbox,
};

const SEV_BG: Record<DashboardAttentionItem['severity'], string> = {
  critical: 'bg-lc-ruby/10 text-lc-ruby',
  warning:  'bg-amber-100 text-amber-700',
  info:     'bg-amber-50 text-amber-600',
};

function buildHref(item: DashboardAttentionItem): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(item.filter)) params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${item.route}?${qs}` : item.route;
}

export function AttentionList({ data }: { data: DashboardAttentionResponse }) {
  if (data.items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-emerald-600">
        ✅ Nada exigindo atenção agora.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <ul className="divide-y divide-slate-100">
        {data.items.slice(0, 5).map((item) => {
          const Icon = ICON[item.kind];
          return (
            <li key={item.kind} className="flex items-center gap-3 px-4 py-3">
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${SEV_BG[item.severity]}`}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex-1 text-sm text-lc-ink">{COPY[item.kind](item.count)}</span>
              <Link
                to={buildHref(item)}
                className="text-sm text-lc-navy hover:underline"
              >
                {CTA[item.kind]}
              </Link>
            </li>
          );
        })}
      </ul>
      {data.items.length > 5 && (
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
          + {data.items.length - 5} outros alertas
        </p>
      )}
    </div>
  );
}
