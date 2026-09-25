/**
 * Janela de atendimento da Meta (linha oficial): texto livre e mídia só até 24h
 * depois da última mensagem DO CLIENTE. Fora dela, só template aprovado — e o
 * template não reabre a janela; só a resposta do cliente reabre.
 *
 * Compartilhado de propósito: o servidor barra o envio e a Inbox trava o
 * Composer pela mesma regra. Se divergirem, o atendente vê o campo liberado e
 * leva 409, ou vê travado o que o servidor aceitaria.
 */
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function sessionWindowClosesAt(lastInboundAt: Date | string | null): Date | null {
  if (!lastInboundAt) return null;
  return new Date(new Date(lastInboundAt).getTime() + SESSION_WINDOW_MS);
}

export function isSessionWindowOpen(
  lastInboundAt: Date | string | null,
  now: Date = new Date(),
): boolean {
  const closesAt = sessionWindowClosesAt(lastInboundAt);
  return closesAt !== null && now.getTime() < closesAt.getTime();
}
