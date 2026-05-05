import { Clock } from 'lucide-react';
import { useLeadTransitions } from './api';
import type { LeadFlowStage, TransitionSource } from '@shared/types';

const STAGE_LABEL: Record<LeadFlowStage, string> = {
  incomplete: 'Incompleto',
  complete: 'Completo',
  dispatched: 'Disparado',
  engaged: 'Respondeu',
  qualified: 'Qualificado',
  handed_off: 'No comercial',
  lost: 'Perdido',
};

const SOURCE_LABEL: Record<TransitionSource, string> = {
  create: 'Cadastro inicial',
  manual_update: 'Edição manual',
  csv_import: 'Importação CSV',
  enrichment: 'BrasilAPI (enriquecimento)',
  webhook_inbound: 'Mensagem recebida',
  campaign_dispatch: 'Disparo automático',
  ai_qualification: 'IA qualificou',
  deal_created: 'Deal criado',
  manual_lost: 'Marcado como perdido',
  backfill: 'Migration (sistema)',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function StageTimeline({ leadId }: { leadId: string }) {
  const { data, isLoading } = useLeadTransitions(leadId);
  const transitions = data?.transitions ?? [];

  if (isLoading) {
    return <div className="text-xs text-muted-foreground">Carregando histórico…</div>;
  }
  if (transitions.length === 0) {
    return <div className="text-xs text-muted-foreground">Sem histórico de transições.</div>;
  }

  return (
    <ol className="space-y-2 max-h-64 overflow-y-auto pr-2">
      {transitions.map((t, i) => (
        <li key={t.id} className="relative pl-5 border-l border-border">
          <div className="absolute left-0 top-1 -translate-x-1/2 w-2 h-2 rounded-full bg-primary" />
          <div className="text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              {t.fromStage && (
                <>
                  <span className="text-muted-foreground">{STAGE_LABEL[t.fromStage] ?? t.fromStage}</span>
                  <span className="text-muted-foreground">→</span>
                </>
              )}
              <span className="font-semibold">{STAGE_LABEL[t.toStage] ?? t.toStage}</span>
              {i === 0 && <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">atual</span>}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{formatDateTime(t.changedAt)}</span>
              <span>·</span>
              <span>{SOURCE_LABEL[t.source] ?? t.source}</span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
