import { useId } from 'react';
import { X } from 'lucide-react';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  IMBP_VALUES,
  IMBP_LABELS,
  SEGMENT_VALUES,
  SEGMENT_LABELS,
} from '@shared/types';
import { useCampaignReportCities, type ReportLeadFilters } from './api';

interface Props {
  value: ReportLeadFilters;
  onChange: (next: ReportLeadFilters) => void;
}

// Sentinela usada nos Select pra representar "sem filtro" — Radix Select nao
// aceita value="" então usamos um marcador explicito.
const ANY = '__any__';

/**
 * Bloco de filtros do relatório de campanhas: IMBP, Segmento e Cidade.
 * Todos os 3 são opcionais e independentes. Cidade usa <datalist> nativo
 * (combobox com busca/autocomplete) alimentado pelo endpoint /report-cities.
 *
 * Lembre que Segmento é derivado 1:1 do IMBP, então combinar IMBP X com
 * Segmento Y incompatível retorna vazio — isso é intencional, deixamos a UI
 * livre por simplicidade (a alternativa seria desabilitar segmentos com base
 * no IMBP escolhido, o que adiciona complexidade pouco usada).
 */
export function CampaignReportFilters({ value, onChange }: Props) {
  const citiesQuery = useCampaignReportCities();
  const cityListId = useId();

  const hasAnyFilter = Boolean(value.imbp || value.segment || value.city);

  const updateField = (field: keyof ReportLeadFilters, raw: string) => {
    const v = raw === ANY ? undefined : raw.trim() || undefined;
    onChange({ ...value, [field]: v });
  };

  return (
    <div className="flex gap-2 flex-wrap items-center">
      <Select
        value={value.imbp ?? ANY}
        onValueChange={(v) => updateField('imbp', v)}
      >
        <SelectTrigger className="w-[260px] h-9 text-sm">
          <SelectValue placeholder="IMBP: todos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>IMBP: todos</SelectItem>
          {IMBP_VALUES.map((v) => (
            <SelectItem key={v} value={v}>{IMBP_LABELS[v]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.segment ?? ANY}
        onValueChange={(v) => updateField('segment', v)}
      >
        <SelectTrigger className="w-[220px] h-9 text-sm">
          <SelectValue placeholder="Segmento: todos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Segmento: todos</SelectItem>
          {SEGMENT_VALUES.map((v) => (
            <SelectItem key={v} value={v}>{SEGMENT_LABELS[v]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="w-[200px]">
        <Input
          list={cityListId}
          value={value.city ?? ''}
          onChange={(e) => updateField('city', e.target.value)}
          placeholder="Cidade…"
          className="h-9 text-sm"
        />
        <datalist id={cityListId}>
          {(citiesQuery.data?.items ?? []).map((c) => (
            <option key={c.city} value={c.city}>
              {c.count} lead{c.count === 1 ? '' : 's'}
            </option>
          ))}
        </datalist>
      </div>

      {hasAnyFilter && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({})}
          className="h-9 text-xs gap-1"
        >
          <X className="h-3 w-3" /> Limpar
        </Button>
      )}
    </div>
  );
}
