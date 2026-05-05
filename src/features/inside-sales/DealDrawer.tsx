import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useDeal, usePatchDeal } from './api';
import { ActivityLog } from './ActivityLog';
import { ValueInput } from './ValueInput';
import { avatarInitials, formatCurrency, STAGE_LABELS, STAGE_COLORS } from './helpers';
import { formatCnpj } from '@/lib/utils';
import { useLead } from '@/features/leads/api';
import { LeadDialog } from '@/features/leads/LeadDialog';

interface Props {
  dealId: string | null;
  onClose: () => void;
  readOnly?: boolean;
}

export function DealDrawer({ dealId, onClose, readOnly = false }: Props) {
  const { data: deal, isLoading } = useDeal(dealId);
  const patch = usePatchDeal();
  const [valueDraft, setValueDraft] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [editLeadOpen, setEditLeadOpen] = useState(false);
  // Carrega lead completo lazy quando modal abre.
  const { data: fullLead } = useLead(editLeadOpen && deal ? deal.lead.id : null);

  useEffect(() => {
    if (deal) {
      setValueDraft(deal.proposalValue);
      setNotesDraft(deal.notes ?? '');
    }
  }, [deal?.id, deal?.proposalValue, deal?.notes]);

  async function saveValue() {
    if (!deal || readOnly) return;
    if (valueDraft === deal.proposalValue) return;
    try {
      await patch.mutateAsync({ id: deal.id, proposalValue: valueDraft });
    } catch {
      toast.error('Falha ao salvar valor.');
      setValueDraft(deal.proposalValue);
    }
  }

  async function saveNotes() {
    if (!deal || readOnly) return;
    if (notesDraft === (deal.notes ?? '')) return;
    try {
      await patch.mutateAsync({ id: deal.id, notes: notesDraft || null });
    } catch {
      toast.error('Falha ao salvar nota.');
      setNotesDraft(deal.notes ?? '');
    }
  }

  if (!dealId) return null;

  return (
    <div className="fixed top-0 right-0 h-full w-[440px] bg-background border-l border-border shadow-2xl z-50 flex flex-col overflow-hidden">
      <div className="flex items-start justify-between p-4 border-b border-border">
        {isLoading || !deal ? (
          <Skeleton className="h-10 w-40" />
        ) : (
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-sm font-semibold">
                {avatarInitials(deal.lead.name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="font-semibold text-sm">{deal.lead.name}</div>
              <div className="text-xs text-muted-foreground">
                {[deal.lead.phone, formatCnpj(deal.lead.cnpj)].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
        )}
        <button onClick={onClose} className="p-1 hover:bg-muted rounded">
          <X className="h-4 w-4" />
        </button>
      </div>

      {(isLoading || !deal) ? (
        <div className="p-4 space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <>
          <div className="p-4 border-b border-border space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Etapa</span>
              <span className={`font-semibold ${STAGE_COLORS[deal.stage]} bg-primary/10 px-2 py-0.5 rounded text-xs`}>
                {STAGE_LABELS[deal.stage]}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Valor</span>
              {readOnly ? (
                <span className="font-semibold">{formatCurrency(deal.proposalValue)}</span>
              ) : (
                <div className="w-32">
                  <ValueInput
                    value={valueDraft}
                    onChange={setValueDraft}
                  />
                </div>
              )}
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Dono</span>
              <span className="font-semibold">{deal.owner?.name ?? 'Sem dono'}</span>
            </div>
          </div>

          <div className="p-4 border-b border-border">
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Notas</h4>
            <Textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={saveNotes}
              placeholder="Anotações privadas sobre o deal…"
              className="min-h-[80px] text-sm"
              disabled={readOnly}
            />
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Atividade</h4>
            <ActivityLog activities={deal.activities} />
          </div>

          <div className="grid grid-cols-2 gap-2 p-4 border-t border-border">
            {/* Abrir conversa: deep-link com queue=comercial (típico pra deals) +
                statusChips ampliado pra incluir encerradas — maximiza chance da
                conv aparecer no filtro inicial. WhatsappPage faz auto-select. */}
            <Button asChild variant="outline" size="sm">
              <Link to={`/whatsapp?queue=comercial&statusChips=aguardando,em_atendimento,encerradas&assignment=all&origin=organic,campaign&lead=${deal.lead.id}`}>
                Abrir conversa
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditLeadOpen(true)}
              disabled={editLeadOpen && !fullLead}
            >
              {editLeadOpen && !fullLead ? 'Carregando…' : 'Editar lead'}
            </Button>
          </div>

          {fullLead && (
            <LeadDialog lead={fullLead} open={editLeadOpen} onOpenChange={setEditLeadOpen} />
          )}

          {!readOnly && valueDraft !== deal.proposalValue && (
            <div className="p-2 border-t border-border bg-muted/30">
              <Button size="sm" className="w-full" onClick={saveValue}>
                Salvar valor
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
