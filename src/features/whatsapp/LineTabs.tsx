import { Smartphone } from 'lucide-react';
import { useInstancesList } from '@/features/settings/whatsapp/api';

interface Props {
  /** Linha selecionada (whatsapp_instance id). undefined = todas. */
  instanceId?: string;
  onChange: (id: string | undefined) => void;
}

/**
 * Seletor de LINHA do Inbox (número de WhatsApp) — o "contexto" de qual número
 * você está atendendo. Fica no topo, acima das abas de fila, separado dos
 * filtros. Some sozinho quando há só uma linha ativa (nada a escolher).
 */
export function LineTabs({ instanceId, onChange }: Props) {
  const { data } = useInstancesList();
  const lines = (data?.items ?? []).filter((l) => !l.isArchived);
  if (lines.length < 2) return null;

  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-muted/30 overflow-x-auto">
      <Smartphone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <Pill active={!instanceId} onClick={() => onChange(undefined)}>Todas</Pill>
      {lines.map((l) => (
        <Pill key={l.id} active={instanceId === l.id} onClick={() => onChange(l.id)}>
          {l.displayName}
        </Pill>
      ))}
    </div>
  );
}

function Pill({
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
      className={`px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap shrink-0 transition-colors ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background text-muted-foreground border-border hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}
