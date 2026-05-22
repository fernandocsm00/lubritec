import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, AlertCircle } from 'lucide-react';
import { useDryRun } from './api';
import type { AudienceFilters, CampaignDryRunResponse } from './types';
import { formatCnpj } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  filters: AudienceFilters;
  excluded: string[];
  onExcludedChange: (ids: string[]) => void;
}

/**
 * Preview da audiencia da campanha — mostra leads elegiveis E bloqueados
 * (cooldown 24h ou ja em outra campanha ativa). Bloqueados aparecem com
 * badge explicando o motivo e checkbox desabilitado (ja sao pulados por
 * regra; nao adianta "incluir" manualmente).
 *
 * Antes a tela usava /leads (sem cooldown) — usuario nao sabia quem
 * estava bloqueado e por que. Agora usa /campaigns/dry-run que tras
 * status de bloqueio por lead.
 */
export function AudiencePreviewTable({ open, onClose, filters, excluded, onExcludedChange }: Props) {
  const dryRun = useDryRun();
  const [data, setData] = useState<CampaignDryRunResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    dryRun.mutate(filters, {
      onSuccess: (r) => { if (!cancelled) { setData(r); setLoading(false); } },
      onError: (e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Falha ao carregar audiência.');
        setData(null);
        setLoading(false);
      },
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(filters)]);

  function toggle(id: string) {
    onExcludedChange(
      excluded.includes(id)
        ? excluded.filter((x) => x !== id)
        : [...excluded, id],
    );
  }

  const items = data?.preview ?? [];
  const totalBlocked = (data?.blocked.recentOutbound ?? 0) + (data?.blocked.pendingOtherCampaign ?? 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Audiência (primeira página)</DialogTitle>
          {data && (
            <div className="text-xs text-muted-foreground mt-1">
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                {data.eligible} elegíveis
              </span>
              {totalBlocked > 0 && (
                <>
                  {' · '}
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    {totalBlocked} bloqueados
                  </span>
                  {data.blocked.recentOutbound > 0 && ` (${data.blocked.recentOutbound} em cooldown 24h)`}
                  {data.blocked.pendingOtherCampaign > 0 && ` (${data.blocked.pendingOtherCampaign} em outra campanha)`}
                </>
              )}
              {data.total > items.length && (
                <span className="ml-1 italic">· mostrando primeiros {items.length} de {data.total}</span>
              )}
            </div>
          )}
        </DialogHeader>
        <div className="max-h-[28rem] overflow-auto">
          {error && <div className="text-sm text-destructive p-3">{error}</div>}
          {loading ? <Skeleton className="h-40 w-full" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Incluir</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((l) => {
                  const blocked = l.blockReason != null;
                  const checked = !blocked && !excluded.includes(l.leadId);
                  return (
                    <TableRow key={l.leadId} className={blocked ? 'opacity-60' : ''}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={blocked}
                          onChange={() => toggle(l.leadId)}
                          title={blocked ? 'Bloqueado — não pode ser incluído' : undefined}
                        />
                      </TableCell>
                      <TableCell>{l.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{formatCnpj(l.cnpj)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.phone}</TableCell>
                      <TableCell>
                        {l.blockReason === 'recent_outbound' && (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                            <Clock className="h-3 w-3" />
                            Cooldown 24h
                          </span>
                        )}
                        {l.blockReason === 'pending_other_campaign' && (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                            <AlertCircle className="h-3 w-3" />
                            Em outra campanha
                          </span>
                        )}
                        {!l.blockReason && (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                            Elegível
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
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
