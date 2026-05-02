import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { useHistory } from './api';
import { DealDrawer } from './DealDrawer';
import { formatCurrency, LOSS_REASON_LABELS, STAGE_LABELS } from './helpers';
import { LOSS_REASONS } from '@shared/types';
import type { LossReason } from './types';

export function HistoryTable() {
  const [searchParams, setSearchParams] = useSearchParams();
  const stageFilter = searchParams.get('stage') as 'ganho' | 'perdido' | null;
  const reasonFilter = searchParams.get('reason') as LossReason | null;
  const fromFilter = searchParams.get('from') ?? '';
  const toFilter = searchParams.get('to') ?? '';
  const ownerFilter = (searchParams.get('owner') as 'mine' | 'all') || 'all';
  const q = searchParams.get('q') ?? '';
  const page = Number(searchParams.get('page') ?? '1');
  const [searchInput, setSearchInput] = useState(q);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function patch(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in updates)) next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const { data, isLoading } = useHistory({
    owner: ownerFilter,
    q: q || undefined,
    stage: stageFilter ?? undefined,
    lossReason: reasonFilter ?? undefined,
    from: fromFilter ? new Date(fromFilter).toISOString() : undefined,
    to: toFilter ? new Date(toFilter).toISOString() : undefined,
    page,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <Input
          placeholder="Buscar nome / telefone / placa…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onBlur={() => patch({ q: searchInput || null })}
          onKeyDown={(e) => { if (e.key === 'Enter') patch({ q: searchInput || null }); }}
          className="max-w-sm h-9 text-sm"
        />
        <Select value={stageFilter ?? 'all'} onValueChange={(v) => patch({ stage: v === 'all' ? null : v })}>
          <SelectTrigger className="w-[140px] h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="ganho">Ganhos</SelectItem>
            <SelectItem value="perdido">Perdidos</SelectItem>
          </SelectContent>
        </Select>
        {stageFilter === 'perdido' && (
          <Select value={reasonFilter ?? 'all'} onValueChange={(v) => patch({ reason: v === 'all' ? null : v })}>
            <SelectTrigger className="w-[180px] h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Qualquer motivo</SelectItem>
              {LOSS_REASONS.map((r) => (
                <SelectItem key={r} value={r}>{LOSS_REASON_LABELS[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          type="date"
          value={fromFilter}
          onChange={(e) => patch({ from: e.target.value || null })}
          className="w-[150px] h-9 text-sm"
          aria-label="De"
        />
        <Input
          type="date"
          value={toFilter}
          onChange={(e) => patch({ to: e.target.value || null })}
          className="w-[150px] h-9 text-sm"
          aria-label="Até"
        />
        <Select value={ownerFilter} onValueChange={(v) => patch({ owner: v })}>
          <SelectTrigger className="w-[120px] h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="mine">Meus</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Veículo</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Dono</TableHead>
              <TableHead>Fechado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              : data?.items.map((d) => (
                  <TableRow key={d.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelectedId(d.id)}>
                    <TableCell className="font-medium">{d.lead.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {[d.lead.vehicleModel, d.lead.vehiclePlate].filter(Boolean).join(' · ') || '—'}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(d.proposalValue)}</TableCell>
                    <TableCell>{STAGE_LABELS[d.stage]}</TableCell>
                    <TableCell>{d.lossReason ? LOSS_REASON_LABELS[d.lossReason] : '—'}</TableCell>
                    <TableCell>{d.owner?.name ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {d.closedAt ? new Date(d.closedAt).toLocaleDateString('pt-BR') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
            {!isLoading && data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                  Nenhum deal no histórico.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {data && totalPages > 1 && (
        <div className="flex justify-between items-center pt-3 text-sm text-muted-foreground">
          <span>Página {data.page} de {totalPages} · {data.total} deals</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={data.page <= 1}
              onClick={() => patch({ page: String(data.page - 1) })}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={data.page >= totalPages}
              onClick={() => patch({ page: String(data.page + 1) })}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      <DealDrawer dealId={selectedId} onClose={() => setSelectedId(null)} readOnly />
    </div>
  );
}
