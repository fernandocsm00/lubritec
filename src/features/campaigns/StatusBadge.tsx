import { Badge } from '@/components/ui/badge';
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONES } from './helpers';
import type { CampaignStatus } from './types';

export function StatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge variant="outline" className={`uppercase text-[10px] tracking-wide px-2 py-0.5 border ${CAMPAIGN_STATUS_TONES[status]}`}>
      {CAMPAIGN_STATUS_LABELS[status]}
    </Badge>
  );
}
