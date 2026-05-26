import { useState } from 'react';
import { MoreHorizontal, Search, Ban, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { LeadDialog } from './LeadDialog';
import { useDeleteLead, useEnrichLead, useMarkLeadLost, useCloseLeadNoDeal, type EnrichmentStatus } from './api';
import { CloseNoDealDialog } from './CloseNoDealDialog';
import { Textarea } from '@/components/ui/textarea';
import { translateError } from './translateError';
import type { PublicLead, LeadQualityFeedback } from '@shared/types';

const ENRICH_MESSAGES: Record<EnrichmentStatus, { type: 'success' | 'info' | 'error'; msg: (phone?: string, err?: string) => string }> = {
  phone_found: {
    type: 'success',
    msg: (phone) => `Telefone encontrado: ${phone}. Lead atualizado.`,
  },
  phone_not_in_brasilapi: {
    type: 'info',
    msg: () => 'CNPJ ativo na BrasilAPI mas sem telefone cadastrado.',
  },
  cnpj_not_found: {
    type: 'info',
    msg: () => 'CNPJ não encontrado na BrasilAPI/Receita Federal.',
  },
  cnpj_inactive: {
    type: 'info',
    msg: (_p, err) => `CNPJ encontrado mas inativo: ${err ?? 'situação não ativa'}.`,
  },
  api_error: {
    type: 'error',
    msg: (_p, err) => `Erro na BrasilAPI: ${err ?? 'desconhecido'}.`,
  },
};

export function LeadActions({ lead }: { lead: PublicLead }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [closeNoDealOpen, setCloseNoDealOpen] = useState(false);
  const del = useDeleteLead();
  const enrich = useEnrichLead();
  const markLost = useMarkLeadLost();
  const closeNoDeal = useCloseLeadNoDeal();
  // Disponibilizamos enriquecimento só pra leads sem phone E com cnpj.
  const canEnrich = !lead.phone && !!lead.cnpj;
  // Marcar como perdido: só permite se ainda não está em handed_off OR lost.
  const canMarkLost = lead.flowStage !== 'lost' && lead.flowStage !== 'handed_off';
  // Encerrar sem deal: só se o lead ainda não tem deal e não está encerrado.
  const canCloseNoDeal = !lead.hasDeal && lead.flowStage !== 'lost';

  async function onDelete() {
    try {
      await del.mutateAsync(lead.id);
      toast.success('Lead excluído.');
    } catch (e) {
      const msg = e instanceof Error ? translateError(e.message) : 'Erro ao excluir.';
      toast.error(msg);
    }
  }

  async function onMarkLost() {
    try {
      await markLost.mutateAsync({ id: lead.id, reason: lostReason.trim() || undefined });
      toast.success('Lead marcado como perdido.');
      setLostOpen(false);
      setLostReason('');
    } catch (e) {
      toast.error(e instanceof Error ? translateError(e.message) : 'Erro ao marcar como perdido.');
    }
  }

  async function onCloseNoDeal(reason: string, quality: LeadQualityFeedback) {
    try {
      await closeNoDeal.mutateAsync({ leadId: lead.id, reason, quality });
      toast.success('Lead encerrado sem deal.');
      setCloseNoDealOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? translateError(e.message) : 'Erro ao encerrar lead.');
    }
  }

  async function onEnrich() {
    try {
      const result = await enrich.mutateAsync(lead.id);
      const meta = ENRICH_MESSAGES[result.status];
      const text = meta.msg(result.phoneFound, result.errorMessage);
      if (meta.type === 'success') toast.success(text);
      else if (meta.type === 'error') toast.error(text);
      else toast.info(text);
    } catch (e) {
      const msg = e instanceof Error ? translateError(e.message) : 'Erro ao buscar telefone.';
      toast.error(msg);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Ações para ${lead.name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>Editar</DropdownMenuItem>
          {canEnrich && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onEnrich} disabled={enrich.isPending}>
                <Search className="mr-2 h-4 w-4" />
                {enrich.isPending ? 'Buscando…' : 'Buscar telefone (BrasilAPI)'}
              </DropdownMenuItem>
            </>
          )}
          {canMarkLost && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setLostOpen(true)}>
                <Ban className="mr-2 h-4 w-4" />
                Marcar como perdido
              </DropdownMenuItem>
            </>
          )}
          {canCloseNoDeal && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setCloseNoDealOpen(true)}>
                <XCircle className="mr-2 h-4 w-4" />
                Encerrar sem deal
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="text-destructive">
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <LeadDialog lead={lead} open={editOpen} onOpenChange={setEditOpen} />

      <AlertDialog open={lostOpen} onOpenChange={setLostOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar {lead.name} como perdido?</AlertDialogTitle>
            <AlertDialogDescription>
              O lead será movido pra etapa "Perdido" e sairá das filas ativas.
              Isso é registrado no histórico do lead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Motivo (opcional)</label>
            <Textarea
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder="Ex: cliente disse que não tem interesse no momento"
              rows={3}
              maxLength={500}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={onMarkLost}
              disabled={markLost.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Marcar como perdido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {lead.name}?</AlertDialogTitle>
            <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CloseNoDealDialog
        open={closeNoDealOpen}
        onConfirm={onCloseNoDeal}
        onCancel={() => setCloseNoDealOpen(false)}
      />
    </>
  );
}
