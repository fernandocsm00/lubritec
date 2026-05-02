import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { useAuthStore } from '@/features/auth/store';
import { useBoard } from './api';
import { KanbanColumn } from './KanbanColumn';
import { DEAL_STAGES } from '@shared/types';
import type { DealStage, PublicDeal } from './types';

export function KanbanBoard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const owner = (searchParams.get('owner') as 'mine' | 'all') || 'mine';
  const q = searchParams.get('q') ?? '';
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');
  const [searchInput, setSearchInput] = useState(q);
  const [, setSelectedDealId] = useState<string | null>(null);  // Task 15 wires drawer

  function patch(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  }

  const { data, isLoading, isError } = useBoard({ owner, q: q || undefined });

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-3 mb-4 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone, placa…"
            className="pl-8 h-9 text-sm"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onBlur={() => patch({ q: searchInput || null })}
            onKeyDown={(e) => { if (e.key === 'Enter') patch({ q: searchInput || null }); }}
          />
        </div>
        <div className="flex gap-1.5">
          <button
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              owner === 'mine'
                ? 'bg-primary/10 text-primary border-primary/40'
                : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'
            }`}
            onClick={() => patch({ owner: 'mine' })}
          >
            Meus deals
          </button>
          <button
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              owner === 'all'
                ? 'bg-primary/10 text-primary border-primary/40'
                : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'
            }`}
            onClick={() => patch({ owner: 'all' })}
          >
            Todos
          </button>
        </div>
      </div>

      {isError && (
        <div className="text-sm text-destructive p-4">Erro ao carregar o pipeline.</div>
      )}

      <div className="flex-1 grid grid-cols-4 gap-3 overflow-hidden">
        {isLoading || !data ? (
          DEAL_STAGES.map((s) => (
            <div key={s} className="flex flex-col gap-2 p-2 bg-background border border-border rounded-lg">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))
        ) : (
          DEAL_STAGES.map((s: DealStage) => (
            <KanbanColumn
              key={s}
              stage={s}
              items={data.stages[s]}
              total={data.totals[s]}
              currentUserId={currentUserId}
              onCardClick={(deal: PublicDeal) => setSelectedDealId(deal.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
