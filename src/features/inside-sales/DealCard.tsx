import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { avatarInitials, formatCurrency, relativeTime, LOSS_REASON_LABELS } from './helpers';
import type { PublicDeal } from './types';

interface Props {
  deal: PublicDeal;
  currentUserId: string;
  onClick: () => void;
}

export function DealCard({ deal, currentUserId, onClick }: Props) {
  const isMine = deal.owner?.id === currentUserId;
  const ownerLabel = !deal.owner
    ? 'Sem dono'
    : isMine
    ? 'Você'
    : deal.owner.name;

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-card border border-border rounded-lg p-3 hover:border-primary transition-colors"
    >
      <div className="flex items-center gap-2 mb-2">
        <Avatar className="h-7 w-7">
          <AvatarFallback className="bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-[10px] font-semibold">
            {avatarInitials(deal.lead.name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 truncate font-semibold text-sm">
          {deal.lead.name}
        </div>
        {deal.isStale && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-500">
            parado
          </Badge>
        )}
      </div>

      <div className="text-xs text-muted-foreground mb-2 truncate">
        {[deal.lead.vehicleModel, deal.lead.vehiclePlate].filter(Boolean).join(' · ') || '—'}
      </div>

      {deal.stage === 'perdido' && deal.lossReason && (
        <div className="mb-2">
          <Badge variant="outline" className="text-[10px] px-2 py-0 border-destructive/40 text-destructive">
            {LOSS_REASON_LABELS[deal.lossReason]}
          </Badge>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border/40 pt-2 mt-1">
        <span className={`text-sm font-bold ${deal.proposalValue == null ? 'text-muted-foreground font-normal' : 'text-emerald-500'}`}>
          {formatCurrency(deal.proposalValue)}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {ownerLabel} · {relativeTime(deal.updatedAt)}
        </span>
      </div>
    </button>
  );
}
