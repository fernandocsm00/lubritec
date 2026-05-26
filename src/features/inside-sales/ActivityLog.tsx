import { ACTIVITY_ICONS, STAGE_LABELS, LOSS_REASON_LABELS, formatCurrency, relativeTime } from './helpers';
import type { PublicDealActivity, DealStage, LossReason } from './types';

interface Props {
  activities: PublicDealActivity[];
}

function describe(a: PublicDealActivity): string {
  const md = a.metadata as Record<string, unknown>;
  const actor = a.actor?.name ?? 'Sistema';
  switch (a.kind) {
    case 'created': {
      const source = md.source === 'auto_image' ? 'automaticamente (imagem enviada)' : 'manualmente';
      return `Deal criado ${source}`;
    }
    case 'stage_changed':
      return `${actor} moveu de ${STAGE_LABELS[md.from as DealStage]} → ${STAGE_LABELS[md.to as DealStage]}`;
    case 'value_changed':
      return `${actor} editou valor: ${formatCurrency(md.from as number | null)} → ${formatCurrency(md.to as number | null)}`;
    case 'note_added':
      return `${actor} adicionou nota`;
    case 'won':
      return `${actor} marcou como ganho — ${formatCurrency(md.value as number)}`;
    case 'lost':
      return `${actor} marcou como perdido — ${LOSS_REASON_LABELS[md.reason as LossReason]}`;
    case 'reactivated':
      return `${actor} reativou (estava em ${STAGE_LABELS[md.from as DealStage]})`;
    case 'owner_changed':
      return `${actor} mudou o dono`;
    case 'quality_feedback':
      return `${actor} avaliou a qualidade do lead: ${md.feedback as string}`;
  }
}

export function ActivityLog({ activities }: Props) {
  if (!activities.length) {
    return <p className="text-xs text-muted-foreground p-3">Sem atividade ainda.</p>;
  }
  return (
    <div className="space-y-1">
      {activities.map((a) => (
        <div key={a.id} className="flex gap-2 py-1.5 text-xs">
          <div className="w-6 h-6 flex items-center justify-center bg-muted rounded-full flex-shrink-0">
            <span className="text-[11px]">{ACTIVITY_ICONS[a.kind]}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-foreground leading-tight">{describe(a)}</div>
            <div className="text-muted-foreground text-[10px] mt-0.5">{relativeTime(a.createdAt)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
