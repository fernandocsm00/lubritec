import { Skeleton } from '@/components/ui/skeleton';
import { ConversationRow } from './ConversationRow';
import { useConversations } from './api';
import type { ConversationFilters, PublicConversation } from './types';

interface Props {
  filters: ConversationFilters;
  selectedId: string | null;
  currentUserId: string;
  onSelect: (conv: PublicConversation) => void;
}

export function ConversationList({ filters, selectedId, currentUserId, onSelect }: Props) {
  const { data, isLoading, isError } = useConversations(filters);
  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }
  if (isError) {
    return <div className="flex-1 p-4 text-sm text-destructive">Erro ao carregar conversas.</div>;
  }
  if (!data?.items.length) {
    return <div className="flex-1 p-6 text-sm text-muted-foreground text-center">Nenhuma conversa nesta fila.</div>;
  }
  return (
    <div className="flex-1 overflow-y-auto">
      {data.items.map((c) => (
        <ConversationRow
          key={c.id}
          conv={c}
          active={c.id === selectedId}
          currentUserId={currentUserId}
          onClick={() => onSelect(c)}
        />
      ))}
    </div>
  );
}
