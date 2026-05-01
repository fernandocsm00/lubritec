import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useChangeQueue, useClaimConversation, useCloseConversation } from './api';
import { avatarInitials, formatPhoneBR } from './helpers';
import { CONVERSATION_QUEUES } from '@shared/types';
import type { PublicConversation } from './types';

const QUEUE_LABEL: Record<PublicConversation['queue'], string> = {
  ia: 'IA', recepcao: 'Recepção', comercial: 'Comercial',
};

export function ChatHeader({ conv, currentUserId }: { conv: PublicConversation; currentUserId: string }) {
  const claim = useClaimConversation();
  const changeQueue = useChangeQueue();
  const close = useCloseConversation();

  const isMine = conv.assignedTo?.id === currentUserId;
  const subtitle = [
    formatPhoneBR(conv.phone),
    conv.lead.vehicleModel,
    conv.lead.vehiclePlate,
  ].filter(Boolean).join(' · ');

  async function doClaim() {
    try {
      await claim.mutateAsync(conv.id);
      toast.success('Conversa atribuída a você.');
    } catch { toast.error('Falha ao atribuir.'); }
  }

  async function doMove(q: PublicConversation['queue']) {
    try {
      await changeQueue.mutateAsync({ id: conv.id, queue: q });
      toast.success(`Movida para ${QUEUE_LABEL[q]}.`);
    } catch { toast.error('Falha ao mover.'); }
  }

  async function doClose() {
    try {
      await close.mutateAsync(conv.id);
      toast.success('Conversa encerrada.');
    } catch { toast.error('Falha ao encerrar.'); }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-background">
      <Avatar className="h-9 w-9">
        <AvatarFallback className="bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-sm">
          {avatarInitials(conv.lead.name)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">{conv.lead.name}</div>
        <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
      </div>
      <div className="flex gap-2">
        {!conv.assignedTo && (
          <Button size="sm" variant="default" onClick={doClaim} disabled={claim.isPending}>
            Pegar conversa
          </Button>
        )}
        {conv.assignedTo && !isMine && (
          <Button size="sm" variant="outline" onClick={doClaim} disabled={claim.isPending}>
            Reatribuir a mim
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">Mover ▾</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {CONVERSATION_QUEUES.filter((q) => q !== conv.queue).map((q) => (
              <DropdownMenuItem key={q} onSelect={() => doMove(q)}>
                Para {QUEUE_LABEL[q]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {conv.status !== 'encerrada' && (
          <Button size="sm" variant="destructive" onClick={doClose} disabled={close.isPending}>
            Encerrar
          </Button>
        )}
      </div>
    </div>
  );
}
