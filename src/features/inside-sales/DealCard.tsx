import { useDraggable } from '@dnd-kit/core';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Car } from 'lucide-react';
import { avatarInitials, formatCurrency, relativeTime, LOSS_REASON_LABELS } from './helpers';
import type { PublicDeal } from './types';

interface Props {
  deal: PublicDeal;
  currentUserId: string;
  onClick: () => void;
}

const STAGE_ACCENT: Record<string, string> = {
  proposta_enviada: 'var(--lc-navy)',
  em_negociacao: 'var(--lc-amber)',
  ganho: 'hsl(var(--success))',
  perdido: 'var(--lc-ruby)',
};

export function DealCard({ deal, currentUserId, onClick }: Props) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: deal.id,
    data: { dealId: deal.id, fromStage: deal.stage },
  });

  const isMine = deal.owner?.id === currentUserId;
  const ownerLabel = !deal.owner ? 'Sem dono' : isMine ? 'Você' : deal.owner.name;

  const accent = STAGE_ACCENT[deal.stage] ?? 'var(--lc-navy)';

  const style: React.CSSProperties = {
    borderLeftColor: accent,
    ...(transform
      ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.4 : 1 }
      : { opacity: isDragging ? 0.4 : 1 }),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => { if (!isDragging) onClick(); }}
      className="bg-card border border-border border-l-[3px] rounded-md p-3 hover:border-lc-navy transition-colors cursor-grab active:cursor-grabbing shadow-lc-soft relative"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Avatar className="h-[26px] w-[26px]">
          <AvatarFallback
            className="text-[10px] font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, var(--lc-navy), var(--lc-navy-soft))' }}
          >
            {avatarInitials(deal.lead.name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 truncate font-semibold text-[13px] text-lc-ink">
          {deal.lead.name}
        </div>
        {deal.isStale && (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 border-amber-500/40"
            style={{ color: 'var(--lc-amber)' }}
          >
            parado
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-2.5 min-w-0">
        <Car className="h-3 w-3 shrink-0" />
        <span className="truncate">
          {[deal.lead.vehicleModel, deal.lead.vehiclePlate].filter(Boolean).join(' · ') || '—'}
        </span>
      </div>

      {deal.stage === 'perdido' && deal.lossReason && (
        <div className="mb-2">
          <Badge variant="outline" className="text-[10px] px-2 py-0 border-destructive/40 text-destructive">
            motivo · {LOSS_REASON_LABELS[deal.lossReason]}
          </Badge>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-dashed border-border pt-2 mt-1">
        <span
          className="text-[14px] font-bold font-mono tracking-tight"
          style={{
            color:
              deal.proposalValue == null
                ? 'hsl(var(--muted-foreground))'
                : deal.stage === 'ganho'
                ? 'hsl(var(--success))'
                : 'var(--lc-ink)',
          }}
        >
          {formatCurrency(deal.proposalValue)}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">
          {ownerLabel} · {relativeTime(deal.updatedAt)}
        </span>
      </div>
    </div>
  );
}
