import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Inbox, ShieldCheck, Search, Send, Wifi, Clock } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  useNotifications,
  useUnreadCount,
  useMarkRead,
  useMarkAllRead,
} from './api';
import type { NotificationKind, PublicNotification } from '@shared/types';

const KIND_ICON: Record<NotificationKind, typeof Bell> = {
  enrichment_completed:    Search,
  enrichment_cancelled:    Search,
  lead_qualified:          ShieldCheck,
  dispatch_failed:         Send,
  whatsapp_disconnected:   Wifi,
  campaign_cooldown_high:  Clock,
  system:                  Bell,
};

const KIND_TONE: Record<NotificationKind, string> = {
  enrichment_completed:    'text-emerald-600 dark:text-emerald-400',
  enrichment_cancelled:    'text-slate-500',
  lead_qualified:          'text-emerald-600 dark:text-emerald-400',
  dispatch_failed:         'text-destructive',
  whatsapp_disconnected:   'text-amber-600 dark:text-amber-400',
  campaign_cooldown_high:  'text-amber-600 dark:text-amber-400',
  system:                  'text-slate-500',
};

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 60) return 'agora';
  if (diffSeconds < 3600) return `há ${Math.floor(diffSeconds / 60)}min`;
  if (diffSeconds < 86400) return `há ${Math.floor(diffSeconds / 3600)}h`;
  if (diffSeconds < 7 * 86400) return `há ${Math.floor(diffSeconds / 86400)}d`;
  return date.toLocaleDateString('pt-BR');
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  // Lista carrega quando dropdown abre — UnreadCount sempre polling.
  const list = useNotifications({ enabled: open });
  const unread = useUnreadCount();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const items = list.data?.items ?? [];
  const unreadCount = open ? (list.data?.unreadCount ?? 0) : (unread.data?.unreadCount ?? 0);

  function handleClick(n: PublicNotification) {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.actionUrl) {
      setOpen(false);
      navigate(n.actionUrl);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notificações${unreadCount > 0 ? ` (${unreadCount} não lidas)` : ''}`}
          className="relative"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[380px] max-h-[480px] overflow-hidden flex flex-col p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm font-semibold">Notificações</span>
          {unreadCount > 0 && (
            <button
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <CheckCheck className="h-3 w-3" />
              Marcar todas como lidas
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {list.isLoading && items.length === 0 && (
            <div className="text-center text-xs text-muted-foreground py-8">Carregando…</div>
          )}
          {!list.isLoading && items.length === 0 && (
            <div className="text-center py-10">
              <Inbox className="h-8 w-8 mx-auto text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground mt-2">Nenhuma notificação</p>
            </div>
          )}
          {items.map((n) => {
            const Icon = KIND_ICON[n.kind] ?? Bell;
            const tone = KIND_TONE[n.kind] ?? 'text-slate-500';
            const unreadStyle = n.readAt ? '' : 'bg-primary/5 dark:bg-primary/10';
            return (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`w-full text-left px-3 py-2.5 border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors ${unreadStyle}`}
              >
                <div className="flex items-start gap-2.5">
                  <div className={`mt-0.5 ${tone}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm truncate ${n.readAt ? 'font-normal' : 'font-semibold'}`}>
                        {n.title}
                      </p>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {formatRelativeTime(n.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {n.body}
                    </p>
                  </div>
                  {!n.readAt && (
                    <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
