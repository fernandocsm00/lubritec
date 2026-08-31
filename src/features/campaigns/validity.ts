export type ValidityState = 'vigente' | 'expirada' | 'sem_vigencia';

export const VALIDITY_LABELS: Record<ValidityState, string> = {
  vigente: 'Vigente',
  expirada: 'Expirada',
  sem_vigencia: 'Sem vigência',
};

/**
 * Situação da vigência COMERCIAL — quando a condição vale, distinta do ciclo do
 * disparo. Uma campanha `completed` (tudo enviado) pode seguir vigente por dias.
 *
 * Devolve null para campanha contínua: ela re-enfileira indefinidamente e não
 * tem vigência, então rotulá-la de "expirada" seria mentira. A UI omite o selo.
 */
export function campaignValidityState(
  campaign: { isContinuous: boolean; validityEnd: string | null },
  now: Date = new Date(),
): ValidityState | null {
  if (campaign.isContinuous) return null;
  if (!campaign.validityEnd) return 'sem_vigencia';

  const end = new Date(campaign.validityEnd).getTime();
  if (Number.isNaN(end)) return 'sem_vigencia';

  // O instante exato do fim ainda conta como vigente — o último dia vale.
  return end >= now.getTime() ? 'vigente' : 'expirada';
}
