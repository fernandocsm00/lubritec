import { Link } from 'react-router-dom';
import { PlugZap } from 'lucide-react';
import type { DashboardWhatsappStats } from '@shared/types';

const fmtSec = (s: number) => {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m ${r}s`;
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-2xl text-lc-ink">{value}</p>
    </div>
  );
}

export function WhatsappStats({ data }: { data: DashboardWhatsappStats }) {
  if (!data.instanceConnected) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-xs uppercase tracking-wider text-slate-500">Atendimento WhatsApp</h3>
        <div className="mt-4 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-lc-ruby/10 text-lc-ruby">
            <PlugZap className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <p className="text-sm text-lc-ink">Instância desconectada</p>
            <p className="text-xs text-slate-500">Mensagens não estão sendo entregues nem recebidas.</p>
          </div>
          <Link to="/settings?tab=whatsapp" className="text-sm text-lc-navy hover:underline">
            Reconectar →
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <h3 className="px-4 pt-4 text-xs uppercase tracking-wider text-slate-500">Atendimento WhatsApp</h3>
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100">
        <Stat label="Em fila"            value={String(data.inQueue)} />
        <Stat label="Tempo méd. resp."   value={fmtSec(data.avgFirstResponseSec)} />
        <Stat label="Expirados >24h"     value={String(data.expired24h)} />
        <Stat label="Sem resposta hoje"  value={String(data.noResponseToday)} />
      </div>
    </div>
  );
}
