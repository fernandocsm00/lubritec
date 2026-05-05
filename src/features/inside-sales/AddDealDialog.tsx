import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ValueInput } from './ValueInput';
import { useCreateDeal } from './api';
import { api } from '@/lib/apiClient';
import type { PublicLead } from '@shared/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LeadSearchResponse {
  items: PublicLead[];
}

export function AddDealDialog({ open, onOpenChange }: Props) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PublicLead[]>([]);
  const [selected, setSelected] = useState<PublicLead | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const create = useCreateDeal();

  async function doSearch(query: string) {
    setSearch(query);
    if (query.length < 2) {
      setResults([]);
      return;
    }
    try {
      const res = await api<LeadSearchResponse>(`/leads?q=${encodeURIComponent(query)}`);
      setResults(res.items.slice(0, 10));
    } catch {
      setResults([]);
    }
  }

  async function submit() {
    if (!selected) return;
    try {
      await create.mutateAsync({ leadId: selected.id, proposalValue: value ?? undefined });
      toast.success('Adicionado ao pipeline.');
      onOpenChange(false);
      setSelected(null);
      setValue(null);
      setSearch('');
      setResults([]);
    } catch {
      toast.error('Falha ao adicionar.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar ao pipeline</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Buscar lead</Label>
            <Input
              placeholder="Nome ou telefone…"
              value={selected ? selected.name : search}
              onChange={(e) => {
                setSelected(null);
                doSearch(e.target.value);
              }}
            />
            {!selected && results.length > 0 && (
              <div className="mt-1 border border-border rounded-md max-h-40 overflow-y-auto">
                {results.map((l) => (
                  <button
                    key={l.id}
                    className="w-full text-left p-2 hover:bg-muted text-sm"
                    onClick={() => { setSelected(l); setResults([]); setSearch(''); }}
                  >
                    <div className="font-medium">{l.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.phone} · {l.cnpj}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label>Valor da proposta (opcional)</Label>
            <ValueInput value={value} onChange={setValue} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={!selected || create.isPending}>
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
