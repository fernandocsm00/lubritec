import { Megaphone, Send, MessageSquareReply, TrendingUp, Trophy, DollarSign } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useCampaignsAggregateStats } from './api';
import { formatCurrency } from './helpers';

/**
 * Card de relatorio agregado das campanhas — exibido no topo da pagina /campanhas.
 * Mostra o panorama global em 6 KPIs. Para drill-down por campanha, abrir cada
 * uma na lista (que ja exibe o CampaignFunnel detalhado).
 */
export function CampaignsReportBar() {
  const { data, isLoading, isError } = useCampaignsAggregateStats();

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive mb-4">
        Falha ao carregar relatório. Tente recarregar a página.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
      <Kpi
        icon={<Megaphone className="h-4 w-4" />}
        label="Campanhas"
        value={data?.totalCampaigns ?? 0}
        sub={data ? `${data.completedCampaigns} concl. · ${data.activeCampaigns} ativ.` : undefined}
        loading={isLoading}
        tone="primary"
      />
      <Kpi
        icon={<Send className="h-4 w-4" />}
        label="Mensagens enviadas"
        value={data?.totalSent ?? 0}
        loading={isLoading}
        tone="primary"
      />
      <Kpi
        icon={<MessageSquareReply className="h-4 w-4" />}
        label="Respostas"
        value={data?.totalReplied ?? 0}
        sub={data && data.totalSent > 0 ? `${data.replyRate.toFixed(1)}% taxa` : undefined}
        loading={isLoading}
        tone="emerald"
      />
      <Kpi
        icon={<TrendingUp className="h-4 w-4" />}
        label="Em negociação"
        value={data?.totalInDeal ?? 0}
        loading={isLoading}
        tone="blue"
      />
      <Kpi
        icon={<Trophy className="h-4 w-4" />}
        label="Ganhas"
        value={data?.totalWon ?? 0}
        sub={data && data.totalSent > 0 ? `${data.conversionRate.toFixed(1)}% conv.` : undefined}
        loading={isLoading}
        tone="emerald-strong"
      />
      <Kpi
        icon={<DollarSign className="h-4 w-4" />}
        label="Em vendas"
        value={data ? formatCurrency(data.totalWonValue) : 'R$ 0'}
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
  sub?: string;
  loading?: boolean;
  tone: 'primary' | 'emerald' | 'emerald-strong' | 'blue';
}

function Kpi({ icon, label, value, sub, loading, tone }: KpiProps) {
  const tones = {
    primary: 'bg-primary/5 text-primary border-primary/20',
    emerald: 'bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
    'emerald-strong': 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30',
    blue: 'bg-blue-500/5 text-blue-700 dark:text-blue-400 border-blue-500/20',
  };

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
      {sub && !loading && (
        <div className="text-[10px] opacity-70">{sub}</div>
      )}
    </div>
  );
}
