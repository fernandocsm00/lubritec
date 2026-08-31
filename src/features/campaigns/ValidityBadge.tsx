import { campaignValidityState, VALIDITY_LABELS } from './validity';

const TONES = {
  vigente: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  expirada: 'bg-muted text-muted-foreground border-border',
  sem_vigencia: 'bg-muted/50 text-muted-foreground/70 border-border',
} as const;

/**
 * Selo da vigência comercial. Não aparece em campanha contínua — ela não tem
 * vigência, e chamá-la de "expirada" seria mentira (ver campaignValidityState).
 */
export function ValidityBadge({
  campaign,
}: {
  campaign: { isContinuous: boolean; validityEnd: string | null };
}) {
  const state = campaignValidityState(campaign);
  if (!state) return null;

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${TONES[state]}`}>
      {VALIDITY_LABELS[state]}
    </span>
  );
}
