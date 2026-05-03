import type { PublicCampaign } from './types';

interface Props { campaign: PublicCampaign }

export function DispatchProgress({ campaign }: Props) {
  const total = campaign.audienceTotal;
  const processed = campaign.sentCount + campaign.failedCount + campaign.skippedCount;
  const pct = total === 0 ? 0 : Math.round((processed / total) * 100);

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{processed}/{total} processadas</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 bg-muted rounded overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-muted-foreground">
        {campaign.sentCount} enviadas · {campaign.failedCount} falharam · {campaign.skippedCount} ignoradas
      </div>
    </div>
  );
}
