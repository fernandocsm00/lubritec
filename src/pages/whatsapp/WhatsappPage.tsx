import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QueueTabs } from '@/features/whatsapp/QueueTabs';
import { FilterBar, statusChipsToFilters } from '@/features/whatsapp/FilterBar';
import { ConversationList } from '@/features/whatsapp/ConversationList';
import { Thread } from '@/features/whatsapp/Thread';
import { ChatHeader } from '@/features/whatsapp/ChatHeader';
import { LeadSidebar } from '@/features/whatsapp/LeadSidebar';
import { NewConversationDialog } from '@/features/whatsapp/NewConversationDialog';
import { useConversations } from '@/features/whatsapp/api';
import { useAuthStore } from '@/features/auth/store';
import type { ConversationQueue, ConversationFilters, OriginKind } from '@/features/whatsapp/types';

export default function WhatsappPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queue = (searchParams.get('queue') as ConversationQueue) || 'recepcao';
  const statusKeys = (searchParams.get('statusChips') ?? 'aguardando,em_atendimento')
    .split(',').filter(Boolean);
  const assignment = (searchParams.get('assignment') as 'mine' | 'unassigned' | 'all') ?? 'all';
  const origins: OriginKind[] = ((searchParams.get('origin') ?? 'organic,campaign')
    .split(',').filter(Boolean) as OriginKind[]);
  const q = searchParams.get('q') ?? '';
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');

  const filters: ConversationFilters = useMemo(() => ({
    queue,
    ...statusChipsToFilters(statusKeys),
    origin: origins,
    assignment,
    q: q || undefined,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [queue, statusKeys.join(','), origins.join(','), assignment, q]);

  const { data: convsData } = useConversations(filters);
  const selectedConv = convsData?.items.find((c) => c.id === selectedConvId) ?? null;

  // Deep-link: ?lead=<leadId> ou ?conv=<convId> pré-seleciona conversa.
  // Usado por DealDrawer ("Abrir conversa") e outras telas que querem pular pra um chat.
  const deepLeadId = searchParams.get('lead');
  const deepConvId = searchParams.get('conv');
  useEffect(() => {
    if (!convsData) return;
    if (deepConvId) {
      const exists = convsData.items.some((c) => c.id === deepConvId);
      if (exists && selectedConvId !== deepConvId) {
        setSelectedConvId(deepConvId);
      }
      // Limpa do URL pra não re-selecionar quando usuário navegar.
      const next = new URLSearchParams(searchParams);
      next.delete('conv');
      setSearchParams(next, { replace: true });
    } else if (deepLeadId) {
      const match = convsData.items.find((c) => c.lead.id === deepLeadId);
      if (match && selectedConvId !== match.id) {
        setSelectedConvId(match.id);
      }
      const next = new URLSearchParams(searchParams);
      next.delete('lead');
      setSearchParams(next, { replace: true });
    }
  }, [convsData, deepConvId, deepLeadId, searchParams, selectedConvId, setSearchParams]);

  function patch(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="grid h-[calc(100vh-4rem)]" style={{ gridTemplateColumns: '380px 1fr 340px' }}>
      <aside className="flex flex-col border-r border-border bg-background">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Inbox</h2>
          <NewConversationDialog onCreated={(id) => setSelectedConvId(id)} />
        </div>
        <QueueTabs
          active={queue}
          onChange={(q) => { patch({ queue: q }); setSelectedConvId(null); }}
        />
        <FilterBar
          q={q}
          onQChange={(v) => patch({ q: v || null })}
          statusKeys={statusKeys}
          onStatusToggle={(k) => {
            const next = statusKeys.includes(k)
              ? statusKeys.filter((x) => x !== k)
              : [...statusKeys, k];
            patch({ statusChips: next.join(',') || null });
          }}
          assignment={assignment}
          onAssignmentChange={(a) => patch({ assignment: a === 'all' ? null : a })}
          origins={origins}
          onOriginsChange={(o) => patch({ origin: o.join(',') })}
        />
        <ConversationList
          filters={filters}
          selectedId={selectedConvId}
          currentUserId={currentUserId}
          onSelect={(c) => setSelectedConvId(c.id)}
        />
      </aside>

      <main className="flex flex-col bg-muted/10">
        {selectedConv ? (
          <>
            <ChatHeader conv={selectedConv} currentUserId={currentUserId} />
            <Thread conversationId={selectedConv.id} />
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Selecione uma conversa
          </div>
        )}
      </main>

      <aside className="border-l border-border bg-background overflow-y-auto">
        {selectedConv && <LeadSidebar conversationId={selectedConv.id} filters={filters} />}
      </aside>
    </div>
  );
}
