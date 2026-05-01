import { useEffect, useRef } from 'react';
import { useMessages, useMarkRead } from './api';
import { MessageBubble } from './MessageBubble';
import { DayDivider } from './DayDivider';
import { dayLabel } from './helpers';
import type { PublicMessage } from './types';

interface Props { conversationId: string }

export function Thread({ conversationId }: Props) {
  const { data, isLoading } = useMessages(conversationId);
  const markRead = useMarkRead();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastConvIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastConvIdRef.current !== conversationId) {
      markRead.mutate(conversationId);
      lastConvIdRef.current = conversationId;
    }
  }, [conversationId, markRead]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [data?.items.length]);

  if (isLoading) {
    return <div className="flex-1 p-6 text-sm text-muted-foreground">Carregando…</div>;
  }
  // API retorna DESC; renderizamos ASC.
  const items = [...(data?.items ?? [])].reverse();

  // Agrupa por dia para inserir DayDivider.
  const blocks: { dayLabel: string; messages: PublicMessage[] }[] = [];
  for (const msg of items) {
    const label = dayLabel(msg.sentAt);
    const last = blocks[blocks.length - 1];
    if (last && last.dayLabel === label) last.messages.push(msg);
    else blocks.push({ dayLabel: label, messages: [msg] });
  }

  return (
    <div className="flex-1 overflow-y-auto px-12 py-4">
      {blocks.map((b, i) => (
        <div key={i}>
          <DayDivider label={b.dayLabel} />
          {b.messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
