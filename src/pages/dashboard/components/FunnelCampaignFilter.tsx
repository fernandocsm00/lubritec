import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useCampaigns } from '@/features/campaigns/api';

interface Props {
  selected: string[];
  onChange: (ids: string[]) => void;
}

/**
 * Filtro do funil por campanha. Vazio = global (todas). Multi-select permite ver
 * um conjunto (ex.: as campanhas RS ou as BA, selecionando as que interessam).
 */
export function FunnelCampaignFilter({ selected, onChange }: Props) {
  const { data } = useCampaigns({});
  const campaigns = data?.items ?? [];

  const label =
    selected.length === 0
      ? 'Todas as campanhas'
      : selected.length === 1
        ? (campaigns.find((c) => c.id === selected[0])?.name ?? '1 campanha')
        : `${selected.length} campanhas`;

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted/50 max-w-[220px]"
          title="Filtrar o funil por campanha(s)"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
        <DropdownMenuItem
          onSelect={(e) => { e.preventDefault(); onChange([]); }}
          className={selected.length === 0 ? 'font-semibold' : ''}
        >
          Todas as campanhas (global)
        </DropdownMenuItem>
        {campaigns.length > 0 && <DropdownMenuSeparator />}
        {campaigns.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={selected.includes(c.id)}
            onCheckedChange={() => toggle(c.id)}
            onSelect={(e) => e.preventDefault()}
          >
            <span className="truncate">{c.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
