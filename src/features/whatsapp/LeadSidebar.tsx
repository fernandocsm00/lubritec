import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/features/auth/store';
import { useCreateDeal } from '@/features/inside-sales/api';
import { useConversations } from './api';
import { avatarInitials, formatPhoneBR } from './helpers';
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
        <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Veículo</h4>
        <Row label="Modelo" value={conv.lead.vehicleModel ?? '—'} />
        <Row label="Placa" value={conv.lead.vehiclePlate ?? '—'} />
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
        <Button asChild variant="default" className="w-full">
          <Link to="/cadastros">Editar lead →</Link>
        </Button>
      </div>
    </div>
  );
}

function PipelineSection({ leadId }: { leadId: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const visible = role === 'admin' || role === 'comercial';
  const create = useCreateDeal();

  if (!visible) return null;

  async function addToPipeline() {
    try {
      await create.mutateAsync({ leadId });
      toast.success('Adicionado ao pipeline.');
      window.location.href = `/inside-sales?owner=all`;
    } catch {
      toast.error('Falha ao adicionar.');
    }
  }

  return (
    <div className="px-4 py-3 border-b border-border">
      <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Pipeline</h4>
      <Button size="sm" variant="outline" className="w-full" onClick={addToPipeline} disabled={create.isPending}>
        + Adicionar ao pipeline
      </Button>
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
