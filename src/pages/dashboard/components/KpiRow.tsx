import type { DashboardSummary, DashboardPeriod, DashboardView } from '@shared/types';
import { KpiCard } from './KpiCard';

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export function KpiRow({ data, view, period }: { data: DashboardSummary; view: DashboardView; period: DashboardPeriod }) {
  const k = data.kpis;
  const showGoalCta = view === 'org' && period === 'month' && !data.goal;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label={view === 'org' ? 'Vendas' : 'Meus ganhos'}
        value={fmtBRL(k.sales.value)}
        empty={k.sales.value === 0 && k.sales.prev === 0}
        delta={{ pct: k.sales.deltaPct, isGood: k.sales.deltaPct >= 0 }}
        goal={data.goal ? { percent: data.goal.percent, targetLabel: fmtBRL(data.goal.monthlyTarget) } : undefined}
        cta={showGoalCta ? { label: 'Definir meta →', to: '/settings?tab=organization' } : undefined}
      />

      <KpiCard
        label={view === 'org' ? 'Propostas' : 'Minhas propostas'}
        value={String(k.proposals.value)}
        empty={k.proposals.value === 0 && k.proposals.prev === 0}
        delta={{ pct: k.proposals.deltaPct, isGood: k.proposals.deltaPct >= 0 }}
      />

      <KpiCard
        label={view === 'org' ? 'Win rate' : 'Meu win rate'}
        value={`${k.winRate.value}%`}
        empty={k.winRate.value === 0 && k.winRate.prev === 0}
        delta={{ pct: k.winRate.deltaPct, isGood: k.winRate.deltaPct >= 0, suffix: 'pp' }}
      />

      <KpiCard
        label={view === 'org' ? 'Ticket médio' : 'Meu ticket médio'}
        value={fmtBRL(k.avgTicket.value)}
        empty={k.avgTicket.value === 0 && k.avgTicket.prev === 0}
        delta={{ pct: k.avgTicket.deltaPct, isGood: k.avgTicket.deltaPct >= 0 }}
      />
    </div>
  );
}
