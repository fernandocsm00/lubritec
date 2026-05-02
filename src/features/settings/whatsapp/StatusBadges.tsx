import { Badge } from '@/components/ui/badge';
import { STATUS_LABELS, STATUS_TONES } from './helpers';
import type { InstanceStatus } from './types';

interface Props {
  status: InstanceStatus;
  webhookSynced: boolean;
}

export function StatusBadges({ status, webhookSynced }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="outline" className={`uppercase tracking-wide text-[10px] px-3 py-1 border ${STATUS_TONES[status]}`}>
        {STATUS_LABELS[status]}
      </Badge>
      <Badge
        variant="outline"
        className={`uppercase tracking-wide text-[10px] px-3 py-1 border ${
          webhookSynced
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
            : 'bg-muted text-muted-foreground'
        }`}
      >
        {webhookSynced ? 'Webhook Ativo' : 'Webhook Inativo'}
      </Badge>
    </div>
  );
}
