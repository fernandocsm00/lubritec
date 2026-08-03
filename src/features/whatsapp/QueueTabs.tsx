import { useConversationCounts } from './api';
import type { ConversationQueue } from './types';

// Ordem da Inbox: Receptivo (recepcao) → IA → Comercial. O valor interno segue
// 'recepcao' (enum do banco); só o rótulo exibido é "Receptivo".
const QUEUES: { key: ConversationQueue; label: string }[] = [
  { key: 'recepcao', label: 'Receptivo' },
  { key: 'ia', label: 'IA' },
  { key: 'comercial', label: 'Comercial' },
];

interface Props {
  active: ConversationQueue;
  onChange: (queue: ConversationQueue) => void;
  /** Linha selecionada — filtra os contadores por linha (undefined = todas). */
  instanceId?: string;
}

export function QueueTabs({ active, onChange, instanceId }: Props) {
  const { data } = useConversationCounts(instanceId);
  return (
    <div className="flex border-b border-border bg-background">
      {QUEUES.map((q) => {
        const count = data?.[q.key] ?? 0;
        const isActive = active === q.key;
        return (
          <button
            key={q.key}
            onClick={() => onChange(q.key)}
            className={`flex-1 py-3 px-2 text-sm font-semibold border-b-2 transition-colors ${
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <span>{q.label}</span>
            <span
              className={`ml-2 inline-block min-w-[20px] px-2 py-0.5 rounded-full text-xs font-semibold ${
                isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
