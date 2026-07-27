import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { Image as ImageIcon, Bot, Clock, Megaphone } from 'lucide-react';
import {
  formatRelativeTime,
  avatarInitials,
  waitingMinutes,
  waitingToneClasses,
  formatWaitingLabel,
} from './helpers';
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

  // Tempo esperando na fila Comercial sem dono — destaque visual pra modelo pull.
  const isWaitingInComercial =
    conv.queue === 'comercial' &&
    conv.status === 'aguardando_atendimento' &&
    !conv.assignedTo;
  const waitMin = isWaitingInComercial ? waitingMinutes(conv.enteredQueueAt) : null;

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
          <span className="font-medium text-sm truncate flex items-center gap-1.5">
            {conv.lead.name}
            {conv.hasAiHandoff && (
              <span
                title="Qualificado pela IA"
                className="inline-flex items-center gap-0.5 rounded bg-primary/10 text-primary text-[9px] uppercase tracking-wide px-1 py-0.5"
              >
                <Bot className="h-2.5 w-2.5" /> IA
              </span>
            )}
          </span>
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
        <div className="flex items-center justify-between gap-2 mt-1">
          <div className={`text-[10px] ${ownerColor}`}>{ownerLabel}</div>
          {waitMin != null && (
            <div className={`text-[10px] flex items-center gap-0.5 ${waitingToneClasses(waitMin)}`}>
              <Clock className="h-2.5 w-2.5" /> {formatWaitingLabel(waitMin)}
            </div>
          )}
        </div>
        {conv.originKind === 'campaign' && conv.originCampaignName && (
          <div className="mt-1">
            <HoverCard openDelay={120} closeDelay={80}>
              <HoverCardTrigger asChild>
                <span
                  className="inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground max-w-[140px] cursor-help hover:bg-muted/70 transition-colors"
                >
                  <Megaphone className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{conv.originCampaignName}</span>
                </span>
              </HoverCardTrigger>
              <HoverCardContent align="start" side="top" className="w-72">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Megaphone className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="truncate">{conv.originCampaignName}</span>
                </div>
                {conv.originCampaignMessage ? (
                  <p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                    {conv.originCampaignMessage}
                  </p>
                ) : (
                  <p className="text-xs italic text-muted-foreground">
                    Sem prévia da mensagem enviada.
                  </p>
                )}
              </HoverCardContent>
            </HoverCard>
          </div>
        )}
      </div>
    </button>
  );
}
