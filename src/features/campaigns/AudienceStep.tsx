import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LEAD_STATUSES, LEAD_SOURCES } from '@shared/types';
import type { AudienceFilters } from './types';
import { useDryRun } from './api';
import { CsvUpload } from './CsvUpload';
import { AudiencePreviewTable } from './AudiencePreviewTable';

interface Props {
  filters: AudienceFilters;
  onFiltersChange: (f: AudienceFilters) => void;
  total: number;
  onTotalChange: (n: number) => void;
}

export function AudienceStep({ filters, onFiltersChange, total, onTotalChange }: Props) {
  const dryRun = useDryRun();
  const [optOutOpen, setOptOutOpen] = useState(false);

  // Recalcula dry-run quando filtros mudam (debounced via useEffect cleanup)
  useEffect(() => {
    const h = setTimeout(() => {
      dryRun.mutate(filters, {
        onSuccess: (r) => onTotalChange(r.total),
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
        <Label>Upload CSV de telefones (opcional)</Label>
        <CsvUpload
          current={filters.phoneCsv ?? []}
          onPhones={(phones) => onFiltersChange({
            ...filters,
            phoneCsv: phones.length ? phones : undefined,
          })}
        />
      </div>

      <div className="border-t pt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">{total} lead(s) impactado(s)</div>
            {(filters.excludeLeadIds?.length ?? 0) > 0 && (
              <div className="text-xs text-muted-foreground">
                {filters.excludeLeadIds!.length} excluído(s) manualmente
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
