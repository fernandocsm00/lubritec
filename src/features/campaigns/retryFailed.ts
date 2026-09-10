import type { CampaignStatus } from './types';

export interface RetryFailedResult {
  requeued: number;
  skippedInterrupted: number;
  campaignStatus: CampaignStatus;
}

/**
 * Texto do resultado do reenvio.
 *
 * O split importa: "reenviar falhados" não reenvia TODOS os falhados, e o
 * operador precisa ver isso no momento em que a ação acontece — não descobrir
 * depois que N destinatários seguem em falha.
 */
export function retryFailedResultMessage(
  r: RetryFailedResult,
): { title: string; description?: string } {
  const interrompidos = r.skippedInterrupted === 1
    ? '1 disparo foi interrompido no meio do envio e não entra no reenvio — pode já ter sido entregue.'
    : `${r.skippedInterrupted} disparos foram interrompidos no meio do envio e não entram no reenvio — podem já ter sido entregues.`;

  if (r.requeued === 0) {
    return r.skippedInterrupted > 0
      ? { title: 'Nada foi reenfileirado', description: interrompidos }
      : { title: 'Nada foi reenfileirado', description: 'Não há falhas elegíveis nesta campanha.' };
  }

  const title = r.requeued === 1
    ? '1 disparo reenfileirado'
    : `${r.requeued} disparos reenfileirados`;

  return {
    title,
    description: r.skippedInterrupted > 0 ? interrompidos : undefined,
  };
}

/** Texto do diálogo de confirmação — é mensagem saindo pra cliente real. */
export function retryFailedConfirmText(input: {
  failedCount: number;
  status: CampaignStatus;
  validityExpired: boolean;
}): string {
  const partes: string[] = [];

  partes.push(
    input.failedCount === 1
      ? 'A falha desta campanha volta para a fila e o disparo é refeito no ritmo normal.'
      : `As ${input.failedCount} falhas desta campanha voltam para a fila e os disparos são refeitos no ritmo normal.`,
  );

  partes.push(
    'Disparos interrompidos no meio do envio ficam de fora: podem já ter chegado ao cliente, e mandar de novo duplicaria a mensagem.',
  );

  if (input.status === 'completed' || input.status === 'paused') {
    partes.push('A campanha volta a disparar e se encerra sozinha quando a fila esvaziar.');
  }

  if (input.validityExpired) {
    partes.push(
      'Atenção: a vigência comercial desta campanha já expirou — a condição oferecida na mensagem pode não valer mais.',
    );
  }

  return partes.join(' ');
}
