import type { CampaignStatus } from './types';

/** "Encerrar campanha" só aparece em campanha comum com disparo terminado. A
 * contínua não tem vigência; a que ainda dispara precisa ser cancelada antes. */
export function canEndCampaign(c: { isContinuous: boolean; status: CampaignStatus }): boolean {
  return !c.isContinuous && (c.status === 'completed' || c.status === 'cancelled');
}

export function endCampaignConfirmText(openCards: number): string {
  if (openCards === 0) return 'Nenhum card aberto desta campanha. A vigência termina agora.';
  const cards = openCards === 1 ? '1 card aberto vai' : `${openCards} cards abertos vão`;
  return `${cards} para Perdido, com o motivo "Campanha encerrada", e saem do Kanban. `
    + 'Os donos são avisados e podem reabrir pelo Histórico. A vigência termina agora.';
}

export function endCampaignResultMessage(closedCards: number): string {
  if (closedCards === 0) return 'Campanha encerrada.';
  return `Campanha encerrada. ${closedCards} ${closedCards === 1 ? 'card fechado' : 'cards fechados'}.`;
}
