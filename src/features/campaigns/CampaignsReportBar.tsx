import { Megaphone, Send, MessageSquareReply, TrendingUp, Trophy, DollarSign } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCampaignsAggregateStats,
  type ReportPeriod,
  type CampaignKind,
} from './api';
import { formatCurrency } from './helpers';

interface Props {
  period?: ReportPeriod;
  kind?: CampaignKind;
  /** Quando true, busca tambem o periodo anterior e exibe Δ% em cada KPI. */
  compare?: boolean;
}

/**
 * Card de relatorio agregado das campanhas — exibido no topo da pagina /campanhas
 * e tambem na pagina dedicada /campanhas/relatorio (com period/kind/compare).
 * Mostra o panorama global em 6 KPIs.
 */
export function CampaignsReportBar({ period = '30d', kind = 'all', compare = false }: Props) {
  const { data, isLoading, isError } = useCampaignsAggregateStats({ period, kind, compare });

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive mb-4">
        Falha ao carregar relatório. Tente recarregar a página.
      </div>
    );
  }

  const prev = data?.compareWith;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
      <Kpi
        icon={<Megaphone className="h-4 w-4" />}
        label="Campanhas"
        value={data?.totalCampaigns ?? 0}
        prev={prev?.totalCampaigns}
        sub={data ? `${data.completedCampaigns} concl. · ${data.activeCampaigns} ativ.` : undefined}
        loading={isLoading}
        tone="primary"
      />
      <Kpi
        icon={<Send className="h-4 w-4" />}
        label="Mensagens enviadas"
        value={data?.totalSent ?? 0}
        prev={prev?.totalSent}
        loading={isLoading}
        tone="primary"
      />
      <Kpi
        icon={<MessageSquareReply className="h-4 w-4" />}
        label="Respostas"
        value={data?.totalReplied ?? 0}
        prev={prev?.totalReplied}
        sub={data && data.totalSent > 0 ? `${data.replyRate.toFixed(1)}% taxa` : undefined}
        loading={isLoading}
        tone="emerald"
      />
      <Kpi
        icon={<TrendingUp className="h-4 w-4" />}
        label="Em negociação"
        value={data?.totalInDeal ?? 0}
        prev={prev?.totalInDeal}
        loading={isLoading}
        tone="blue"
      />
      <Kpi
        icon={<Trophy className="h-4 w-4" />}
        label="Ganhas"
        value={data?.totalWon ?? 0}
        prev={prev?.totalWon}
        sub={data && data.totalSent > 0 ? `${data.conversionRate.toFixed(1)}% conv.` : undefined}
        loading={isLoading}
        tone="emerald-strong"
      />
      <Kpi
        icon={<DollarSign className="h-4 w-4" />}
        label="Em vendas"
        value={data ? formatCurrency(data.totalWonValue) : 'R$ 0'}
        prev={prev?.totalWonValue}
        rawValue={data?.totalWonValue}
        loading={isLoading}
        tone="emerald-strong"
      />
    </div>
  );
}

interface KpiProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  /** Valor do periodo anterior, para calculo de delta. */
  prev?: number;
  /** Quando value eh string formatada (ex: currency), passa o numero cru aqui pra delta. */
  rawValue?: number;
  sub?: string;
  loading?: boolean;
  tone: 'primary' | 'emerald' | 'emerald-strong' | 'blue';
}

function Kpi({ icon, label, value, prev, rawValue, sub, loading, tone }: KpiProps) {
  const tones = {
    primary: 'bg-primary/5 text-primary border-primary/20',
    emerald: 'bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
    'emerald-strong': 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30',
    blue: 'bg-blue-500/5 text-blue-700 dark:text-blue-400 border-blue-500/20',
  };

  // Delta: usa rawValue se value eh string formatada.
  const current = typeof value === 'number' ? value : (rawValue ?? null);
  const delta = current != null && prev != null ? computeDelta(current, prev) : null;

  return (
    <div className={`rounded-lg border p-3 flex flex-col gap-1 ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide opacity-80">
        {icon}
        <span>{label}</span>
      </div>
      {loading ? (
        <Skeleton className="h-7 w-16 mt-0.5" />
      ) : (
        <div className="text-xl font-semibold leading-tight">{value}</div>
      )}
      <div className="flex items-center gap-2 text-[10px] opacity-80">
        {sub && !loading && <span>{sub}</span>}
        {delta && !loading && (
          <span
            className={
              delta.dir === 'up'
                ? 'text-emerald-700 dark:text-emerald-400'
                : delta.dir === 'down'
                  ? 'text-destructive'
                  : 'text-muted-foreground'
            }
            title={`Período anterior: ${typeof value === 'number' ? prev : formatCurrency(prev ?? 0)}`}
          >
            {delta.label}
          </span>
        )}
      </div>
    </div>
  );
}

function computeDelta(current: number, prev: number): { dir: 'up' | 'down' | 'flat'; label: string } {
  if (prev === 0 && current === 0) return { dir: 'flat', label: '—' };
  if (prev === 0) return { dir: 'up', label: 'novo' };
  const pct = ((current - prev) / prev) * 100;
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  const arrow = rounded > 0 ? '↑' : rounded < 0 ? '↓' : '·';
  return {
    dir: rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat',
    label: `${arrow} ${sign}${rounded.toFixed(1)}%`,
  };
}
