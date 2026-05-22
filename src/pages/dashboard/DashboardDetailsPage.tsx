import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCcw } from 'lucide-react';
import { useAuthStore } from '@/features/auth/store';
import type { DashboardView, DashboardPeriod, DashboardSummary } from '@shared/types';
import {
  useDashboardSummary,
  useDashboardAttention,
  useDashboardWhatsapp,
  useDashboardMacroFunnel,
  useDashboardAiMetrics,
} from './hooks';
import { ViewToggle } from './components/ViewToggle';
import { PeriodPicker } from './components/PeriodPicker';
import { BlockSkeleton } from './components/BlockSkeleton';
import { BlockError } from './components/BlockError';
import { KpiRow } from './components/KpiRow';
import { AttentionList } from './components/AttentionList';
import { FunnelChart } from './components/FunnelChart';
import { AiMetricsCard } from './components/AiMetricsCard';
import { PipelineOpen } from './components/PipelineOpen';
import { WhatsappStats } from './components/WhatsappStats';
import { Leaderboard } from './components/Leaderboard';
import { RecentActivities } from './components/RecentActivities';

/**
 * Pagina de detalhes operacionais — abriga componentes que foram tirados
 * do /dashboard principal pra ele ficar mais visual e enxuto.
 *
 * Aqui mora a "vista de gerenciamento" pra quem quer dados numericos
 * detalhados, alertas textuais, pipeline aberto, metricas IA, WhatsApp,
 * etc. /dashboard principal eh pra "bate o olho diario"; aqui eh pro
 * "deep dive quinzenal/mensal".
 */

function RightSection({ view, summary }: { view: DashboardView; summary: DashboardSummary | undefined }) {
  if (!summary) return <BlockSkeleton height={200} />;
  if (view === 'org') return <Leaderboard data={summary.leaderboard ?? []} />;
  return <RecentActivities data={summary.recentActivities ?? []} />;
}

export default function DashboardDetailsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';

  const [view, setView] = useState<DashboardView>(isAdmin ? 'org' : 'me');
  const [period, setPeriod] = useState<DashboardPeriod>('month');
  const [funnelCustomFrom, setFunnelCustomFrom] = useState<string>('');
  const [funnelCustomTo, setFunnelCustomTo] = useState<string>('');
  const useCustomRange = !!funnelCustomFrom && !!funnelCustomTo;

  const summary = useDashboardSummary(view, period);
  const attention = useDashboardAttention(view);
  const whatsapp = useDashboardWhatsapp(view === 'org');
  const funnelArgs = useCustomRange
    ? { from: new Date(funnelCustomFrom).toISOString(), to: new Date(funnelCustomTo).toISOString() }
    : { period };
  const aiMetrics = useDashboardAiMetrics(funnelArgs, isAdmin && view === 'org');

  const isRefreshing =
    summary.isFetching ||
    attention.isFetching ||
    (view === 'org' && whatsapp.isFetching);

  function refreshAll() {
    summary.refetch();
    attention.refetch();
    if (view === 'org') whatsapp.refetch();
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground gap-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Dashboard
          </Link>
          <div className="text-muted-foreground text-xs">/</div>
          <h1 className="text-xl font-semibold tracking-tight">Detalhes operacionais</h1>
        </div>
        <div className="flex items-end gap-3">
          {isAdmin && <ViewToggle value={view} onChange={setView} />}
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

      {/* KPI ROW detalhado */}
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

      {/* ATENÇÃO (lista textual) */}
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

      {/* MÉTRICAS DE IA */}
      {isAdmin && view === 'org' && (
        <section>
          {aiMetrics.error ? (
            <BlockError onRetry={() => aiMetrics.refetch()} />
          ) : aiMetrics.data ? (
            <AiMetricsCard data={aiMetrics.data} />
          ) : (
            <BlockSkeleton height={200} />
          )}
        </section>
      )}

      {/* FUNIL DE VENDAS + PIPELINE */}
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

      {/* Range customizado (escondido — futura feature ou pode ser reativado) */}
      {false && (
        <div className="flex items-center gap-2 text-xs">
          <input
            type="date"
            value={funnelCustomFrom}
            onChange={(e) => setFunnelCustomFrom(e.target.value)}
            className="rounded border px-1.5 py-1 text-xs"
          />
          <input
            type="date"
            value={funnelCustomTo}
            onChange={(e) => setFunnelCustomTo(e.target.value)}
            className="rounded border px-1.5 py-1 text-xs"
          />
        </div>
      )}
    </div>
  );
}
