import type { CampaignFunnel as TFunnel } from './types';
import { formatCurrency, formatPercent, LOSS_REASON_LABELS } from './helpers';

interface Props { funnel: TFunnel }

export function CampaignFunnel({ funnel }: Props) {
  const total = funnel.totalRecipients;
  const lostByReasonEntries = Object.entries(funnel.lostByReason).filter(([, n]) => n > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2">
        <FunnelCard label="Enviadas" value={funnel.sent} ofTotal={total} tone="primary" />
        <FunnelCard label="Respondidas" value={funnel.replied} ofTotal={total} tone="emerald" />
        <FunnelCard label="Em negociação" value={funnel.inDeal} ofTotal={total} tone="blue" />
        <FunnelCard label="Ganho" value={funnel.won} ofTotal={total} tone="emerald-strong" />
        <FunnelCard label="Perdido" value={funnel.lost} ofTotal={total} tone="destructive" />
      </div>

      {funnel.totalWonValue > 0 && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          <strong>{formatCurrency(funnel.totalWonValue)}</strong> em vendas fechadas
        </div>
      )}

      {lostByReasonEntries.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Motivos de perda:{' '}
          {lostByReasonEntries.map(([k, n]) => (
            <span key={k} className="inline-block mr-3">
              {LOSS_REASON_LABELS[k as keyof typeof LOSS_REASON_LABELS]} ({n})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function FunnelCard({ label, value, ofTotal, tone }: {
  label: string; value: number; ofTotal: number;
  tone: 'primary' | 'emerald' | 'emerald-strong' | 'blue' | 'destructive';
}) {
  const tones = {
    primary: 'bg-primary/10 text-primary border-primary/30',
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    'emerald-strong': 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
    destructive: 'bg-destructive/10 text-destructive border-destructive/30',
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide">{label}</div>
      <div className="text-[10px] opacity-70">{formatPercent(value, ofTotal)}</div>
    </div>
  );
}
