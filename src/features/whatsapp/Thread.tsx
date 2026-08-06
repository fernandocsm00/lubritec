import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMessages, useMarkRead, fetchOlderMessages } from './api';
import { MessageBubble } from './MessageBubble';
import { DayDivider } from './DayDivider';
import { Composer } from './Composer';
import { dayLabel } from './helpers';
import { mergeMessages } from './mergeMessages';
import type { PublicMessage } from './types';

interface Props { conversationId: string }

// Distância do topo que dispara a busca do trecho anterior. Folga suficiente
// pra página chegar antes de o usuário bater na borda.
const TOPO_PX = 120;

export function Thread({ conversationId }: Props) {
  const { data, isLoading } = useMessages(conversationId);
  const markRead = useMarkRead();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastConvIdRef = useRef<string | null>(null);
  // "Responder citando": mensagem selecionada pra citar no Composer.
  const [replyingTo, setReplyingTo] = useState<PublicMessage | null>(null);

  // Trecho anterior à janela viva, carregado sob demanda e acumulado. Só cresce.
  const [older, setOlder] = useState<PublicMessage[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // null = ainda não paginamos, então quem manda é o hasMore da página viva.
  const [moreOlder, setMoreOlder] = useState<boolean | null>(null);
  // Altura preservada entre o clique e o render, pra thread não pular quando
  // mensagens são inseridas ACIMA do que o usuário está lendo.
  const ancoraRef = useRef<number | null>(null);

  // Troca de conversa limpa citação e histórico — são de outra thread.
  useEffect(() => {
    setReplyingTo(null);
    setOlder([]);
    setMoreOlder(null);
  }, [conversationId]);

  useEffect(() => {
    if (lastConvIdRef.current !== conversationId) {
      markRead.mutate(conversationId);
      lastConvIdRef.current = conversationId;
    }
  }, [conversationId, markRead]);

  const items = mergeMessages(data?.items ?? [], older);
  const temMais = moreOlder ?? data?.hasMore ?? false;
  const maisAntiga = items.length ? items[0] : null;
  // Só a mais RECENTE governa o auto-scroll: carregar histórico muda o tamanho
  // da lista sem ser motivo pra jogar o usuário lá pra baixo.
  const idMaisRecente = items.length ? items[items.length - 1].id : null;

  const carregarAnteriores = useCallback(async () => {
    if (loadingOlder || !temMais || !maisAntiga) return;
    const el = scrollRef.current;
    ancoraRef.current = el ? el.scrollHeight - el.scrollTop : null;
    setLoadingOlder(true);
    try {
      const page = await fetchOlderMessages(conversationId, maisAntiga.sentAt, maisAntiga.id);
      setOlder((atual) => mergeMessages(page.items, atual));
      setMoreOlder(page.hasMore);
    } catch {
      // Sem página nova: solta a âncora pra não travar o scroll no próximo render.
      ancoraRef.current = null;
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, loadingOlder, temMais, maisAntiga]);

  function handleScroll() {
    const el = scrollRef.current;
    if (el && el.scrollTop < TOPO_PX) void carregarAnteriores();
  }

  // Restaura a posição de leitura antes do paint: sem isso o conteúdo inserido
  // acima empurra a thread e o usuário perde o ponto onde estava.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && ancoraRef.current !== null) {
      el.scrollTop = el.scrollHeight - ancoraRef.current;
      ancoraRef.current = null;
    }
  }, [older]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [idMaisRecente, conversationId]);

  if (isLoading) {
    return <div className="flex-1 p-6 text-sm text-muted-foreground">Carregando…</div>;
  }

  // Agrupa por dia para inserir DayDivider.
  const blocks: { dayLabel: string; messages: PublicMessage[] }[] = [];
  for (const msg of items) {
    const label = dayLabel(msg.sentAt);
    const last = blocks[blocks.length - 1];
    if (last && last.dayLabel === label) last.messages.push(msg);
    else blocks.push({ dayLabel: label, messages: [msg] });
  }

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-12 py-4"
      >
        {temMais && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={() => void carregarAnteriores()}
              disabled={loadingOlder}
              className="text-xs text-muted-foreground hover:underline disabled:opacity-60"
            >
              {loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}
            </button>
          </div>
        )}
        {blocks.map((b, i) => (
          <div key={i}>
            <DayDivider label={b.dayLabel} />
            {b.messages.map((m) => <MessageBubble key={m.id} msg={m} onReply={setReplyingTo} />)}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <Composer
        conversationId={conversationId}
        replyingTo={replyingTo}
        onClearReply={() => setReplyingTo(null)}
      />
    </>
  );
}
