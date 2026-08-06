import { describe, it, expect } from 'vitest';
import { mergeMessages } from './mergeMessages';
import type { PublicMessage } from './types';

function msg(id: string, sentAt: string, body = id): PublicMessage {
  return {
    id,
    conversationId: 'c1',
    direction: 'in',
    kind: 'text',
    body,
    mediaUrl: null,
    mediaMime: null,
    sentByUser: null,
    sentAt,
    editedAt: null,
    deletedAt: null,
    replyTo: null,
  } as PublicMessage;
}

describe('mergeMessages', () => {
  it('devolve em ordem cronológica, do mais antigo pro mais novo', () => {
    // A API entrega DESC (mais recente primeiro); a thread renderiza ASC.
    const live = [msg('c', '2026-08-06T14:03:00Z'), msg('b', '2026-08-06T14:02:00Z')];
    const older = [msg('a', '2026-08-06T14:01:00Z')];

    expect(mergeMessages(live, older).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('NAO perde a mensagem que saiu da janela viva quando chega uma nova', () => {
    // Este e o bug que a paginacao ingenua cria: a janela de 50 desliza, a
    // mensagem que caiu fora dela nao esta em nenhuma das duas listas novas e
    // sumiria do meio da conversa sem ninguem notar.
    const liveAntes = [msg('m11', '2026-08-06T14:11:00Z'), msg('m10', '2026-08-06T14:10:00Z')];
    const older = [msg('m09', '2026-08-06T14:09:00Z')];
    const jaVisto = mergeMessages(liveAntes, older);

    // Chega m12 e m10 e empurrada pra fora da janela viva.
    const liveDepois = [msg('m12', '2026-08-06T14:12:00Z'), msg('m11', '2026-08-06T14:11:00Z')];
    const resultado = mergeMessages(liveDepois, jaVisto);

    expect(resultado.map((m) => m.id)).toEqual(['m09', 'm10', 'm11', 'm12']);
  });

  it('nao duplica mensagem presente nas duas listas', () => {
    const live = [msg('b', '2026-08-06T14:02:00Z'), msg('a', '2026-08-06T14:01:00Z')];
    const older = [msg('a', '2026-08-06T14:01:00Z')];

    expect(mergeMessages(live, older).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('a versao viva vence a antiga — edicao e exclusao aparecem', () => {
    // A pagina viva e repolled a cada 5s; o historico e congelado no momento em
    // que foi carregado. Num conflito, quem esta certo e a viva.
    const live = [{ ...msg('a', '2026-08-06T14:01:00Z', 'texto corrigido'), editedAt: '2026-08-06T14:05:00Z' }];
    const older = [msg('a', '2026-08-06T14:01:00Z', 'texto original')];

    const [only] = mergeMessages(live, older);
    expect(only.body).toBe('texto corrigido');
    expect(only.editedAt).toBe('2026-08-06T14:05:00Z');
  });

  it('mensagens no mesmo segundo mantem ordem estavel', () => {
    // O webhook grava varias mensagens com o mesmo sent_at (foi o caso do lote
    // de documentos as 18:47). Sem desempate a thread reordena sozinha a cada
    // poll e as bolhas piscam de lugar.
    const mesmoInstante = '2026-08-06T18:47:44Z';
    const live = [msg('z', mesmoInstante), msg('a', mesmoInstante), msg('m', mesmoInstante)];

    const uma = mergeMessages(live, []).map((m) => m.id);
    const outra = mergeMessages([...live].reverse(), []).map((m) => m.id);

    expect(uma).toEqual(outra);
  });

  it('listas vazias nao quebram', () => {
    expect(mergeMessages([], [])).toEqual([]);
  });
});
