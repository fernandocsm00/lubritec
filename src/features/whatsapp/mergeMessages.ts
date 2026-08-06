import type { PublicMessage } from './types';

/**
 * Junta a pagina VIVA (as 50 mais recentes, repolled a cada 5s) com o historico
 * ja carregado sob demanda, e devolve pronto pra render: ordem cronologica,
 * sem duplicata.
 *
 * A uniao por id nao e detalhe de implementacao, e o que mantem a thread
 * integra. A janela viva desliza toda vez que chega mensagem nova: a que cai
 * fora dela nao aparece em nenhuma busca seguinte e sumiria do meio da conversa
 * se as paginas fossem so concatenadas. Acumulando por id, o que ja foi visto
 * nunca se perde.
 *
 * Em conflito, a versao VIVA vence — ela reflete edicao e exclusao recentes,
 * enquanto o historico e um retrato do momento em que foi carregado.
 */
export function mergeMessages(
  live: PublicMessage[],
  older: PublicMessage[],
): PublicMessage[] {
  const porId = new Map<string, PublicMessage>();
  for (const m of older) porId.set(m.id, m);
  for (const m of live) porId.set(m.id, m);

  return [...porId.values()].sort((a, b) => {
    const diff = Date.parse(a.sentAt) - Date.parse(b.sentAt);
    // Desempate por id: o webhook grava lotes inteiros no mesmo segundo e sem
    // criterio estavel as bolhas trocam de lugar a cada poll.
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}
