import { useState } from 'react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { useAuthStore } from '@/features/auth/store';
import {
  useCreateDeal, useChangeStage, useDealByLead, usePatchDeal,
} from '@/features/inside-sales/api';
import { STAGE_LABELS } from '@/features/inside-sales/helpers';
import { GanhoValueDialog } from '@/features/inside-sales/GanhoValueDialog';
import { LossReasonDialog } from '@/features/inside-sales/LossReasonDialog';
import { DEAL_STAGES, type DealStage, type LossReason, type LeadQualityFeedback } from '@shared/types';
import { useConversations } from './api';
import { avatarInitials, formatPhoneBR } from './helpers';
import { formatCnpj } from '@/lib/utils';
import { useLead } from '@/features/leads/api';
import { LeadDialog } from '@/features/leads/LeadDialog';
import type { ConversationFilters, PublicConversation } from './types';

interface Props {
  conversationId: string;
  filters: ConversationFilters;
}

const STATUS_LABEL: Record<PublicConversation['lead']['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  frio: { label: 'Frio', variant: 'secondary' },
  morno: { label: 'Morno', variant: 'default' },
  quente: { label: 'Quente', variant: 'destructive' },
};

const QUEUE_LABEL: Record<PublicConversation['queue'], string> = {
  ia: 'IA',
  recepcao: 'Recepção',
  comercial: 'Comercial',
};

export function LeadSidebar({ conversationId, filters }: Props) {
  // Reaproveita a lista para evitar request extra — encontra a conv selecionada lá.
  const { data, isLoading } = useConversations(filters);
  const conv = data?.items.find((c) => c.id === conversationId);
  const [editLeadOpen, setEditLeadOpen] = useState(false);
  // Carrega lead completo só quando modal abre (lazy).
  const { data: fullLead } = useLead(editLeadOpen ? (conv?.lead.id ?? null) : null);

  if (isLoading || !conv) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-24 w-24 rounded-full mx-auto" />
        <Skeleton className="h-4 w-32 mx-auto" />
        <Skeleton className="h-3 w-24 mx-auto" />
      </div>
    );
  }

  const status = STATUS_LABEL[conv.lead.status];
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-6 pb-4 border-b border-border bg-muted/30 text-center">
        <Avatar className="h-20 w-20 mx-auto">
          <AvatarFallback className="bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-2xl font-semibold">
            {avatarInitials(conv.lead.name)}
          </AvatarFallback>
        </Avatar>
        <h3 className="mt-3 text-base font-semibold">{conv.lead.name}</h3>
        <p className="text-xs text-muted-foreground">{formatPhoneBR(conv.phone)}</p>
        <Badge variant={status.variant} className="mt-2">{status.label}</Badge>
      </div>

      <div className="px-4 py-3 border-b border-border">
        <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Empresa</h4>
        <Row label="CNPJ" value={formatCnpj(conv.lead.cnpj)} />
      </div>

      <div className="px-4 py-3 border-b border-border">
        <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Atendimento</h4>
        <Row label="Fila" value={QUEUE_LABEL[conv.queue]} />
        <Row label="Dono" value={conv.assignedTo?.name ?? 'Sem dono'} />
        <Row label="Origem" value={conv.originKind === 'campaign' ? 'Campanha' : 'Orgânica'} />
      </div>

      {/* Pipeline section — só pra admin/comercial */}
      <PipelineSection leadId={conv.lead.id} />

      <div className="mt-auto p-4 space-y-2">
        <Button variant="default" className="w-full" onClick={() => setEditLeadOpen(true)} disabled={editLeadOpen && !fullLead}>
          {editLeadOpen && !fullLead ? 'Carregando…' : 'Editar lead →'}
        </Button>
      </div>

      {/* Modal só abre depois que o lead completo carregar — evita flash de "Novo lead". */}
      {fullLead && (
        <LeadDialog
          lead={fullLead}
          open={editLeadOpen}
          onOpenChange={setEditLeadOpen}
        />
      )}
    </div>
  );
}

function PipelineSection({ leadId }: { leadId: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const visible = role === 'admin' || role === 'comercial';
  if (!visible) return null;

  return (
    <div className="px-4 py-3 border-b border-border">
      <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
        Pipeline
      </h4>
      <PipelinePhasePicker leadId={leadId} />
    </div>
  );
}

// Sentinela usada no Select pra representar "sem deal" — Radix Select nao
// aceita value="" então usamos um marcador explicito (igual ao padrão de
// CampaignReportFilters.tsx).
const PHASE_NONE = '__any__' as const;

function PipelinePhasePicker({ leadId }: { leadId: string }) {
  const { data: deal, isLoading } = useDealByLead(leadId);
  const create = useCreateDeal();
  const change = useChangeStage();
  const patch = usePatchDeal();

  const [pendingStage, setPendingStage] = useState<DealStage | null>(null);
  const showGanho = pendingStage === 'ganho';
  const showPerdido = pendingStage === 'perdido';

  const currentStage: DealStage | typeof PHASE_NONE = deal?.stage ?? PHASE_NONE;
  const isBusy = create.isPending || change.isPending || patch.isPending;

  async function handleSelect(stage: DealStage | typeof PHASE_NONE) {
    if (stage === PHASE_NONE) return;
    if (stage === 'ganho' || stage === 'perdido') {
      setPendingStage(stage);
      return;
    }
    try {
      if (!deal) {
        const created = await create.mutateAsync({ leadId });
        if (stage !== 'lead_no_comercial') {
          await change.mutateAsync({ id: created.id, stage });
        }
        toast.success('Lead adicionado ao pipeline.');
      } else if (deal.stage !== stage) {
        await change.mutateAsync({ id: deal.id, stage });
        toast.success(`Movido para "${STAGE_LABELS[stage]}".`);
      }
    } catch {
      toast.error('Falha ao mover lead.');
    }
  }

  async function confirmGanho(value: number, feedback: LeadQualityFeedback) {
    setPendingStage(null);
    try {
      let targetDealId = deal?.id;
      if (!targetDealId) {
        const created = await create.mutateAsync({ leadId, proposalValue: value });
        targetDealId = created.id;
      } else if (deal?.proposalValue == null) {
        await patch.mutateAsync({ id: targetDealId, proposalValue: value });
      }
      await change.mutateAsync({
        id: targetDealId,
        stage: 'ganho',
        leadQualityFeedback: feedback,
      });
      toast.success('Marcado como ganho.');
    } catch {
      toast.error('Falha ao marcar como ganho.');
    }
  }

  async function confirmPerdido(reason: LossReason, feedback: LeadQualityFeedback) {
    setPendingStage(null);
    try {
      let targetDealId = deal?.id;
      if (!targetDealId) {
        const created = await create.mutateAsync({ leadId });
        targetDealId = created.id;
      }
      await change.mutateAsync({
        id: targetDealId,
        stage: 'perdido',
        lossReason: reason,
        leadQualityFeedback: feedback,
      });
      toast.success('Marcado como perdido.');
    } catch {
      toast.error('Falha ao marcar como perdido.');
    }
  }

  if (isLoading) {
    return <Skeleton className="h-9 w-full" />;
  }

  return (
    <div className="space-y-2">
      <Select
        value={currentStage}
        onValueChange={(v) => handleSelect(v as DealStage | typeof PHASE_NONE)}
        disabled={isBusy}
      >
        <SelectTrigger>
          <SelectValue placeholder="Não está no pipeline" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PHASE_NONE}>Não está no pipeline</SelectItem>
          {DEAL_STAGES.map((s) => (
            <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {deal && (
        <a
          href={`/inside-sales?dealId=${deal.id}`}
          className="block text-xs text-primary hover:underline"
        >
          Abrir no pipeline →
        </a>
      )}

      <GanhoValueDialog
        open={showGanho}
        onConfirm={confirmGanho}
        onCancel={() => setPendingStage(null)}
      />
      <LossReasonDialog
        open={showPerdido}
        onConfirm={confirmPerdido}
        onCancel={() => setPendingStage(null)}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
