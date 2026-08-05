import { toast } from 'sonner';
import { Bot, BotOff, UserPlus, Check } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  useAssignConversation,
  useChangeQueue,
  useClaimConversation,
  useCloseConversation,
  useConversationAssignees,
  useSetConversationAi,
} from './api';
import { avatarInitials, formatPhoneBR } from './helpers';
import { CONVERSATION_QUEUES } from '@shared/types';
import { formatCnpj } from '@/lib/utils';
import type { PublicConversation } from './types';

const ROLE_LABEL: Record<'admin' | 'comercial' | 'recepcao', string> = {
  admin: 'Admin', comercial: 'Comercial', recepcao: 'Recepção',
};

const QUEUE_LABEL: Record<PublicConversation['queue'], string> = {
  ia: 'IA', recepcao: 'Receptivo', comercial: 'Comercial',
};

export function ChatHeader({ conv, currentUserId }: { conv: PublicConversation; currentUserId: string }) {
  const claim = useClaimConversation();
  const assign = useAssignConversation();
  const changeQueue = useChangeQueue();
  const close = useCloseConversation();
  const setAi = useSetConversationAi();
  const { data: assignees } = useConversationAssignees();

  const isMine = conv.assignedTo?.id === currentUserId;
  const subtitle = [
    formatPhoneBR(conv.phone),
    formatCnpj(conv.lead.cnpj),
  ].filter(Boolean).join(' · ');

  async function doClaim() {
    try {
      await claim.mutateAsync(conv.id);
      toast.success('Conversa atribuída a você.');
    } catch { toast.error('Falha ao atribuir.'); }
  }

  async function doAssign(userId: string | null, name: string) {
    try {
      await assign.mutateAsync({ id: conv.id, userId });
      toast.success(userId ? `Atribuída a ${name}.` : 'Atribuição removida.');
    } catch { toast.error('Falha ao atribuir.'); }
  }

  async function doMove(q: PublicConversation['queue']) {
    try {
      await changeQueue.mutateAsync({ id: conv.id, queue: q });
      toast.success(`Movida para ${QUEUE_LABEL[q]}.`);
    } catch { toast.error('Falha ao mover.'); }
  }

  // A IA desliga sozinha assim que alguém do time responde. Este botão é o
  // caminho de volta (respondeu por engano / terminou e quer devolver pra IA).
  async function toggleAi() {
    const enabled = conv.aiDisabled;
    try {
      await setAi.mutateAsync({ id: conv.id, enabled });
      toast.success(enabled ? 'IA reativada nesta conversa.' : 'IA desativada nesta conversa.');
    } catch { toast.error('Falha ao alterar a IA.'); }
  }

  async function doClose() {
    try {
      await close.mutateAsync(conv.id);
      toast.success('Conversa encerrada.');
    } catch { toast.error('Falha ao encerrar.'); }
  }

  return (
    <>
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
            <Button size="sm" variant="outline" disabled={assign.isPending}>
              <UserPlus className="h-4 w-4 mr-1" /> Atribuir ▾
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-72 overflow-y-auto w-56">
            {(!assignees || assignees.length === 0) && (
              <DropdownMenuItem disabled>Nenhum usuário disponível</DropdownMenuItem>
            )}
            {assignees?.map((u) => {
              const isCurrent = conv.assignedTo?.id === u.id;
              return (
                <DropdownMenuItem
                  key={u.id}
                  onSelect={() => !isCurrent && doAssign(u.id, u.name)}
                  disabled={isCurrent}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex flex-col min-w-0">
                    <span className="truncate text-sm">{u.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {ROLE_LABEL[u.role]}
                    </span>
                  </span>
                  {isCurrent && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </DropdownMenuItem>
              );
            })}
            {conv.assignedTo && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => doAssign(null, '')}
                  className="text-muted-foreground"
                >
                  Remover atribuição
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
        {conv.queue !== 'comercial' && (
          <Button
            size="sm"
            variant="outline"
            onClick={toggleAi}
            disabled={setAi.isPending}
            title={conv.aiDisabled
              ? 'A IA não responde mais nesta conversa. Clique pra devolver pra IA.'
              : 'A IA está respondendo esta conversa. Ela desliga sozinha quando você responder.'}
          >
            {conv.aiDisabled
              ? <><BotOff className="h-4 w-4 mr-1 text-muted-foreground" /> IA off</>
              : <><Bot className="h-4 w-4 mr-1 text-primary" /> IA on</>}
          </Button>
        )}
        {conv.status !== 'encerrada' && (
          <Button size="sm" variant="destructive" onClick={doClose} disabled={close.isPending}>
            Encerrar
          </Button>
        )}
      </div>
    </div>
    {conv.handoffSummary && (
      <div className="px-4 py-2.5 border-b border-primary/30 bg-primary/5">
        <div className="flex items-start gap-2">
          <Bot className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-primary font-semibold mb-0.5">
              Resumo da IA
            </div>
            <div className="text-xs text-foreground/90 whitespace-pre-line">
              {conv.handoffSummary}
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
