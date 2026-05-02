import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LeadStatus, LeadSource } from '@shared/types';

interface Props {
  q: string;
  status: LeadStatus | 'all';
  source: LeadSource | 'all';
  pipeline: 'yes' | 'no' | 'all';
  onQChange: (v: string) => void;
  onStatusChange: (v: LeadStatus | 'all') => void;
  onSourceChange: (v: LeadSource | 'all') => void;
  onPipelineChange: (v: 'yes' | 'no' | 'all') => void;
}

export function LeadFilters({
  q,
  status,
  source,
  pipeline,
  onQChange,
  onStatusChange,
  onSourceChange,
  onPipelineChange,
}: Props) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      <Input
        value={q}
        onChange={(e) => onQChange(e.target.value)}
        placeholder="Buscar por nome, telefone ou placa..."
        className="max-w-sm"
      />
      <Select value={status} onValueChange={(v) => onStatusChange(v as LeadStatus | 'all')}>
        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os status</SelectItem>
          <SelectItem value="frio">Frio</SelectItem>
          <SelectItem value="morno">Morno</SelectItem>
          <SelectItem value="quente">Quente</SelectItem>
        </SelectContent>
      </Select>
      <Select value={source} onValueChange={(v) => onSourceChange(v as LeadSource | 'all')}>
        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas as origens</SelectItem>
          <SelectItem value="manual">Manual</SelectItem>
          <SelectItem value="csv">CSV</SelectItem>
          <SelectItem value="whatsapp">WhatsApp</SelectItem>
        </SelectContent>
      </Select>
      <Select value={pipeline} onValueChange={(v) => onPipelineChange(v as 'yes' | 'no' | 'all')}>
        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Pipeline: Todos</SelectItem>
          <SelectItem value="yes">No pipeline</SelectItem>
          <SelectItem value="no">Sem pipeline</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
