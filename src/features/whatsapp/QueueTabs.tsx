import { useConversationCounts } from './api';
import type { ConversationQueue } from './types';

const QUEUES: { key: ConversationQueue; label: string }[] = [
  { key: 'ia', label: 'IA' },
  { key: 'recepcao', label: 'Recepção' },
  { key: 'comercial', label: 'Comercial' },
];

interface Props {
  active: ConversationQueue;
  onChange: (queue: ConversationQueue) => void;
}

export function QueueTabs({ active, onChange }: Props) {
  const { data } = useConversationCounts();
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
