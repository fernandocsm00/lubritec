import { useSearchParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';

const KanbanBoard = lazy(() =>
  import('@/features/inside-sales/KanbanBoard').then((m) => ({ default: m.KanbanBoard })),
);
const HistoryPage = lazy(() => import('./HistoryPage'));

const Loader = () => <div className="p-6 text-muted-foreground text-sm">Carregando…</div>;

export default function InsideSalesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') as 'pipeline' | 'history') || 'pipeline';

  function setTab(t: 'pipeline' | 'history') {
    const next = new URLSearchParams(searchParams);
    next.set('tab', t);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-6 overflow-hidden">
      <div className="flex justify-between items-end mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Inside Sales</h1>
          <p className="text-sm text-muted-foreground">Pipeline de leads em negociação ativa</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border mb-4">
        <button
          className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
            tab === 'pipeline'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('pipeline')}
        >
          Pipeline
        </button>
        <button
          className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
            tab === 'history'
              ? 'border-primary text-primary font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('history')}
        >
          Histórico
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<Loader />}>
          {tab === 'pipeline' ? <KanbanBoard /> : <HistoryPage />}
        </Suspense>
      </div>
    </div>
  );
}
