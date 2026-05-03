import { useState } from 'react';
import { useAuthStore } from '@/features/auth/store';
import type { DashboardView, DashboardPeriod, DashboardSummary } from '@shared/types';
import { useDashboardSummary, useDashboardAttention, useDashboardWhatsapp } from './hooks';
import { ViewToggle } from './components/ViewToggle';
import { PeriodPicker } from './components/PeriodPicker';
import { BlockSkeleton } from './components/BlockSkeleton';
import { BlockError } from './components/BlockError';
import { KpiRow } from './components/KpiRow';
import { AttentionList } from './components/AttentionList';
import { FunnelChart } from './components/FunnelChart';
import { PipelineOpen } from './components/PipelineOpen';
import { WhatsappStats } from './components/WhatsappStats';
import { Leaderboard } from './components/Leaderboard';
import { RecentActivities } from './components/RecentActivities';
import { RefreshCcw } from 'lucide-react';

function RightSection({ view, summary }: { view: DashboardView; summary: DashboardSummary | undefined }) {
  if (!summary) return <BlockSkeleton height={200} />;
  if (view === 'org') return <Leaderboard data={summary.leaderboard ?? []} />;
  return <RecentActivities data={summary.recentActivities ?? []} />;
}

export default function DashboardPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';

  const [view, setView] = useState<DashboardView>(isAdmin ? 'org' : 'me');
  const [period, setPeriod] = useState<DashboardPeriod>('month');

  const summary   = useDashboardSummary(view, period);
  const attention = useDashboardAttention(view);
  const whatsapp  = useDashboardWhatsapp(view === 'org');

  const isRefreshing = summary.isFetching || attention.isFetching || (view === 'org' && whatsapp.isFetching);

  function refreshAll() {
    summary.refetch();
    attention.refetch();
    if (view === 'org') whatsapp.refetch();
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          {isAdmin && <ViewToggle value={view} onChange={setView} />}
          {!isAdmin && <h1 className="text-xl font-semibold tracking-tight text-lc-ink">Meu pipeline</h1>}
        </div>
        <div className="flex items-end gap-3">
          <PeriodPicker value={period} onChange={setPeriod} />
          <button
            type="button"
            onClick={refreshAll}
            disabled={isRefreshing}
            className="rounded-lg border border-slate-300 bg-white p-2 text-slate-500 hover:text-lc-navy disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Atualizar dados"
          >
            <RefreshCcw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI ROW */}
      <section>
        {summary.isLoading && !summary.data ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <BlockSkeleton key={i} height={130} />)}
          </div>
        ) : summary.error ? (
          <BlockError onRetry={() => summary.refetch()} />
        ) : summary.data ? (
          <KpiRow data={summary.data} view={view} period={period} />
        ) : null}
      </section>

      {/* ATENÇÃO */}
      <section>
        <h2 className="mb-2 text-xs uppercase tracking-wider text-slate-500">Atenção</h2>
        {attention.isLoading && !attention.data ? (
          <BlockSkeleton height={220} />
        ) : attention.error ? (
          <BlockError onRetry={() => attention.refetch()} />
        ) : attention.data ? (
          <AttentionList data={attention.data} />
        ) : null}
      </section>

      {/* FUNIL + PIPELINE */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {summary.error ? (
          <>
            <BlockError onRetry={() => summary.refetch()} />
            <BlockError onRetry={() => summary.refetch()} />
          </>
        ) : summary.data ? (
          <>
            <FunnelChart funnel={summary.data.funnel} />
            <PipelineOpen data={summary.data.pipelineOpen} />
          </>
        ) : (
          <>
            <BlockSkeleton height={300} />
            <BlockSkeleton height={300} />
          </>
        )}
      </section>

      {/* WHATSAPP + LEADERBOARD/RECENTES */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {view === 'org' && (
          whatsapp.data
            ? <WhatsappStats data={whatsapp.data} />
            : whatsapp.error
              ? <BlockError onRetry={() => whatsapp.refetch()} />
              : <BlockSkeleton height={200} />
        )}
        <RightSection view={view} summary={summary.data} />
      </section>
    </div>
  );
}
