import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Trophy, Zap } from 'lucide-react';
import {
  useTopCampaigns,
  type ReportPeriod,
  type CampaignKind,
  type ReportLeadFilters,
} from './api';
import { formatCurrency, CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONES } from './helpers';

interface Props {
  period: ReportPeriod;
  kind: CampaignKind;
  limit?: number;
  filters?: ReportLeadFilters;
}

/**
 * Tabela das top N campanhas no periodo, ranqueadas por mensagens enviadas.
 * Cada linha tem link pra detalhe da campanha. Replied/won destacam visualmente.
 */
export function TopCampaignsTable({ period, kind, limit = 5, filters }: Props) {
  const { data, isLoading, isError } = useTopCampaigns({ period, kind, limit, filters });

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">
        Falha ao carregar top campanhas.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="p-4 border-b border-border flex items-center gap-2">
        <Trophy className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Top {limit} campanhas</h3>
        <span className="text-[11px] text-muted-foreground ml-auto">por mensagens enviadas</span>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Sem campanhas com atividade no período.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {data.items.map((c) => (
            <Link
              key={c.id}
              to={`/campanhas/${c.id}`}
              className="flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors text-sm"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium truncate">{c.name}</span>
                  {c.isContinuous && (
                    <span title="Campanha contínua" className="inline-flex items-center text-amber-600 dark:text-amber-400">
                      <Zap className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <span
                  className={`inline-block text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${CAMPAIGN_STATUS_TONES[c.status]} mt-1`}
                >
                  {CAMPAIGN_STATUS_LABELS[c.status]}
                </span>
              </div>
              <div className="flex gap-4 text-xs">
                <Stat label="Enviadas" value={c.sent.toLocaleString('pt-BR')} />
                <Stat label="Respostas" value={`${c.replied} (${c.replyRate.toFixed(1)}%)`} tone="emerald" />
                <Stat label="Ganhas" value={c.won.toLocaleString('pt-BR')} tone="emerald-strong" />
                <Stat
                  label="Em vendas"
                  value={c.wonValue > 0 ? formatCurrency(c.wonValue) : '—'}
                  tone="emerald-strong"
                />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'emerald-strong' }) {
  const colorClass = tone === 'emerald'
    ? 'text-emerald-700 dark:text-emerald-400'
    : tone === 'emerald-strong'
      ? 'text-emerald-800 dark:text-emerald-300 font-semibold'
      : 'text-foreground/90';
  return (
    <div className="min-w-[80px] text-right">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`tabular-nums ${colorClass}`}>{value}</div>
    </div>
  );
}
