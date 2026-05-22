import { XCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useCampaignsAggregateStats, type ReportPeriod, type CampaignKind } from './api';
import { LOSS_REASON_LABELS } from './helpers';
import type { LossReason } from './types';

interface Props {
  period: ReportPeriod;
  kind: CampaignKind;
}

/**
 * Distribuicao de motivos de perda no periodo. Barras horizontais simples (CSS)
 * com contagem e percentual sobre total de perdidos. Util pra entender "por que
 * leads caem" — informa prompt da IA e abordagem comercial.
 */
export function LossReasonsCard({ period, kind }: Props) {
  const { data, isLoading } = useCampaignsAggregateStats({ period, kind });

  const total = data ? Object.values(data.lostByReason).reduce((a, b) => a + b, 0) : 0;
  const items: { reason: LossReason; n: number; pct: number }[] = data
    ? (Object.entries(data.lostByReason) as [LossReason, number][])
        .map(([reason, n]) => ({ reason, n, pct: total === 0 ? 0 : (n / total) * 100 }))
        .sort((a, b) => b.n - a.n)
    : [];

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <XCircle className="h-4 w-4 text-destructive" />
        <h3 className="text-sm font-semibold">Motivos de perda</h3>
        {!isLoading && data && (
          <span className="text-[11px] text-muted-foreground ml-auto">
            {total} deal{total === 1 ? '' : 's'} perdido{total === 1 ? '' : 's'} no período
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
        </div>
      ) : total === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">
          Nenhum deal perdido no período. Bom sinal!
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.reason}>
              <div className="flex items-baseline justify-between text-xs mb-1">
                <span className="text-foreground/90">{LOSS_REASON_LABELS[item.reason]}</span>
                <span className="text-muted-foreground tabular-nums">
                  {item.n} · {item.pct.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-destructive/60"
                  style={{ width: `${item.pct}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
