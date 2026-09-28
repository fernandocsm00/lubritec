import { useEffect, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LEAD_STATUSES, LEAD_SOURCES } from '@shared/types';
import type { AudienceFilters } from './types';
import { useDryRun } from './api';
import { AudienceCsvImport } from './AudienceCsvImport';
import { AudiencePreviewTable } from './AudiencePreviewTable';
import { mergeImportExclusions } from './audienceExclusions';

interface Props {
  filters: AudienceFilters;
  onFiltersChange: (f: AudienceFilters) => void;
  total: number;
  onTotalChange: (n: number) => void;
}

export function AudienceStep({ filters, onFiltersChange, total, onTotalChange }: Props) {
  const dryRun = useDryRun();
  const [optOutOpen, setOptOutOpen] = useState(false);
  // Exclusões que vieram da importação por CNPJ — trocadas a cada importação
  // sem apagar as que o vendedor desmarcou à mão (ver mergeImportExclusions).
  const importExcludedRef = useRef<string[]>([]);

  // Recalcula dry-run quando filtros mudam (debounced via useEffect cleanup).
  // O número da etapa é o do DISPARO: elegíveis, já sem excluídos e sem os
  // bloqueados por cooldown. Prévia que falha zera o número (e trava o
  // "Próximo") em vez de deixar o último total na tela.
  useEffect(() => {
    const h = setTimeout(() => {
      dryRun.mutate(filters, {
        onSuccess: (r) => onTotalChange(r.eligible),
        onError: () => onTotalChange(0),
      });
    }, 400);
    return () => clearTimeout(h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <Label>Status do lead</Label>
        <div className="flex gap-2 flex-wrap mt-1">
          {LEAD_STATUSES.map((s) => {
            const active = filters.status?.includes(s) ?? false;
            return (
              <button
                key={s}
                type="button"
                className={`px-3 py-1 rounded-full text-xs border ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground'
                }`}
                onClick={() => {
                  const next = active
                    ? (filters.status ?? []).filter((x) => x !== s)
                    : [...(filters.status ?? []), s];
                  onFiltersChange({ ...filters, status: next.length ? next : undefined });
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label>Origem do lead</Label>
        <div className="flex gap-2 flex-wrap mt-1">
          {LEAD_SOURCES.map((s) => {
            const active = filters.source?.includes(s) ?? false;
            return (
              <button
                key={s}
                type="button"
                className={`px-3 py-1 rounded-full text-xs border ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground'
                }`}
                onClick={() => {
                  const next = active
                    ? (filters.source ?? []).filter((x) => x !== s)
                    : [...(filters.source ?? []), s];
                  onFiltersChange({ ...filters, source: next.length ? next : undefined });
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label>Cadastrado há mais de N dias</Label>
        <Input
          type="number"
          min={0}
          max={3650}
          placeholder="Ex: 90"
          value={filters.daysSinceCreated ?? ''}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onFiltersChange({
              ...filters,
              daysSinceCreated: isNaN(n) ? undefined : n,
            });
          }}
          className="max-w-xs"
        />
      </div>

      <div className="border-t pt-4">
        <Label>Importar audiência por CNPJ</Label>
        <div className="mt-1">
          <AudienceCsvImport
            onChange={(importedLeadIds, importExcluded) => {
              const merged = mergeImportExclusions(
                filters.excludeLeadIds ?? [], importExcludedRef.current, importExcluded,
              );
              importExcludedRef.current = importExcluded;
              onFiltersChange({
                ...filters,
                importedLeadIds: importedLeadIds.length ? importedLeadIds : undefined,
                excludeLeadIds: merged.length ? merged : undefined,
              });
            }}
          />
        </div>
      </div>

      <div className="border-t pt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">
              {total} lead(s) vão receber o disparo
              {dryRun.isPending && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">recalculando…</span>
              )}
            </div>
            {dryRun.isError && (
              <div className="text-xs text-destructive">
                Não consegui calcular a audiência
                {dryRun.error instanceof Error ? `: ${dryRun.error.message}` : ''}. Ajuste a seleção e tente de novo.
              </div>
            )}
            {(dryRun.data?.newFromCsv ?? 0) > 0 && (
              <div className="text-xs text-emerald-600">
                {dryRun.data!.newFromCsv} novo(s) lead(s) serão criados a partir do CSV
              </div>
            )}
            {(dryRun.data?.invalidFromCsv ?? 0) > 0 && (
              <div className="text-xs text-lc-amber">
                {dryRun.data!.invalidFromCsv} telefone(s) do CSV em formato inválido foram ignorados
              </div>
            )}
            {(filters.excludeLeadIds?.length ?? 0) > 0 && (
              <div className="text-xs text-muted-foreground">
                {filters.excludeLeadIds!.length} excluído(s) manualmente
              </div>
            )}
            {dryRun.data && dryRun.data.total > 0 && (dryRun.data.blocked.recentOutbound + dryRun.data.blocked.pendingOtherCampaign) > 0 && (
              <div className="mt-2 text-[12px] text-lc-amber leading-snug">
                <div className="font-medium">
                  Elegíveis: {dryRun.data.eligible} · Pulados por cooldown: {dryRun.data.blocked.recentOutbound + dryRun.data.blocked.pendingOtherCampaign}
                </div>
                {dryRun.data.blocked.recentOutbound > 0 && (
                  <div className="ml-3">
                    └─ {dryRun.data.blocked.recentOutbound} receberam mensagem nas últimas 24h
                  </div>
                )}
                {dryRun.data.blocked.pendingOtherCampaign > 0 && (
                  <div className="ml-3">
                    └─ {dryRun.data.blocked.pendingOtherCampaign} já estão em outra campanha ativa
                  </div>
                )}
              </div>
            )}
          </div>
          <Button variant="outline" onClick={() => setOptOutOpen(true)}>Ver e excluir leads…</Button>
        </div>
      </div>

      <AudiencePreviewTable
        open={optOutOpen}
        onClose={() => setOptOutOpen(false)}
        filters={filters}
        excluded={filters.excludeLeadIds ?? []}
        onExcludedChange={(ids) => onFiltersChange({
          ...filters,
          excludeLeadIds: ids.length ? ids : undefined,
        })}
      />
    </div>
  );
}
