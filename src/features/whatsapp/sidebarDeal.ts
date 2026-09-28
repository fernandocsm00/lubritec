import type { DealStage } from '@shared/types';
import { STAGE_LABELS } from '../inside-sales/helpers';

/**
 * Card exibido na barra lateral da Inbox. Com card por campanha o lead pode ter
 * mais de um aberto: mostra o escolhido pelo vendedor e, sem escolha (ou se o
 * escolhido fechou), o aberto mais recente. Sem aberto nenhum, o fechado mais
 * recente — é o que `/deals/by-lead` devolve.
 */
export function pickSidebarDeal<T extends { id: string }>(
  openDeals: T[],
  selectedId: string | null,
  fallback: T | null,
): T | null {
  if (selectedId) {
    const selected = openDeals.find((d) => d.id === selectedId);
    if (selected) return selected;
  }
  return openDeals[0] ?? fallback;
}

export function dealOptionLabel(d: { campaignName: string | null; stage: DealStage }): string {
  return `${d.campaignName ?? 'Sem campanha'} · ${STAGE_LABELS[d.stage]}`;
}
