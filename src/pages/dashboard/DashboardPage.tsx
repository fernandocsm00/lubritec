import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuthStore } from '@/features/auth/store';
import type { DashboardView, DashboardPeriod, DashboardSummary } from '@shared/types';
import {
  useDashboardSummary,
  useDashboardAttention,
  useDashboardWhatsapp,
  useDashboardMacroFunnel,
} from './hooks';
import type { DashboardLeadFilters } from './api';
import { CampaignReportFilters } from '@/features/campaigns/CampaignReportFilters';
import { ViewToggle } from './components/ViewToggle';
import { PeriodPicker } from './components/PeriodPicker';
import { BlockSkeleton } from './components/BlockSkeleton';
import { BlockError } from './components/BlockError';
import { StatusRibbon } from './components/StatusRibbon';
import { OperationsHero } from './components/OperationsHero';
import { BigFunnelChart } from './components/BigFunnelChart';
import { Leaderboard } from './components/Leaderboard';
import { RecentActivities } from './components/RecentActivities';
import { RefreshCcw } from 'lucide-react';

/**
 * Dashboard reformulado pra leitura DIARIA visual (feedback Lubritec maio/26):
 * "menos numerico, mais visual, bate o olho e entende como esta indo".
 *
 * Hierarquia:
 *  1. StatusRibbon — semaforo da operacao (verde/amarelo/vermelho)
 *  2. OperationsHero — vendas mes + meta + "agora" (fila/ia/etc)
 *  3. BigFunnelChart — funil horizontal proporcional com maior drop-off
 *     destacado (admin only)
 *  4. Leaderboard / RecentActivities — split por view (org/me)
 *
 * Movidos pra rota secundaria /dashboard/detalhes (ainda nao implementada):
 * KpiRow detalhado, FunnelChart pequeno, PipelineOpen, WhatsappStats,
 * AiMetricsCard, AttentionList textual. Estao acessiveis via "Ver detalhes".
 */

function RightSection({
  view,
  summary,
  error,
  onRetry,
}: {
  view: DashboardView;
  summary: DashboardSummary | undefined;
  error: boolean;
  onRetry: () => void;
}) {
  // Sem o check de erro, falha na query deixava skeleton infinito aqui.
  if (!summary && error) return <BlockError onRetry={onRetry} />;
  if (!summary) return <BlockSkeleton height={200} />;
  if (view === 'org') return <Leaderboard data={summary.leaderboard ?? []} />;
  return <RecentActivities data={summary.recentActivities ?? []} />;
}

export default function DashboardPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';

  const [view, setView] = useState<DashboardView>(isAdmin ? 'org' : 'me');
  const [period, setPeriod] = useState<DashboardPeriod>('month');
  const [leadFilters, setLeadFilters] = useState<DashboardLeadFilters>({});

  const summary = useDashboardSummary(view, period, leadFilters);
  const attention = useDashboardAttention(view);
  const whatsapp = useDashboardWhatsapp(view === 'org');
  const macroFunnel = useDashboardMacroFunnel({ period, filters: leadFilters }, isAdmin && view === 'org');

  const isRefreshing =
    summary.isFetching ||
    attention.isFetching ||
    (view === 'org' && whatsapp.isFetching) ||
    macroFunnel.isFetching;

  function refreshAll() {
    summary.refetch();
    attention.refetch();
    if (view === 'org') whatsapp.refetch();
    if (isAdmin && view === 'org') macroFunnel.refetch();
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* Cabecalho compacto: controles, sem titulo redundante */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {isAdmin && <ViewToggle value={view} onChange={setView} />}
          {!isAdmin && (
            <h1 className="text-xl font-semibold tracking-tight text-lc-ink">
              Meu pipeline
            </h1>
          )}
        </div>
        <div className="flex items-center gap-2">
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

      {/* Filtros por atributos do lead — afetam KPIs e funil (não tocam WhatsApp/IA). */}
      <div className="-mt-1">
        <CampaignReportFilters value={leadFilters} onChange={setLeadFilters} />
      </div>

      {/* 1. Status Ribbon */}
      <StatusRibbon
        attention={attention.data}
        whatsapp={whatsapp.data}
        currentMonthSales={summary.data?.goal?.currentMonthSales ?? summary.data?.kpis.sales.value}
      />

      {/* 2. Hero — vendas + agora */}
      {summary.isLoading && !summary.data ? (
        <BlockSkeleton height={200} />
      ) : summary.error ? (
        <BlockError onRetry={() => summary.refetch()} />
      ) : (
        <OperationsHero
          kpis={summary.data?.kpis}
          goal={summary.data?.goal}
          whatsapp={whatsapp.data}
          attention={attention.data}
        />
      )}

      {/* 3. Big Funnel — visualizacao principal pro gestor (admin/org only) */}
      {isAdmin && view === 'org' && (
        <>
          {macroFunnel.error ? (
            <BlockError onRetry={() => macroFunnel.refetch()} />
          ) : macroFunnel.data ? (
            <BigFunnelChart data={macroFunnel.data} />
          ) : (
            <BlockSkeleton height={400} />
          )}
        </>
      )}

      {/* 4. Split: Leaderboard ou Atividades recentes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RightSection
          view={view}
          summary={summary.data}
          error={!!summary.error}
          onRetry={() => summary.refetch()}
        />
        {/* Lado direito: link pra detalhes operacionais (KPIs detalhados,
            pipeline aberto, WhatsApp stats, IA metricas, atencao textual) */}
        {isAdmin && view === 'org' && (
          <Link
            to="/dashboard/detalhes"
            className="rounded-xl border border-dashed border-border bg-card hover:bg-muted/30 transition-colors p-6 flex items-center justify-between text-sm group"
          >
            <div>
              <div className="font-semibold mb-1">Ver detalhes operacionais</div>
              <div className="text-xs text-muted-foreground">
                KPIs detalhados, pipeline aberto, WhatsApp stats, métricas da IA, alertas.
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
          </Link>
        )}
      </div>
    </div>
  );
}
