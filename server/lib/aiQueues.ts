import type { ConversationQueue } from '@shared/types';

/**
 * Filas em que a IA de atendimento responde.
 *
 * Historico: ate 2026-08-05 era so 'ia' — todo contato organico caia em
 * 'recepcao' e ficava 100% humano. A partir daqui a IA tambem responde a
 * Recepcao, SEM tirar a conversa de la (o time continua vendo tudo na mesma
 * fila de sempre; muda so quem responde primeiro). 'comercial' fica de fora:
 * chegou ali, humano assumiu.
 *
 * O freio fino nao e a fila e sim conversations.ai_disabled — setado assim que
 * alguem do time responde pela Inbox (ver conversationsService).
 */
export const AI_QUEUES: readonly ConversationQueue[] = ['ia', 'recepcao'];

export function isAiQueue(queue: ConversationQueue): boolean {
  return AI_QUEUES.includes(queue);
}
