import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Search, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useAuthStore } from '@/features/auth/store';
import { useBoard, useChangeStage, useAssignableUsers, type OwnerFilter } from './api';
import { KanbanColumn } from './KanbanColumn';
import { AddDealDialog } from './AddDealDialog';
import { LossReasonDialog } from './LossReasonDialog';
import { GanhoValueDialog } from './GanhoValueDialog';
import { DealDrawer } from './DealDrawer';
import { DEAL_STAGES } from '@shared/types';
import type { DealStage, PublicDeal, LossReason } from './types';

interface PendingMove {
  dealId: string;
  toStage: DealStage;
  fromStage: DealStage;
  proposalValue: number | null;
}

export function KanbanBoard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const owner: OwnerFilter = (searchParams.get('owner') as OwnerFilter) || 'mine';
  const q = searchParams.get('q') ?? '';
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');
  const [searchInput, setSearchInput] = useState(q);
  const { data: assignableUsers } = useAssignableUsers();
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function patch(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  }

  const filters = useMemo(() => ({ owner, q: q || undefined }), [owner, q]);
  const { data, isLoading, isError } = useBoard(filters);
  const changeStage = useChangeStage();

  function handleDragEnd(e: DragEndEvent) {
    const dealId = e.active.id as string;
    const overId = e.over?.id as string | undefined;
    if (!overId) return;
    const toStage = (overId.replace('column-', '') as DealStage);
    if (!DEAL_STAGES.includes(toStage)) return;

    const fromStage = (e.active.data.current?.fromStage as DealStage) ?? toStage;
    if (fromStage === toStage) return;

    // Encontra o deal pra ler proposalValue
    const all = data
      ? [...data.stages.proposta_enviada, ...data.stages.em_negociacao, ...data.stages.ganho, ...data.stages.perdido]
      : [];
    const deal = all.find((d) => d.id === dealId);
    if (!deal) return;

    if (toStage === 'perdido') {
      setPendingMove({ dealId, toStage, fromStage, proposalValue: deal.proposalValue });
      return;
    }
    if (toStage === 'ganho' && deal.proposalValue == null) {
      setPendingMove({ dealId, toStage, fromStage, proposalValue: null });
      return;
    }
    void doMove({ dealId, toStage, fromStage });
  }

  async function doMove(opts: { dealId: string; toStage: DealStage; fromStage: DealStage; lossReason?: LossReason; ganhoValue?: number }) {
    try {
      // Se Ganho com valor novo, primeiro atualiza valor (PATCH) e depois muda stage.
      // Aqui simplificamos: o backend já valida que ganho exige value preenchido,
      // então salvamos o valor antes via PATCH se foi fornecido.
      if (opts.toStage === 'ganho' && opts.ganhoValue != null) {
        // Não dá pra usar hook aqui — usamos o api direto:
        const { api: apiCall } = await import('@/lib/apiClient');
        await apiCall(`/deals/${opts.dealId}`, {
          method: 'PATCH',
          body: JSON.stringify({ proposalValue: opts.ganhoValue }),
        });
      }
      await changeStage.mutateAsync({
        id: opts.dealId,
        stage: opts.toStage,
        lossReason: opts.lossReason,
      });
      toast.success('Movido.');
    } catch (err) {
      toast.error('Falha ao mover.');
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-3 mb-4 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone, CNPJ…"
            className="pl-8 h-9 text-sm"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onBlur={() => patch({ q: searchInput || null })}
            onKeyDown={(e) => { if (e.key === 'Enter') patch({ q: searchInput || null }); }}
          />
        </div>
        <Select value={owner} onValueChange={(v) => patch({ owner: v === 'mine' ? null : v })}>
          <SelectTrigger className="h-9 w-[180px] text-xs">
            <SelectValue placeholder="Filtrar por dono" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="mine">Meus deals</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="unassigned">Sem dono</SelectItem>
            </SelectGroup>
            {assignableUsers && assignableUsers.length > 0 && (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Por usuário</SelectLabel>
                  {assignableUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.id === currentUserId ? `${u.name} (você)` : u.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            )}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar ao pipeline
        </Button>
      </div>

      {isError && <div className="text-sm text-destructive p-4">Erro ao carregar o pipeline.</div>}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex-1 grid grid-cols-5 gap-3 overflow-x-auto">
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
      </DndContext>

      <AddDealDialog open={addOpen} onOpenChange={setAddOpen} />

      <LossReasonDialog
        open={pendingMove?.toStage === 'perdido'}
        onCancel={() => setPendingMove(null)}
        onConfirm={(reason) => {
          if (pendingMove) {
            void doMove({ ...pendingMove, lossReason: reason });
            setPendingMove(null);
          }
        }}
      />
      <GanhoValueDialog
        open={pendingMove?.toStage === 'ganho'}
        onCancel={() => setPendingMove(null)}
        onConfirm={(value) => {
          if (pendingMove) {
            void doMove({ ...pendingMove, ganhoValue: value });
            setPendingMove(null);
          }
        }}
      />

      <DealDrawer dealId={selectedDealId} onClose={() => setSelectedDealId(null)} />
    </div>
  );
}
