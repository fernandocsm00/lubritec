import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/features/auth/store';
import { useDeal, usePatchDeal, useAssignableUsers } from './api';
import { ActivityLog } from './ActivityLog';
import { ValueInput } from './ValueInput';
import { avatarInitials, formatCurrency, STAGE_LABELS, STAGE_COLORS } from './helpers';
import { formatCnpj } from '@/lib/utils';
import { useLead } from '@/features/leads/api';
import { LeadDialog } from '@/features/leads/LeadDialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CaseSheet } from '@/features/case-sheet/CaseSheet';

interface Props {
  dealId: string | null;
  onClose: () => void;
  readOnly?: boolean;
}

export function DealDrawer({ dealId, onClose, readOnly = false }: Props) {
  const { data: deal, isLoading } = useDeal(dealId);
  const patch = usePatchDeal();
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');
  const userRole = useAuthStore((s) => s.user?.role);
  const isAdmin = userRole === 'admin';
  const { data: assignableUsers } = useAssignableUsers();
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

  async function changeOwner(value: string) {
    if (!deal || readOnly) return;
    const next = value === '__none' ? null : value;
    if (next === (deal.owner?.id ?? null)) return;
    try {
      await patch.mutateAsync({ id: deal.id, ownerUserId: next });
    } catch {
      toast.error('Falha ao alterar dono.');
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
              {readOnly ? (
                <span className="font-semibold">{deal.owner?.name ?? 'Sem dono'}</span>
              ) : (
                <Select
                  value={deal.owner?.id ?? '__none'}
                  onValueChange={changeOwner}
                  disabled={patch.isPending}
                >
                  <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Sem dono</SelectItem>
                    {assignableUsers?.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.id === currentUserId ? `${u.name} (você)` : u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <Tabs defaultValue="deal" className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 pt-2 border-b border-border">
              <TabsList className="h-8">
                <TabsTrigger value="deal" className="text-xs">Deal</TabsTrigger>
                <TabsTrigger value="case-sheet" className="text-xs">Ficha do Caso</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="deal" className="flex-1 flex flex-col overflow-hidden m-0 p-0">
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
            </TabsContent>

            <TabsContent value="case-sheet" className="flex-1 overflow-y-auto p-4 m-0">
              <CaseSheet
                leadId={deal.lead.id}
                isAdmin={isAdmin}
                onOpenDeal={() => { /* já estamos no deal */ }}
              />
            </TabsContent>
          </Tabs>

          <div className="grid grid-cols-2 gap-2 p-4 border-t border-border">
            {/* Abrir conversa: deep-link minimo com ?lead= apenas. WhatsappPage
                resolve via /conversations/by-lead/:leadId e navega pra fila certa
                (qualquer queue/status) -- antes forcavamos queue=comercial e
                falhava quando o lead estava em outra fila. */}
            <Button asChild variant="outline" size="sm">
              <Link to={`/whatsapp?lead=${deal.lead.id}`}>
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
