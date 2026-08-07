import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { UF_VALUES, type ConversationStatus, type OriginKind, type Uf } from '@shared/types';

const STATUS_OPTIONS: { key: 'aguardando' | 'em_atendimento' | 'aguardando_nos' | 'sem_retorno' | 'encerrada'; label: string }[] = [
  { key: 'aguardando', label: 'Aguardando' },
  { key: 'em_atendimento', label: 'Em atendimento' },
  { key: 'aguardando_nos', label: 'Aguardando nós' },
  { key: 'sem_retorno', label: 'Sem retorno' },
  { key: 'encerrada', label: 'Encerradas' },
];

const ASSIGNMENT_OPTIONS: { key: 'mine' | 'unassigned' | 'all'; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'mine', label: 'Minhas' },
  { key: 'unassigned', label: 'Sem dono' },
];

const ORIGIN_OPTIONS: { key: OriginKind; label: string }[] = [
  { key: 'organic', label: 'Orgânica' },
  { key: 'campaign', label: 'Campanha' },
];

interface Props {
  q: string;
  onQChange: (q: string) => void;
  uf: Uf | 'all';
  onUfChange: (uf: Uf | 'all') => void;
  statusKeys: string[];
  onStatusToggle: (key: string) => void;
  assignment: 'mine' | 'unassigned' | 'all';
  onAssignmentChange: (a: 'mine' | 'unassigned' | 'all') => void;
  origins: OriginKind[];
  onOriginsChange: (o: OriginKind[]) => void;
  awaitingUsCount?: number;
}

export function FilterBar(props: Props) {
  const [searchInput, setSearchInput] = useState(props.q);
  return (
    <div className="border-b border-border bg-background">
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou telefone…"
            className="pl-8 h-9 text-sm"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onBlur={() => props.onQChange(searchInput)}
            onKeyDown={(e) => { if (e.key === 'Enter') props.onQChange(searchInput); }}
          />
        </div>
      </div>

      <div className="px-3 pb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground mr-1">UF:</span>
        <Chip active={props.uf === 'all'} onClick={() => props.onUfChange('all')}>Todas</Chip>
        {UF_VALUES.map((v) => (
          <Chip key={v} active={props.uf === v} onClick={() => props.onUfChange(v)}>{v}</Chip>
        ))}
      </div>

      <div className="px-3 pb-2 flex flex-wrap gap-1.5">
        {STATUS_OPTIONS.map((s) => (
          <Chip
            key={s.key}
            active={props.statusKeys.includes(s.key)}
            onClick={() => props.onStatusToggle(s.key)}
          >
            {s.key === 'aguardando_nos' && props.awaitingUsCount
              ? `${s.label} (${props.awaitingUsCount})`
              : s.label}
          </Chip>
        ))}
      </div>

      <div className="px-3 pb-2 flex flex-wrap gap-1.5">
        {ASSIGNMENT_OPTIONS.map((a) => (
          <Chip
            key={a.key}
            active={props.assignment === a.key}
            onClick={() => props.onAssignmentChange(a.key)}
          >
            {a.label}
          </Chip>
        ))}
        <span className="mx-2 text-muted-foreground/50">|</span>
        {ORIGIN_OPTIONS.map((o) => (
          <Chip
            key={o.key}
            active={props.origins.includes(o.key)}
            onClick={() => {
              const next = props.origins.includes(o.key)
                ? props.origins.filter((x) => x !== o.key)
                : [...props.origins, o.key];
              props.onOriginsChange(next);
            }}
          >
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-primary/10 text-primary border-primary/40'
          : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}

// Helper para converter a tecla do chip de status nos filtros do backend.
export function statusChipsToFilters(keys: string[]): {
  status?: ConversationStatus[];
  awaitingUs?: boolean;
  noResponse?: boolean;
} {
  const result: { status?: ConversationStatus[]; awaitingUs?: boolean; noResponse?: boolean } = {};
  const statusList: ConversationStatus[] = [];
  if (keys.includes('aguardando')) statusList.push('aguardando_atendimento');
  if (keys.includes('em_atendimento')) statusList.push('em_atendimento');
  if (keys.includes('encerrada')) statusList.push('encerrada');
  if (statusList.length) result.status = statusList;
  if (keys.includes('aguardando_nos')) result.awaitingUs = true;
  if (keys.includes('sem_retorno')) result.noResponse = true;
  return result;
}
