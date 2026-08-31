import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QueueTabs } from '@/features/whatsapp/QueueTabs';
import { LineTabs } from '@/features/whatsapp/LineTabs';
import { FilterBar } from '@/features/whatsapp/FilterBar';
import { buildConversationFilters } from '@/features/whatsapp/filters';
import { ConversationList } from '@/features/whatsapp/ConversationList';
import { Thread } from '@/features/whatsapp/Thread';
import { ChatHeader } from '@/features/whatsapp/ChatHeader';
import { LeadSidebar } from '@/features/whatsapp/LeadSidebar';
import { NewConversationDialog } from '@/features/whatsapp/NewConversationDialog';
import { useConversations, useConversationCounts, fetchConversationByLead } from '@/features/whatsapp/api';
import { useAuthStore } from '@/features/auth/store';
import type { ConversationQueue, ConversationFilters, OriginKind } from '@/features/whatsapp/types';
import type { Uf } from '@shared/types';

export default function WhatsappPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queue = (searchParams.get('queue') as ConversationQueue) || 'recepcao';
  const statusKeys = (searchParams.get('statusChips') ?? 'aguardando,em_atendimento')
    .split(',').filter(Boolean);
  const assignment = (searchParams.get('assignment') as 'mine' | 'unassigned' | 'all') ?? 'all';
  const origins: OriginKind[] = ((searchParams.get('origin') ?? 'organic,campaign')
    .split(',').filter(Boolean) as OriginKind[]);
  const ufParam = searchParams.get('uf');
  const uf: Uf | 'all' = ufParam === 'RS' || ufParam === 'BA' ? ufParam : 'all';
  const q = searchParams.get('q') ?? '';
  const instanceId = searchParams.get('line') || undefined;
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');

  const filters: ConversationFilters = useMemo(
    () => buildConversationFilters({ queue, statusKeys, origins, assignment, uf, instanceId, q }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, statusKeys.join(','), origins.join(','), assignment, uf, instanceId, q],
  );

  const { data: convsData } = useConversations(filters);
  const { data: counts } = useConversationCounts(instanceId, queue);
  const selectedConv = convsData?.items.find((c) => c.id === selectedConvId) ?? null;

  // Deep-link: ?lead=<leadId> ou ?conv=<convId> pré-seleciona conversa.
  // Usado por DealDrawer ("Abrir conversa") e outras telas que querem pular pra um chat.
  const deepLeadId = searchParams.get('lead');
  const deepConvId = searchParams.get('conv');

  // ?lead=<id>: resolve via endpoint /conversations/by-lead/:leadId pra
  // descobrir em qual fila/status a conversa esta, e atualiza a URL pros
  // filtros incluirem essa conversa (queue + statusChips). Depois o useEffect
  // de baixo cuida da auto-selecao quando convsData carregar nessa fila.
  useEffect(() => {
    if (!deepLeadId) return;
    let cancelled = false;
    fetchConversationByLead(deepLeadId)
      .then((conv) => {
        if (cancelled) return;
        const STATUS_TO_CHIP: Record<typeof conv.status, string> = {
          aguardando_atendimento: 'aguardando',
          em_atendimento: 'em_atendimento',
          encerrada: 'encerrada',
        };
        const next = new URLSearchParams(searchParams);
        next.set('queue', conv.queue);
        // Mantem chips uteis + adiciona o status atual da conv pra garantir
        // que aparece no filtro.
        const chipSet = new Set(statusKeys);
        chipSet.add(STATUS_TO_CHIP[conv.status]);
        next.set('statusChips', Array.from(chipSet).join(','));
        next.set('assignment', 'all');
        // Origin amplo pra nao filtrar fora.
        next.set('origin', 'organic,campaign');
        next.delete('lead');
        // Substitui por ?conv=<id> -- o useEffect de baixo seleciona.
        next.set('conv', conv.id);
        setSearchParams(next, { replace: true });
      })
      .catch(() => {
        // Lead sem conversa: limpa o param pra evitar loop.
        const next = new URLSearchParams(searchParams);
        next.delete('lead');
        setSearchParams(next, { replace: true });
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLeadId]);

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
    }
  }, [convsData, deepConvId, searchParams, selectedConvId, setSearchParams]);

  function patch(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  }

  return (
    // -m-6: cancela o p-6 do AppShell main pra ocupar a largura cheia sem padding,
    // ja que esta tela tem visual de "app" (sidebars + chat) e nao de pagina normal.
    // h-[calc(100vh-60px)]: viewport menos a Topbar (60px). Antes era 4rem(64px) +
    // padding nao compensado, o que estourava 44px e fazia a pagina inteira virar
    // scrollavel quando a conversa tinha muitas mensagens.
    <div className="-m-6 grid h-[calc(100vh-60px)] overflow-hidden" style={{ gridTemplateColumns: '380px 1fr 340px' }}>
      <aside className="flex flex-col border-r border-border bg-background overflow-hidden min-h-0">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Inbox</h2>
          <NewConversationDialog onCreated={(id) => setSelectedConvId(id)} />
        </div>
        <LineTabs
          instanceId={instanceId}
          onChange={(id) => { patch({ line: id ?? null }); setSelectedConvId(null); }}
        />
        <QueueTabs
          active={queue}
          onChange={(q) => { patch({ queue: q }); setSelectedConvId(null); }}
          instanceId={instanceId}
        />
        <FilterBar
          q={q}
          onQChange={(v) => patch({ q: v || null })}
          uf={uf}
          onUfChange={(v) => patch({ uf: v === 'all' ? null : v })}
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
          awaitingUsCount={counts?.awaitingUs}
        />
        <ConversationList
          filters={filters}
          selectedId={selectedConvId}
          currentUserId={currentUserId}
          onSelect={(c) => setSelectedConvId(c.id)}
        />
      </aside>

      <main className="flex flex-col bg-muted/10 overflow-hidden min-h-0">
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
