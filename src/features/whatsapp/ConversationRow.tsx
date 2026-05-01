import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Image as ImageIcon } from 'lucide-react';
import { formatRelativeTime, avatarInitials } from './helpers';
import type { PublicConversation } from './types';

interface Props {
  conv: PublicConversation;
  active: boolean;
  currentUserId: string;
  onClick: () => void;
}

export function ConversationRow({ conv, active, currentUserId, onClick }: Props) {
  const isMine = conv.assignedTo?.id === currentUserId;
  const ownerLabel = !conv.assignedTo
    ? '● Sem dono'
    : isMine
    ? '● Em atendimento por você'
    : `● Em atendimento por ${conv.assignedTo.name}`;
  const ownerColor = !conv.assignedTo
    ? 'text-destructive'
    : isMine
    ? 'text-primary'
    : 'text-muted-foreground';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left grid grid-cols-[44px_1fr] gap-3 px-3 py-3 border-b border-border/40 transition-colors ${
        active ? 'bg-accent' : 'hover:bg-muted/50'
      }`}
    >
      <Avatar className="h-11 w-11">
        <AvatarFallback className="bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-sm font-semibold">
          {avatarInitials(conv.lead.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between">
          <span className="font-medium text-sm truncate">{conv.lead.name}</span>
          <span className={`text-xs flex-shrink-0 ml-2 ${conv.unreadCount > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
            {formatRelativeTime(conv.lastMessageAt)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground truncate flex items-center gap-1">
            {conv.lastMessagePreview === '[imagem]' && <ImageIcon className="h-3 w-3" />}
            {conv.lastMessageDirection === 'out' && <span className="text-foreground/60">Você: </span>}
            {conv.lastMessagePreview || '(sem mensagens)'}
          </span>
          {conv.unreadCount > 0 && (
            <span className="bg-primary text-primary-foreground text-xs font-semibold rounded-full min-w-[20px] px-1.5 py-0.5 text-center flex-shrink-0">
              {conv.unreadCount}
            </span>
          )}
        </div>
        <div className={`text-[10px] mt-1 ${ownerColor}`}>{ownerLabel}</div>
      </div>
    </button>
  );
}
