import { sessionWindowClosesAt } from '@shared/sessionWindow';
import type { ProviderKind } from '@shared/types';
import type { PublicMessage } from './types';

// Antecedência do aviso "a janela fecha às…": tempo de o atendente mandar a
// cotação enquanto ainda dá.
const CLOSING_SOON_MS = 3 * 60 * 60 * 1000;

export type SessionWindowView =
  /** Linha não oficial (ou linha ainda carregando): sem regra de janela. */
  | { state: 'sem_janela' }
  | { state: 'aberta'; closesAt: Date; closingSoon: boolean }
  | { state: 'fechada'; lastInboundAt: Date | null; templateSentAt: Date | null };

export function sessionWindowView(input: {
  provider: ProviderKind | undefined;
  lastInboundAt: string | null;
  messages: Pick<PublicMessage, 'direction' | 'sentAt' | 'deliveryStatus' | 'deletedAt'>[];
  now: Date;
}): SessionWindowView {
  if (input.provider !== 'meta_cloud') return { state: 'sem_janela' };

  // A lista de conversas faz polling a cada 15s e a thread a cada 5s: a resposta
  // do cliente aparece antes na thread, e é ela que deve destravar o chat.
  let lastInbound = input.lastInboundAt ? new Date(input.lastInboundAt) : null;
  for (const m of input.messages) {
    if (m.direction !== 'in') continue;
    const at = new Date(m.sentAt);
    if (!lastInbound || at > lastInbound) lastInbound = at;
  }

  const closesAt = sessionWindowClosesAt(lastInbound);
  if (closesAt && input.now < closesAt) {
    return {
      state: 'aberta',
      closesAt,
      closingSoon: closesAt.getTime() - input.now.getTime() <= CLOSING_SOON_MS,
    };
  }

  // Com a janela fechada a Meta só aceita template: o que saiu depois do
  // fechamento e não voltou recusado só pode ter sido template.
  let templateSentAt: Date | null = null;
  for (const m of input.messages) {
    if (m.direction !== 'out' || m.deliveryStatus === 'failed' || m.deletedAt) continue;
    const at = new Date(m.sentAt);
    if (closesAt && at < closesAt) continue;
    if (!templateSentAt || at > templateSentAt) templateSentAt = at;
  }
  return { state: 'fechada', lastInboundAt: lastInbound, templateSentAt };
}
