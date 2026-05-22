import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LeadStatus, LeadSource, LeadFlowStage } from '@shared/types';

interface Props {
  q: string;
  status: LeadStatus | 'all';
  source: LeadSource | 'all';
  flowStage: LeadFlowStage | 'all';
  pipeline: 'yes' | 'no' | 'all';
  withIssues: boolean;
  onQChange: (v: string) => void;
  onStatusChange: (v: LeadStatus | 'all') => void;
  onSourceChange: (v: LeadSource | 'all') => void;
  onFlowStageChange: (v: LeadFlowStage | 'all') => void;
  onPipelineChange: (v: 'yes' | 'no' | 'all') => void;
  onWithIssuesChange: (v: boolean) => void;
}

export function LeadFilters({
  q,
  status,
  source,
  flowStage,
  pipeline,
  withIssues,
  onQChange,
  onStatusChange,
  onSourceChange,
  onFlowStageChange,
  onPipelineChange,
  onWithIssuesChange,
}: Props) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      <Input
        value={q}
        onChange={(e) => onQChange(e.target.value)}
        placeholder="Buscar por nome, telefone ou CNPJ..."
        className="max-w-sm"
      />
      <Select value={flowStage} onValueChange={(v) => onFlowStageChange(v as LeadFlowStage | 'all')}>
        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas as etapas</SelectItem>
          <SelectItem value="incomplete">Incompleto</SelectItem>
          <SelectItem value="complete">Completo</SelectItem>
          <SelectItem value="dispatched">Disparado</SelectItem>
          <SelectItem value="engaged">Respondeu</SelectItem>
          <SelectItem value="qualified">Qualificado</SelectItem>
          <SelectItem value="handed_off">No comercial</SelectItem>
          <SelectItem value="lost">Perdido</SelectItem>
        </SelectContent>
      </Select>
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
      <button
        type="button"
        onClick={() => onWithIssuesChange(!withIssues)}
        className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
          withIssues
            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40'
            : 'border-border text-muted-foreground hover:bg-muted/50'
        }`}
        title="Mostra leads cujo enriquecimento BrasilAPI mais recente teve problema (CNPJ inativo, não encontrado, sem telefone, etc.)"
      >
        {withIssues ? '⚠ Com problemas (filtrado)' : '⚠ Com problemas'}
      </button>
    </div>
  );
}
