import { useDroppable } from '@dnd-kit/core';
import { DealCard } from './DealCard';
import { formatCurrency, STAGE_LABELS, STAGE_COLORS } from './helpers';
import type { DealStage, PublicDeal, DealStageTotal } from './types';

interface Props {
  stage: DealStage;
  items: PublicDeal[];
  total: DealStageTotal;
  currentUserId: string;
  onCardClick: (deal: PublicDeal) => void;
}

export function KanbanColumn({ stage, items, total, currentUserId, onCardClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${stage}`,
    data: { stage },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[220px] bg-background border rounded-lg overflow-hidden transition-colors ${
        isOver ? 'border-primary bg-primary/5' : 'border-border'
      }`}
    >
      <div className="px-3 py-2.5 border-b border-border bg-muted/30 flex justify-between items-center">
        <span className={`text-xs font-semibold uppercase tracking-wide ${STAGE_COLORS[stage]}`}>
          {STAGE_LABELS[stage]}
        </span>
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full inline-block">
            {total.count}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {formatCurrency(total.valueSum)}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px]">
        {items.map((d) => (
          <DealCard key={d.id} deal={d} currentUserId={currentUserId} onClick={() => onCardClick(d)} />
        ))}
        {items.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">vazio</div>
        )}
      </div>
    </div>
  );
}
