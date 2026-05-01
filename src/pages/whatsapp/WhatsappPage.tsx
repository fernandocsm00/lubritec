import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QueueTabs } from '@/features/whatsapp/QueueTabs';
import type { ConversationQueue } from '@/features/whatsapp/types';

export default function WhatsappPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queue = (searchParams.get('queue') as ConversationQueue) || 'recepcao';
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);

  function handleQueueChange(q: ConversationQueue) {
    const next = new URLSearchParams(searchParams);
    next.set('queue', q);
    setSearchParams(next, { replace: true });
    setSelectedConvId(null);
  }

  return (
    <div className="grid h-[calc(100vh-4rem)]" style={{ gridTemplateColumns: '380px 1fr 340px' }}>
      {/* Coluna 1 — lista */}
      <aside className="flex flex-col border-r border-border bg-background">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-base font-semibold">Inbox</h2>
        </div>
        <QueueTabs active={queue} onChange={handleQueueChange} />
        <div className="flex-1 overflow-hidden flex items-center justify-center text-muted-foreground text-sm">
          (lista de conversas — Task 14)
        </div>
      </aside>

      {/* Coluna 2 — thread */}
      <main className="flex flex-col bg-muted/20">
        {selectedConvId ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            (thread — Task 15)
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Selecione uma conversa
          </div>
        )}
      </main>

      {/* Coluna 3 — sidebar lead */}
      <aside className="border-l border-border bg-background">
        {selectedConvId ? (
          <div className="p-4 text-sm text-muted-foreground">(sidebar do lead — Task 18)</div>
        ) : null}
      </aside>
    </div>
  );
}
