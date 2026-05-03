import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/apiClient';
import type { ListResult } from '@/features/leads/api';
import type { PublicLead } from '@shared/types';
import type { AudienceFilters } from '../campaigns/types';

interface Props {
  open: boolean;
  onClose: () => void;
  filters: AudienceFilters;
  excluded: string[];
  onExcludedChange: (ids: string[]) => void;
}

export function AudiencePreviewTable({ open, onClose, filters, excluded, onExcludedChange }: Props) {
  const [items, setItems] = useState<PublicLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Reusa /leads pra listar audiência possível (1ª página)
    const params = new URLSearchParams();
    if (filters.status?.length) params.set('status', filters.status[0]);  // simplificado
    if (filters.source?.length) params.set('source', filters.source[0]);
    api<ListResult>(`/leads?${params.toString()}`)
      .then((r) => { if (!cancelled) setItems(r.items); })
      .catch((e: unknown) => {
        if (!cancelled) {
          setItems([]);
          setError(e instanceof Error ? e.message : 'Falha ao carregar audiência.');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, filters]);

  function toggle(id: string) {
    onExcludedChange(
      excluded.includes(id)
        ? excluded.filter((x) => x !== id)
        : [...excluded, id],
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Audiência (primeira página)</DialogTitle>
        </DialogHeader>
        <div className="max-h-96 overflow-auto">
          {error && <div className="text-sm text-destructive p-3">{error}</div>}
          {loading ? <Skeleton className="h-40 w-full" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Incluir</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Veículo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={!excluded.includes(l.id)}
                        onChange={() => toggle(l.id)}
                      />
                    </TableCell>
                    <TableCell>{l.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.phone}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[l.vehicleModel, l.vehiclePlate].filter(Boolean).join(' · ') || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
